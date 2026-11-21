// Tests for scripts/doctor.mjs against real local sockets (fake SMTP and HTTP servers on random
// ports). Uses Vitest globals (see scripts/vitest.config.mjs).
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  checkEnvFile,
  checkMailpitWeb,
  checkPortFree,
  checkPostgres,
  checkSmtp,
  formatResult,
  loadDoctorEnv,
} from './doctor.mjs';

const servers = [];
let tmp;

/** Starts a TCP server on a random localhost port and returns the port. */
async function tcpServer(onConnection) {
  const server = net.createServer((socket) => {
    // Drain what the client sends, so the socket ends and server.close() can finish.
    socket.resume();
    socket.on('error', () => {});
    onConnection(socket);
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function httpServer(status) {
  const server = http.createServer((req, res) => {
    res.statusCode = req.url === '/readyz' ? status : 404;
    res.end();
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

/** A port that nothing listens on (bound once, then released). */
async function freePort() {
  const port = await tcpServer(() => {});
  await new Promise((resolve) => servers.pop().close(resolve));
  return port;
}

function tempRoot(files = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmp, name), content);
  }
  return tmp;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r()))));
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('doctor', () => {
  describe('happy paths', () => {
    it('finds .env', () => {
      expect(checkEnvFile(tempRoot({ '.env': 'A=1\n' }))).toEqual({
        ok: true,
        label: '.env found',
      });
    });

    it('accepts an SMTP server that greets with 220', async () => {
      const port = await tcpServer((socket) => socket.write('220 mailpit ESMTP\r\n'));
      expect(await checkSmtp('127.0.0.1', port)).toEqual({
        ok: true,
        label: `Mailpit SMTP answering at 127.0.0.1:${port}`,
      });
    });

    it('accepts a ready Mailpit web UI', async () => {
      const port = await httpServer(200);
      const result = await checkMailpitWeb(`http://127.0.0.1:${port}/`);
      expect(result).toEqual({
        ok: true,
        label: `Mailpit web UI ready at http://127.0.0.1:${port}`,
      });
    });

    it('reports a free port', async () => {
      const port = await freePort();
      expect(await checkPortFree(port, 'web')).toEqual({
        ok: true,
        label: `Port ${port} (web) is free`,
      });
    });

    it('prints ✓ lines, and ✗ lines with an indented hint', () => {
      expect(formatResult({ ok: true, label: 'fine' })).toBe('✓ fine');
      expect(formatResult({ ok: false, label: 'broken', hint: 'fix it' })).toBe(
        '✗ broken\n    → fix it',
      );
    });
  });

  describe('edge cases', () => {
    it('reads .env and lets the shell environment override it', () => {
      const root = tempRoot({ '.env': 'SMTP_PORT=1025\nAPI_PORT=4000\n' });
      expect(loadDoctorEnv(root, { API_PORT: '4100' })).toMatchObject({
        SMTP_PORT: '1025',
        API_PORT: '4100',
      });
    });

    it('works without a .env file', () => {
      expect(loadDoctorEnv(tempRoot(), { A: '1' })).toEqual({ A: '1' });
    });

    it('fails an SMTP port that accepts connections but never greets', async () => {
      const port = await tcpServer(() => {});
      const result = await checkSmtp('127.0.0.1', port, { timeoutMs: 200 });
      expect(result.ok).toBe(false);
      expect(result.label).toBe(`Mailpit SMTP at 127.0.0.1:${port} sent no greeting`);
    });

    it('fails a port that something already listens on, with a hint to find the process', async () => {
      const port = await tcpServer(() => {});
      const result = await checkPortFree(port, 'API', { platform: 'linux' });
      expect(result).toEqual({
        ok: false,
        label: `Port ${port} (API) is in use`,
        hint: `Is pnpm dev already running? Otherwise find the process with: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      });
      expect((await checkPortFree(port, 'API', { platform: 'win32' })).hint).toContain(
        `netstat -ano | findstr :${port}`,
      );
    });
  });

  describe('error cases', () => {
    it('reports a missing .env with a hint', () => {
      expect(checkEnvFile(tempRoot())).toEqual({
        ok: false,
        label: '.env is missing',
        hint: 'Copy .env.example to .env in the repository root and fill it in.',
      });
    });

    it('reports a missing or invalid DATABASE_URL', async () => {
      expect((await checkPostgres(undefined)).label).toBe('Postgres: DATABASE_URL is not set');
      expect((await checkPostgres('not a url')).label).toBe(
        'Postgres: DATABASE_URL is not a valid URL',
      );
    });

    it('reports an unreachable Postgres with the start hint and without the password', async () => {
      const port = await freePort();
      const result = await checkPostgres(`postgresql://alias:secret-pw@127.0.0.1:${port}/alias`);
      expect(result).toEqual({
        ok: false,
        label: `Postgres not reachable at 127.0.0.1:${port} (ECONNREFUSED)`,
        hint: 'Is Postgres running? Start the services with: docker compose up -d --wait',
      });
      expect(JSON.stringify(result)).not.toContain('secret-pw');
    });

    it('reports a refused SMTP connection', async () => {
      const port = await freePort();
      const result = await checkSmtp('127.0.0.1', port);
      expect(result.ok).toBe(false);
      expect(result.label).toBe(`Mailpit SMTP not reachable at 127.0.0.1:${port} (ECONNREFUSED)`);
      expect(result.hint).toContain('docker compose up -d --wait');
    });

    it('reports a non-SMTP service on the SMTP port', async () => {
      const port = await tcpServer((socket) => socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'));
      expect((await checkSmtp('127.0.0.1', port)).label).toBe(
        `Something other than SMTP is listening at 127.0.0.1:${port}`,
      );
    });

    it('reports a Mailpit web UI that is not ready or not reachable', async () => {
      const notReady = await httpServer(503);
      expect((await checkMailpitWeb(`http://127.0.0.1:${notReady}`)).label).toBe(
        `Mailpit web UI at http://127.0.0.1:${notReady} answered HTTP 503`,
      );
      const closed = await freePort();
      const result = await checkMailpitWeb(`http://127.0.0.1:${closed}`);
      expect(result.ok).toBe(false);
      expect(result.label).toBe(
        `Mailpit web UI not reachable at http://127.0.0.1:${closed} (ECONNREFUSED)`,
      );
    });
  });
});

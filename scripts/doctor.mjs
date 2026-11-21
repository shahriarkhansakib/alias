#!/usr/bin/env node
/**
 * pnpm dev:doctor: checks that the local development environment is ready and prints one ✓/✗ line
 * per check, with a hint for each failure. Exits with code 1 if any check fails.
 *
 * Checks: .env exists, Postgres answers `SELECT 1`, Mailpit SMTP greets, the Mailpit web UI is
 * ready, and the web (3000) and API (API_PORT, default 4000) ports are free.
 *
 * Values come from .env (parsed, never printed), overridden by the shell environment. Output
 * shows host:port only, never connection strings or secrets.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START_SERVICES = 'Start the services with: docker compose up -d --wait';

const pass = (label) => ({ ok: true, label });
const fail = (label, hint) => ({ ok: false, label, hint });

/** Variables from <root>/.env (if any), overridden by `processEnv`. */
export function loadDoctorEnv(root, processEnv = process.env) {
  const file = path.join(root, '.env');
  const fromFile = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
  return { ...fromFile, ...processEnv };
}

export function checkEnvFile(root) {
  return fs.existsSync(path.join(root, '.env'))
    ? pass('.env found')
    : fail('.env is missing', 'Copy .env.example to .env in the repository root and fill it in.');
}

function hostPort(urlString, defaultPort) {
  const url = new URL(urlString);
  return { host: url.hostname, port: Number(url.port || defaultPort) };
}

export async function checkPostgres(databaseUrl, { root = ROOT, timeoutMs = 3000 } = {}) {
  if (!databaseUrl) {
    return fail(
      'Postgres: DATABASE_URL is not set',
      'Set DATABASE_URL in .env (see .env.example).',
    );
  }
  let target;
  try {
    const { host, port } = hostPort(databaseUrl, 5432);
    target = `${host}:${port}`;
  } catch {
    return fail(
      'Postgres: DATABASE_URL is not a valid URL',
      'Use postgresql://user:password@host:port/db',
    );
  }

  let pg;
  try {
    pg = createRequire(path.join(root, 'apps/api/package.json'))('pg');
  } catch {
    return fail('Postgres: cannot load the pg driver', 'Run pnpm install first.');
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return pass(`Postgres reachable at ${target}`);
  } catch (error) {
    const code = error?.code ?? 'unknown error';
    const hints = {
      ECONNREFUSED: `Is Postgres running? ${START_SERVICES}`,
      ETIMEDOUT: `Is Postgres running? ${START_SERVICES}`,
      ENOTFOUND: 'Check the host name in DATABASE_URL.',
      '28P01': 'Check the user name and password in DATABASE_URL against docker-compose.yml.',
      '3D000': 'Check the database name in DATABASE_URL against POSTGRES_DB in docker-compose.yml.',
    };
    const reason = /timeout/i.test(error?.message ?? '') ? 'timed out' : code;
    return fail(
      `Postgres not reachable at ${target} (${reason})`,
      hints[code] ?? hints[reason === 'timed out' ? 'ETIMEDOUT' : ''] ?? START_SERVICES,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

/** Connects and waits for the SMTP greeting ("220 ..."). */
export function checkSmtp(host, port, { timeoutMs = 3000 } = {}) {
  const target = `${host}:${port}`;
  const hint = `${START_SERVICES}. SMTP_PORT must match Mailpit's SMTP port (docker compose port mailpit 1025).`;
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => done(fail(`Mailpit SMTP at ${target} sent no greeting`, hint)),
      timeoutMs,
    );
    socket.once('data', (chunk) => {
      const line = chunk.toString('utf8');
      if (line.startsWith('220')) {
        socket.write('QUIT\r\n');
        done(pass(`Mailpit SMTP answering at ${target}`));
      } else {
        done(fail(`Something other than SMTP is listening at ${target}`, hint));
      }
    });
    socket.once('error', (error) =>
      done(fail(`Mailpit SMTP not reachable at ${target} (${error.code ?? error.message})`, hint)),
    );
  });
}

export async function checkMailpitWeb(baseUrl, { timeoutMs = 3000 } = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const hint = `${START_SERVICES}. MAILPIT_API_URL must match the web UI port (docker compose port mailpit 8025).`;
  try {
    const response = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok
      ? pass(`Mailpit web UI ready at ${base}`)
      : fail(`Mailpit web UI at ${base} answered HTTP ${response.status}`, hint);
  } catch (error) {
    const code = error?.cause?.code ?? error?.name ?? 'error';
    return fail(`Mailpit web UI not reachable at ${base} (${code})`, hint);
  }
}

/** True if something accepts connections on localhost:port (IPv4 or IPv6). */
function isListening(port, timeoutMs) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const finish = (value) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then((r) => r.some(Boolean));
}

export async function checkPortFree(
  port,
  name,
  { timeoutMs = 1000, platform = process.platform } = {},
) {
  if (!(await isListening(port, timeoutMs))) return pass(`Port ${port} (${name}) is free`);
  const find =
    platform === 'win32'
      ? `netstat -ano | findstr :${port}`
      : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
  return fail(
    `Port ${port} (${name}) is in use`,
    `Is pnpm dev already running? Otherwise find the process with: ${find}`,
  );
}

export async function runChecks({ root = ROOT, processEnv = process.env, timeoutMs } = {}) {
  const env = loadDoctorEnv(root, processEnv);
  const options = timeoutMs ? { timeoutMs } : {};
  return [
    checkEnvFile(root),
    await checkPostgres(env.DATABASE_URL, { root, ...options }),
    await checkSmtp(env.SMTP_HOST || '127.0.0.1', Number(env.SMTP_PORT || 1025), options),
    await checkMailpitWeb(env.MAILPIT_API_URL || 'http://127.0.0.1:8025', options),
    await checkPortFree(Number(env.PORT || 3000), 'web'),
    await checkPortFree(Number(env.API_PORT || 4000), 'API'),
  ];
}

export function formatResult(result, color = false) {
  const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  return result.ok
    ? `${paint(32, '✓')} ${result.label}`
    : `${paint(31, '✗')} ${result.label}\n    → ${result.hint}`;
}

async function main() {
  // hasColors() is false when stdout is not a terminal and honours NO_COLOR / FORCE_COLOR.
  const color = Boolean(process.stdout.hasColors?.());
  const results = await runChecks();
  for (const result of results) console.log(formatResult(result, color));
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? '\nAll checks passed.'
      : `\n${failed} of ${results.length} checks failed. Fix them and run pnpm dev:doctor again.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

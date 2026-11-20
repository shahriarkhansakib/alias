import { describe, expect, it } from 'vitest';
import {
  type CommandResult,
  type RebuildDeps,
  RebuildError,
  type RebuildOptions,
  rebuildLocalDatabase,
} from './rebuild.js';

const OPTIONS: RebuildOptions = {
  databaseUrl: 'postgresql://alias:secret@localhost:5432/alias',
  nodeEnv: 'development',
  yes: false,
  smtpPort: 1025,
  mailpitApiUrl: 'http://127.0.0.1:8025',
};

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });

/** Default answers for every docker command the rebuild runs. */
function dockerResponses(): Record<string, CommandResult> {
  return {
    'docker info --format {{.ServerVersion}}': ok('29.0.1\n'),
    'docker compose config --format json': ok(JSON.stringify({ name: 'alias' })),
    'docker compose ps -a --format {{.Name}}': ok('alias-postgres-1\nalias-mailpit-1\n'),
    'docker volume ls --filter label=com.docker.compose.project=alias --format {{.Name}}':
      ok('alias_postgres_data\n'),
    'docker compose down -v --remove-orphans': ok(),
    'docker compose up -d --wait': ok(),
    'docker compose port postgres 5432': ok('0.0.0.0:5432\n'),
    'docker compose port mailpit 1025': ok('0.0.0.0:1025\n'),
    'docker compose port mailpit 8025': ok('0.0.0.0:8025\n'),
  };
}

/** Fake dependencies that record every call, in order, in `calls`. */
function fakeDeps(
  overrides: {
    responses?: Record<string, CommandResult>;
    answer?: string | null;
    demoScript?: boolean;
    waitForPostgres?: () => Promise<void>;
  } = {},
) {
  const calls: string[] = [];
  const output: string[] = [];
  const responses = { ...dockerResponses(), ...overrides.responses };
  const deps: RebuildDeps = {
    async run(command, args) {
      const key = [command, ...args].join(' ');
      calls.push(key);
      const response = responses[key];
      if (!response) throw new Error(`unexpected command: ${key}`);
      return response;
    },
    async ask(question) {
      calls.push(`ask: ${question}`);
      return overrides.answer === undefined ? 'yes' : overrides.answer;
    },
    async waitForPostgres() {
      calls.push('waitForPostgres');
      await overrides.waitForPostgres?.();
    },
    async applyMigrations() {
      calls.push('applyMigrations');
    },
    async seedMandatoryData(_url, onSeeded) {
      calls.push('seedMandatoryData');
      onSeeded('system roles and permissions');
    },
    hasRootScript: (name) => name === 'seed:demo' && Boolean(overrides.demoScript),
    print: (line) => output.push(line),
  };
  return { deps, calls, output };
}

const DESTRUCTIVE = ['docker compose down -v --remove-orphans', 'docker compose up -d --wait'];

describe('rebuildLocalDatabase (pnpm db:reset)', () => {
  describe('happy paths', () => {
    it('runs every step in order after the user types yes', async () => {
      const { deps, calls } = fakeDeps();
      await expect(rebuildLocalDatabase(OPTIONS, deps)).resolves.toBe('rebuilt');
      expect(calls).toEqual([
        'docker info --format {{.ServerVersion}}',
        'docker compose config --format json',
        'docker compose ps -a --format {{.Name}}',
        'docker volume ls --filter label=com.docker.compose.project=alias --format {{.Name}}',
        'ask: Type yes to continue: ',
        'docker compose down -v --remove-orphans',
        'docker compose up -d --wait',
        'waitForPostgres',
        'applyMigrations',
        'seedMandatoryData',
        'docker compose port postgres 5432',
        'docker compose port mailpit 1025',
        'docker compose port mailpit 8025',
      ]);
    });

    it('prints one ✓ line per step, what it deletes, and a summary', async () => {
      const { deps, output } = fakeDeps();
      await rebuildLocalDatabase(OPTIONS, deps);
      expect(output).toEqual([
        '✓ Target is a local database (localhost:5432)',
        '✓ Docker is running (server 29.0.1)',
        'This deletes everything in the Docker Compose project "alias":',
        '  containers: alias-postgres-1, alias-mailpit-1',
        '  volumes:    alias_postgres_data (all local database data)',
        '✓ Confirmed',
        '✓ Removed containers and volumes',
        '✓ Started Postgres and Mailpit',
        '✓ Postgres accepts connections',
        '✓ Applied migrations',
        '✓ Seeded system roles and permissions',
        '',
        '✓ Done. Local database rebuilt.',
        '  Postgres      localhost:5432',
        '  Mailpit SMTP  localhost:1025',
        '  Mailpit web   http://localhost:8025',
        '  Seeded        mandatory data only (system roles and permissions)',
      ]);
    });

    it('skips the question with --yes', async () => {
      const { deps, calls, output } = fakeDeps();
      await rebuildLocalDatabase({ ...OPTIONS, yes: true }, deps);
      expect(calls.some((c) => c.startsWith('ask:'))).toBe(false);
      expect(output).toContain('✓ Confirmed with --yes');
      expect(calls).toContain('docker compose down -v --remove-orphans');
    });
  });

  describe('edge cases', () => {
    it('mentions pnpm seed:demo only when that script exists', async () => {
      const without = fakeDeps();
      await rebuildLocalDatabase(OPTIONS, without.deps);
      expect(without.output.join('\n')).not.toContain('seed:demo');

      const withDemo = fakeDeps({ demoScript: true });
      await rebuildLocalDatabase(OPTIONS, withDemo.deps);
      expect(withDemo.output).toContain('  Demo accounts run pnpm seed:demo');
    });

    it('accepts 127.0.0.1 and ::1 as local hosts', async () => {
      for (const host of ['127.0.0.1', '[::1]']) {
        const { deps } = fakeDeps();
        const url = `postgresql://alias:alias@${host}:5432/alias`;
        await expect(rebuildLocalDatabase({ ...OPTIONS, databaseUrl: url }, deps)).resolves.toBe(
          'rebuilt',
        );
      }
    });

    it('lists "none" when the project has no containers or volumes yet', async () => {
      const { deps, output } = fakeDeps({
        responses: {
          'docker compose ps -a --format {{.Name}}': ok(''),
          'docker volume ls --filter label=com.docker.compose.project=alias --format {{.Name}}':
            ok(''),
        },
      });
      await rebuildLocalDatabase(OPTIONS, deps);
      expect(output).toContain('  containers: none');
      expect(output).toContain('  volumes:    none (all local database data)');
    });

    it('uses the effective compose project name to find volumes', async () => {
      const { deps, calls } = fakeDeps({
        responses: {
          'docker compose config --format json': ok(JSON.stringify({ name: 'alias-test' })),
          'docker volume ls --filter label=com.docker.compose.project=alias-test --format {{.Name}}':
            ok(''),
        },
      });
      await rebuildLocalDatabase(OPTIONS, deps);
      expect(calls).toContain(
        'docker volume ls --filter label=com.docker.compose.project=alias-test --format {{.Name}}',
      );
    });

    it('warns when .env points at different ports than Docker maps', async () => {
      const { deps, output } = fakeDeps({
        responses: {
          'docker compose port mailpit 1025': ok('0.0.0.0:11025\n'),
          'docker compose port mailpit 8025': ok('[::]:18025\n'),
        },
      });
      await rebuildLocalDatabase(OPTIONS, deps);
      expect(output).toContain('  Mailpit web   http://localhost:18025');
      expect(output).toContain(
        '  ⚠ SMTP_PORT uses port 1025, but Docker maps it to 11025. Update .env.',
      );
      expect(output).toContain(
        '  ⚠ MAILPIT_API_URL uses port 8025, but Docker maps it to 18025. Update .env.',
      );
      expect(output.join('\n')).not.toContain('DATABASE_URL uses');
    });

    it('never prints the database password', async () => {
      const { deps, output } = fakeDeps();
      await rebuildLocalDatabase(OPTIONS, deps);
      expect(output.join('\n')).not.toContain('secret');
    });
  });

  describe('error cases', () => {
    it('refuses NODE_ENV=production before touching Docker', async () => {
      const { deps, calls } = fakeDeps();
      await expect(
        rebuildLocalDatabase({ ...OPTIONS, nodeEnv: 'production' }, deps),
      ).rejects.toThrow(new RebuildError('Refusing db:reset when NODE_ENV=production'));
      expect(calls).toEqual([]);
    });

    it('refuses a non-local DATABASE_URL before touching Docker', async () => {
      const { deps, calls } = fakeDeps();
      const remote = 'postgresql://alias:alias@db.example.com:5432/alias';
      await expect(rebuildLocalDatabase({ ...OPTIONS, databaseUrl: remote }, deps)).rejects.toThrow(
        'Refusing db:reset against non-local database host "db.example.com"',
      );
      expect(calls).toEqual([]);
    });

    it('stops with a clear message when Docker is not running', async () => {
      const { deps, calls } = fakeDeps({
        responses: {
          'docker info --format {{.ServerVersion}}': {
            code: 1,
            stdout: '',
            stderr: 'Cannot connect to the Docker daemon',
          },
        },
      });
      await expect(rebuildLocalDatabase(OPTIONS, deps)).rejects.toThrow(
        'Docker is not running. Start Docker Desktop (or the Docker service) and run pnpm db:reset again.',
      );
      expect(calls).toEqual(['docker info --format {{.ServerVersion}}']);
    });

    it('stops when Docker is not installed', async () => {
      const { deps } = fakeDeps({
        responses: {
          'docker info --format {{.ServerVersion}}': {
            code: null,
            stdout: '',
            stderr: 'spawn docker ENOENT',
          },
        },
      });
      await expect(rebuildLocalDatabase(OPTIONS, deps)).rejects.toThrow(
        'Docker is not installed or not on PATH',
      );
    });

    it('changes nothing when the answer is not "yes"', async () => {
      for (const answer of ['no', 'y', '']) {
        const { deps, calls, output } = fakeDeps({ answer });
        await expect(rebuildLocalDatabase(OPTIONS, deps)).resolves.toBe('cancelled');
        expect(output.at(-1)).toBe('Cancelled. Nothing was changed.');
        for (const command of DESTRUCTIVE) expect(calls).not.toContain(command);
      }
    });

    it('refuses without a terminal unless --yes is given', async () => {
      const { deps, calls } = fakeDeps({ answer: null });
      await expect(rebuildLocalDatabase(OPTIONS, deps)).rejects.toThrow(
        'Cannot ask for confirmation without a terminal. Re-run with --yes: pnpm db:reset --yes',
      );
      for (const command of DESTRUCTIVE) expect(calls).not.toContain(command);
    });

    it('stops before starting containers when docker compose down fails', async () => {
      const { deps, calls } = fakeDeps({
        responses: {
          'docker compose down -v --remove-orphans': {
            code: 1,
            stdout: '',
            stderr: 'Error response from daemon: volume is in use\n',
          },
        },
      });
      await expect(rebuildLocalDatabase(OPTIONS, deps)).rejects.toThrow(
        'docker compose down -v failed: Error response from daemon: volume is in use',
      );
      expect(calls).not.toContain('docker compose up -d --wait');
      expect(calls).not.toContain('applyMigrations');
    });

    it('does not migrate when Postgres never accepts connections', async () => {
      const { deps, calls } = fakeDeps({
        waitForPostgres: async () => {
          throw new RebuildError('Postgres did not accept connections within 30 s.');
        },
      });
      await expect(rebuildLocalDatabase(OPTIONS, deps)).rejects.toThrow(
        'Postgres did not accept connections within 30 s.',
      );
      expect(calls).not.toContain('applyMigrations');
      expect(calls).not.toContain('seedMandatoryData');
    });
  });
});

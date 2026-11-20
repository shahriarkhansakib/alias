/**
 * pnpm db:reset: rebuilds the local development database from scratch.
 *
 *   1. refuses unless NODE_ENV is not production and DATABASE_URL points at this machine
 *   2. checks that Docker is running
 *   3. lists this compose project's containers and volumes and asks "Type yes to continue"
 *      (skipped with --yes; refused without a terminal)
 *   4. docker compose down -v, then docker compose up -d --wait (this project only)
 *   5. waits for Postgres, applies migrations and the mandatory seed data (never demo data)
 *   6. prints the Postgres and Mailpit addresses Docker actually uses
 *
 * The steps take their side effects (docker, prompt, database, output) as dependencies, so unit
 * tests can check the safety rules and the step order without Docker.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../shared/env.js';
import { createDatabase } from './client.js';
import { describeDatabaseError } from './connection-error.js';
import { MANDATORY_SEEDS, seedMandatoryData } from './mandatory-seeds.js';
import { applyMigrations } from './migrate.js';
import { assertSafeLocalReset } from './reset-schema.js';

export interface CommandResult {
  /** Exit code; null when the program could not be started (e.g. not installed). */
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RebuildDeps {
  /** Runs a command from the repository root. Never throws; failures are in the result. */
  run(command: string, args: string[]): Promise<CommandResult>;
  /** Asks the question; resolves to the answer, or null when there is no terminal to ask in. */
  ask(question: string): Promise<string | null>;
  waitForPostgres(databaseUrl: string): Promise<void>;
  applyMigrations(databaseUrl: string): Promise<void>;
  seedMandatoryData(databaseUrl: string, onSeeded: (name: string) => void): Promise<void>;
  /** True if the root package.json defines this script (used for the seed:demo hint). */
  hasRootScript(name: string): boolean;
  print(line: string): void;
}

export interface RebuildOptions {
  databaseUrl: string;
  nodeEnv: string | undefined;
  yes: boolean;
  smtpPort: number;
  mailpitApiUrl: string | undefined;
}

/** A failure the user can act on; printed as one ✗ line without a stack trace. */
export class RebuildError extends Error {}

const DOCKER_HINT =
  'Docker is not running. Start Docker Desktop (or the Docker service) and run pnpm db:reset again.';

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function lastLine(result: CommandResult): string {
  return lines(`${result.stderr}\n${result.stdout}`).at(-1) ?? `exit code ${result.code}`;
}

/** "0.0.0.0:5432" or "[::]:5432" from `docker compose port` -> "localhost:5432". */
function localAddress(portOutput: string): string | null {
  const port = lines(portOutput)[0]?.match(/:(\d+)$/)?.[1];
  return port ? `localhost:${port}` : null;
}

function urlPort(url: string | undefined, fallback: number): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return Number(parsed.port || fallback);
  } catch {
    return null;
  }
}

export async function rebuildLocalDatabase(
  options: RebuildOptions,
  deps: RebuildDeps,
): Promise<'rebuilt' | 'cancelled'> {
  const { print } = deps;
  const docker = async (args: string[], failure: string): Promise<string> => {
    const result = await deps.run('docker', args);
    if (result.code !== 0) throw new RebuildError(`${failure}: ${lastLine(result)}`);
    return result.stdout;
  };

  // 1. Safety
  try {
    assertSafeLocalReset(options.databaseUrl, options.nodeEnv, 'db:reset');
  } catch (error) {
    throw new RebuildError((error as Error).message);
  }
  const target = new URL(options.databaseUrl);
  print(`✓ Target is a local database (${target.hostname}:${target.port || '5432'})`);

  // 2. Docker
  const info = await deps.run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (info.code === null) {
    throw new RebuildError('Docker is not installed or not on PATH. Install Docker Desktop first.');
  }
  if (info.code !== 0) throw new RebuildError(DOCKER_HINT);
  print(`✓ Docker is running (server ${lines(info.stdout)[0] ?? 'unknown'})`);

  // 3. Show what will be deleted, then confirm
  const config = JSON.parse(
    await docker(['compose', 'config', '--format', 'json'], 'Could not read docker-compose.yml'),
  ) as { name?: string };
  const project = config.name ?? 'alias';
  const containers = lines(
    await docker(['compose', 'ps', '-a', '--format', '{{.Name}}'], 'Could not list containers'),
  );
  const volumes = lines(
    await docker(
      [
        'volume',
        'ls',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--format',
        '{{.Name}}',
      ],
      'Could not list volumes',
    ),
  );
  print(`This deletes everything in the Docker Compose project "${project}":`);
  print(`  containers: ${containers.length ? containers.join(', ') : 'none'}`);
  print(`  volumes:    ${volumes.length ? volumes.join(', ') : 'none'} (all local database data)`);

  if (options.yes) {
    print('✓ Confirmed with --yes');
  } else {
    const answer = await deps.ask('Type yes to continue: ');
    if (answer === null) {
      throw new RebuildError(
        'Cannot ask for confirmation without a terminal. Re-run with --yes: pnpm db:reset --yes',
      );
    }
    if (answer.trim().toLowerCase() !== 'yes') {
      print('Cancelled. Nothing was changed.');
      return 'cancelled';
    }
    print('✓ Confirmed');
  }

  // 4. Recreate containers and volumes
  await docker(['compose', 'down', '-v', '--remove-orphans'], 'docker compose down -v failed');
  print('✓ Removed containers and volumes');
  await docker(['compose', 'up', '-d', '--wait'], 'docker compose up -d --wait failed');
  print('✓ Started Postgres and Mailpit');

  // 5. Database
  await deps.waitForPostgres(options.databaseUrl);
  print('✓ Postgres accepts connections');
  await deps.applyMigrations(options.databaseUrl);
  print('✓ Applied migrations');
  await deps.seedMandatoryData(options.databaseUrl, (name) => print(`✓ Seeded ${name}`));

  // 6. Summary
  const portOf = async (service: string, port: number) =>
    localAddress((await deps.run('docker', ['compose', 'port', service, String(port)])).stdout);
  const postgres = await portOf('postgres', 5432);
  const smtp = await portOf('mailpit', 1025);
  const web = await portOf('mailpit', 8025);

  print('');
  print('✓ Done. Local database rebuilt.');
  print(`  Postgres      ${postgres ?? 'unknown'}`);
  print(`  Mailpit SMTP  ${smtp ?? 'unknown'}`);
  print(`  Mailpit web   ${web ? `http://${web}` : 'unknown'}`);
  print(`  Seeded        mandatory data only (${MANDATORY_SEEDS.map((s) => s.name).join(', ')})`);
  if (deps.hasRootScript('seed:demo')) print('  Demo accounts run pnpm seed:demo');

  const mismatches = [
    [postgres, urlPort(options.databaseUrl, 5432), 'DATABASE_URL'],
    [smtp, options.smtpPort, 'SMTP_PORT'],
    [web, urlPort(options.mailpitApiUrl, 8025), 'MAILPIT_API_URL'],
  ] as const;
  for (const [address, configured, variable] of mismatches) {
    const actual = address ? Number(address.split(':')[1]) : null;
    if (actual !== null && configured !== null && actual !== configured) {
      print(
        `  ⚠ ${variable} uses port ${configured}, but Docker maps it to ${actual}. Update .env.`,
      );
    }
  }
  return 'rebuilt';
}

// ---------------------------------------------------------------------------------------------
// Real dependencies and entry point
// ---------------------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ code: null, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function askInTerminal(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function waitForPostgres(databaseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const database = createDatabase(databaseUrl);
    try {
      await database.ping();
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new RebuildError(
          `Postgres did not accept connections within ${timeoutMs / 1000} s. ${describeDatabaseError(error, databaseUrl)}`,
        );
      }
    } finally {
      await database.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function withDatabase(
  databaseUrl: string,
  fn: (db: ReturnType<typeof createDatabase>['db']) => Promise<void>,
): Promise<void> {
  const database = createDatabase(databaseUrl);
  try {
    await fn(database.db);
  } finally {
    await database.close();
  }
}

function hasRootScript(name: string): boolean {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return Boolean(pkg.scripts?.[name]);
}

async function main() {
  const env = loadEnv();
  const result = await rebuildLocalDatabase(
    {
      databaseUrl: env.databaseUrl,
      nodeEnv: process.env.NODE_ENV ?? env.nodeEnv,
      yes: process.argv.includes('--yes') || process.argv.includes('-y'),
      smtpPort: env.smtpPort,
      mailpitApiUrl: process.env.MAILPIT_API_URL,
    },
    {
      run: runCommand,
      ask: askInTerminal,
      waitForPostgres: (url) => waitForPostgres(url),
      applyMigrations: (url) => withDatabase(url, applyMigrations),
      seedMandatoryData: (url, onSeeded) =>
        withDatabase(url, (db) => seedMandatoryData(db, onSeeded)),
      hasRootScript,
      print: (line) => console.log(line),
    },
  );
  process.exit(result === 'rebuilt' ? 0 : 1);
}

const isEntryPoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error: unknown) => {
    const message =
      error instanceof RebuildError
        ? error.message
        : describeDatabaseError(error, process.env.DATABASE_URL);
    console.error(`✗ ${message}`);
    process.exit(1);
  });
}

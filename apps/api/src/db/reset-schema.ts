import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../shared/env.js';
import { createDatabase } from './client.js';
import { describeDatabaseError } from './connection-error.js';
import { seedMandatoryData } from './mandatory-seeds.js';
import { applyMigrations } from './migrate.js';

const ALLOWED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Throws unless the target is a local, non-production database. */
export function assertSafeLocalReset(
  databaseUrl: string,
  nodeEnv: string | undefined,
  command = 'db:reset:schema',
): void {
  if (nodeEnv === 'production') {
    throw new Error(`Refusing ${command} when NODE_ENV=production`);
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error(`Refusing ${command}: DATABASE_URL is not a valid URL`);
  }

  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing ${command} against non-local database host "${hostname}". Allowed hosts: localhost, 127.0.0.1, ::1.`,
    );
  }
}

export async function resetLocalDatabase(databaseUrl: string): Promise<void> {
  assertSafeLocalReset(databaseUrl, process.env.NODE_ENV);
  const database = createDatabase(databaseUrl);

  try {
    await database.pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await database.pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await database.pool.query('CREATE SCHEMA public');
    await applyMigrations(database.db);
    await seedMandatoryData(database.db);
  } finally {
    await database.close();
  }
}

async function main() {
  const env = loadEnv();
  assertSafeLocalReset(env.databaseUrl, process.env.NODE_ENV ?? env.nodeEnv);
  await resetLocalDatabase(env.databaseUrl);
  console.log('Schema reset, migrations and mandatory seed data completed.');
}

const isEntryPoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(`Schema reset failed: ${describeDatabaseError(error, process.env.DATABASE_URL)}`);
    process.exit(1);
  });
}

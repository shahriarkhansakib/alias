import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../shared/env.js';
import { createDatabase } from './client.js';
import { seedSystemRoles } from './seed-roles.js';

const ALLOWED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertSafeLocalReset(databaseUrl: string, nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') {
    throw new Error('Refusing db:reset when NODE_ENV=production');
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('Refusing db:reset: DATABASE_URL is not a valid URL');
  }

  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing db:reset against non-local database host "${hostname}". Allowed hosts: localhost, 127.0.0.1, ::1.`,
    );
  }
}

export async function resetLocalDatabase(databaseUrl: string): Promise<void> {
  assertSafeLocalReset(databaseUrl, process.env.NODE_ENV);
  const database = createDatabase(databaseUrl);
  const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');

  try {
    await database.pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await database.pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await database.pool.query('CREATE SCHEMA public');
    await migrate(database.db, { migrationsFolder });
    await seedSystemRoles(database.db);
  } finally {
    await database.close();
  }
}

async function main() {
  const env = loadEnv();
  assertSafeLocalReset(env.databaseUrl, process.env.NODE_ENV ?? env.nodeEnv);
  await resetLocalDatabase(env.databaseUrl);
  console.log('Local database reset, migrations, and system role seed completed.');
}

const isEntryPoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error('Database reset failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

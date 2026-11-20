import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../shared/env.js';
import { createDatabase } from './client.js';
import { describeDatabaseError } from './connection-error.js';
import { seedMandatoryData } from './mandatory-seeds.js';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

/** Applies every pending migration from apps/api/drizzle. */
export async function applyMigrations(db: NodePgDatabase<Record<string, unknown>>): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Applies pending migrations, then the mandatory seed data. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl);

  try {
    await applyMigrations(database.db);
    await seedMandatoryData(database.db);
  } finally {
    await database.close();
  }
}

async function main() {
  const env = loadEnv();
  await runMigrations(env.databaseUrl);
  console.log('Database migrations and mandatory seed data completed.');
}

const isEntryPoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(`Migration failed: ${describeDatabaseError(error, process.env.DATABASE_URL)}`);
    process.exit(1);
  });
}

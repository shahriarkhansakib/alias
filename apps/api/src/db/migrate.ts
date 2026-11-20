import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../shared/env.js';
import { createDatabase } from './client.js';
import { describeDatabaseError } from './connection-error.js';
import { seedSystemRoles } from './seed-roles.js';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl);
  const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');

  try {
    await migrate(database.db, { migrationsFolder });
    await seedSystemRoles(database.db);
  } finally {
    await database.close();
  }
}

async function main() {
  const env = loadEnv();
  await runMigrations(env.databaseUrl);
  console.log('Database migrations and system role seed completed.');
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

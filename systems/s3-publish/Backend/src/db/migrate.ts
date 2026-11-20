import fs from 'fs';
import path from 'path';
import { getDbPool } from './index';

export async function runMigrations(): Promise<void> {
  const pool = getDbPool();
  if (!pool) {
    console.log('[Migrations] DATABASE_URL not set. Skipping SQL migrations.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('[Migrations] No migrations directory found.');
      return;
    }

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const existing = await client.query('SELECT name FROM schema_migrations WHERE name = $1', [file]);
      if (existing.rowCount === 0) {
        console.log(`[Migrations] Executing migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[Migrations] Successfully executed: ${file}`);
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrations] Error running migrations:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[Migrations] Migration process completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migrations] Migration process failed:', err);
      process.exit(1);
    });
}

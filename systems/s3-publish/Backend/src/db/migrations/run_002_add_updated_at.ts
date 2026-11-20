/**
 * Migration 002: Add updated_at column to posts table (idempotent).
 * Run once: npx ts-node src/db/migrations/run_002_add_updated_at.ts
 */
import { getDbPool } from '../index';
import '../../config/env'; // triggers dotenv load

async function run() {
  const pool = getDbPool();
  if (!pool) {
    console.error('No DB pool — check DATABASE_URL in .env');
    process.exit(1);
  }

  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'posts'
            AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE posts
            ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
          RAISE NOTICE 'Column updated_at added to posts.';
        ELSE
          RAISE NOTICE 'Column updated_at already exists on posts.';
        END IF;
      END $$;
    `);

    // Backfill updated_at = created_at for rows that have it null
    const res = await pool.query(`
      UPDATE posts
      SET updated_at = created_at
      WHERE updated_at IS NULL
    `);

    console.log('Migration 002 complete.');
    console.log(`Backfilled updated_at for ${res.rowCount} rows.`);
  } catch (err: any) {
    console.error('Migration 002 failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

let pool: Pool | null = null;

export function getDbPool(): Pool | null {
  if (process.env.NODE_ENV === 'test' && !process.env.TEST_DATABASE_URL) {
    return null;
  }

  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected error on idle client', err);
    });
  }

  return pool;
}

export async function query(text: string, params?: any[]) {
  const activePool = getDbPool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured.');
  }
  return activePool.query(text, params);
}

export async function getClient(): Promise<PoolClient> {
  const activePool = getDbPool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured.');
  }
  return activePool.connect();
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

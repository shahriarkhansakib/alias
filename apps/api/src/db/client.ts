import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { TransactionContext, UnitOfWork } from '../shared/ports.js';
import * as schema from './schema.js';

export type AppDatabase = NodePgDatabase<typeof schema>;

export function createDatabase(databaseUrl: string) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
  });

  const db = drizzle(pool, { schema });

  const unitOfWork: UnitOfWork = {
    async runInTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        return fn(tx as unknown as TransactionContext);
      });
    },

    async runWithAdvisoryLock<T>(
      lockKey: bigint,
      fn: (tx: TransactionContext) => Promise<T>,
    ): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey.toString()}::bigint)`);
        return fn(tx as unknown as TransactionContext);
      });
    },
  };

  return {
    pool,
    db: db as unknown as NodePgDatabase<Record<string, unknown>>,
    unitOfWork,
    async ping(): Promise<void> {
      await pool.query('SELECT 1');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { TransactionContext } from '../../../shared/ports.js';
import type { AuthUserLookupPort } from '../domain/ports.js';
import type { AuthUserRecord } from '../domain/types.js';
import { user } from './schema.js';

function resolveExecutor(
  db: NodePgDatabase<Record<string, unknown>>,
  tx?: TransactionContext,
): NodePgDatabase<Record<string, unknown>> {
  return (tx as unknown as NodePgDatabase<Record<string, unknown>> | undefined) ?? db;
}

export function createDrizzleAuthUserLookup(
  db: NodePgDatabase<Record<string, unknown>>,
): AuthUserLookupPort {
  return {
    async findByEmail(email: string, tx?: TransactionContext): Promise<AuthUserRecord | null> {
      const executor = resolveExecutor(db, tx);
      const normalized = email.trim().toLowerCase();
      const rows = await executor
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(eq(user.email, normalized))
        .limit(1);

      const row = rows[0];
      return row ?? null;
    },

    async findByIds(ids: string[], tx?: TransactionContext): Promise<AuthUserRecord[]> {
      if (ids.length === 0) {
        return [];
      }
      const executor = resolveExecutor(db, tx);
      return executor
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(inArray(user.id, ids));
    },
  };
}

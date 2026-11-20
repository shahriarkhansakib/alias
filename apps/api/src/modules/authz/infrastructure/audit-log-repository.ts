import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { generateId } from '../../../shared/id.js';
import type { TransactionContext } from '../../../shared/ports.js';
import type { AuditLogPort } from '../domain/ports.js';
import type { AuditLogEntry } from '../domain/types.js';
import { auditLogs } from './schema.js';

function resolveExecutor(
  db: NodePgDatabase<Record<string, unknown>>,
  tx?: TransactionContext,
): NodePgDatabase<Record<string, unknown>> {
  return (tx as unknown as NodePgDatabase<Record<string, unknown>> | undefined) ?? db;
}

export function createDrizzleAuditLogRepository(
  db: NodePgDatabase<Record<string, unknown>>,
): AuditLogPort {
  return {
    async append(entry: AuditLogEntry, tx?: TransactionContext): Promise<void> {
      const executor = resolveExecutor(db, tx);
      await executor.insert(auditLogs).values({
        id: generateId(),
        actorUserId: entry.actorUserId,
        actorType: entry.actorType,
        action: entry.action,
        outcome: entry.outcome,
        targetType: entry.targetType,
        targetId: entry.targetId,
        requestId: entry.requestId,
        metadata: entry.metadata ?? null,
        createdAt: new Date(),
      });
    },
  };
}

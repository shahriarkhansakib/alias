import { and, count, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { generateId } from '../../../shared/id.js';
import type { TransactionContext } from '../../../shared/ports.js';
import type {
  AuthorizationRepositoryPort,
  CreatePlatformRoleAssignmentInput,
  UpsertPlatformSecuritySettingsInput,
} from '../domain/ports.js';
import type {
  PlatformPermission,
  PlatformRoleAssignmentRecord,
  PlatformRoleAssignmentStatus,
  PlatformRoleKey,
  PlatformSecuritySettingsRecord,
  RoleRecord,
} from '../domain/types.js';
import {
  platformRoleAssignments,
  platformSecuritySettings,
  rolePermissions,
  roles,
} from './schema.js';

function resolveExecutor(
  db: NodePgDatabase<Record<string, unknown>>,
  tx?: TransactionContext,
): NodePgDatabase<Record<string, unknown>> {
  return (tx as unknown as NodePgDatabase<Record<string, unknown>> | undefined) ?? db;
}

function mapAssignmentRow(
  row: typeof platformRoleAssignments.$inferSelect,
): PlatformRoleAssignmentRecord {
  return {
    id: row.id,
    userId: row.userId,
    roleId: row.roleId,
    roleKey: row.roleKey as PlatformRoleKey,
    status: row.status as PlatformRoleAssignmentStatus,
    grantedByUserId: row.grantedByUserId,
    grantedReason: row.grantedReason,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleAuthorizationRepository(
  db: NodePgDatabase<Record<string, unknown>>,
): AuthorizationRepositoryPort {
  return {
    async findRoleByKey(
      roleKey: PlatformRoleKey,
      tx?: TransactionContext,
    ): Promise<RoleRecord | null> {
      const executor = resolveExecutor(db, tx);
      const rows = await executor.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        key: row.key as PlatformRoleKey,
        name: row.name,
        description: row.description,
        scope: row.scope as 'platform',
        hierarchyRank: row.hierarchyRank,
        isSystem: row.isSystem,
      };
    },

    async findRolePermissions(
      roleId: string,
      tx?: TransactionContext,
    ): Promise<PlatformPermission[]> {
      const executor = resolveExecutor(db, tx);
      const rows = await executor
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      return rows.map((row) => row.permission as PlatformPermission);
    },

    async findActivePlatformAssignmentByUserId(
      userId: string,
      tx?: TransactionContext,
    ): Promise<PlatformRoleAssignmentRecord | null> {
      const executor = resolveExecutor(db, tx);
      const rows = await executor
        .select()
        .from(platformRoleAssignments)
        .where(
          and(
            eq(platformRoleAssignments.userId, userId),
            eq(platformRoleAssignments.status, 'active'),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? mapAssignmentRow(row) : null;
    },

    async findActiveSuperAdmin(
      tx?: TransactionContext,
    ): Promise<PlatformRoleAssignmentRecord | null> {
      const executor = resolveExecutor(db, tx);
      const rows = await executor
        .select()
        .from(platformRoleAssignments)
        .where(
          and(
            eq(platformRoleAssignments.roleKey, 'super_admin'),
            eq(platformRoleAssignments.status, 'active'),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? mapAssignmentRow(row) : null;
    },

    async listPlatformAssignments(
      tx?: TransactionContext,
    ): Promise<PlatformRoleAssignmentRecord[]> {
      const executor = resolveExecutor(db, tx);
      const rows = await executor
        .select()
        .from(platformRoleAssignments)
        .orderBy(desc(platformRoleAssignments.createdAt));
      return rows.map(mapAssignmentRow);
    },

    async countActivePlatformAdmins(tx?: TransactionContext): Promise<number> {
      const executor = resolveExecutor(db, tx);
      const rows = await executor
        .select({ total: count() })
        .from(platformRoleAssignments)
        .where(eq(platformRoleAssignments.status, 'active'));
      return Number(rows[0]?.total ?? 0);
    },

    async createPlatformRoleAssignment(
      input: CreatePlatformRoleAssignmentInput,
      tx?: TransactionContext,
    ): Promise<PlatformRoleAssignmentRecord> {
      const executor = resolveExecutor(db, tx);
      const now = new Date();
      const rows = await executor
        .insert(platformRoleAssignments)
        .values({
          id: generateId(),
          userId: input.userId,
          roleId: input.roleId,
          roleKey: input.roleKey,
          status: 'active',
          grantedByUserId: input.grantedByUserId,
          grantedReason: input.grantedReason,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Failed to insert platform role assignment');
      }
      return mapAssignmentRow(row);
    },

    async findPlatformSecuritySettings(
      tx?: TransactionContext,
    ): Promise<PlatformSecuritySettingsRecord | null> {
      const executor = resolveExecutor(db, tx);
      const rows = await executor
        .select()
        .from(platformSecuritySettings)
        .where(eq(platformSecuritySettings.id, 'default'))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        requirePlatformMfa: row.requirePlatformMfa,
        updatedByUserId: row.updatedByUserId,
        updatedAt: row.updatedAt,
      };
    },

    async upsertPlatformSecuritySettings(
      input: UpsertPlatformSecuritySettingsInput,
      tx?: TransactionContext,
    ): Promise<PlatformSecuritySettingsRecord> {
      const executor = resolveExecutor(db, tx);
      const now = new Date();
      const rows = await executor
        .insert(platformSecuritySettings)
        .values({
          id: 'default',
          requirePlatformMfa: input.requirePlatformMfa,
          updatedByUserId: input.updatedByUserId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: platformSecuritySettings.id,
          set: {
            requirePlatformMfa: input.requirePlatformMfa,
            updatedByUserId: input.updatedByUserId,
            updatedAt: now,
          },
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Failed to upsert platform security settings');
      }
      return {
        id: row.id,
        requirePlatformMfa: row.requirePlatformMfa,
        updatedByUserId: row.updatedByUserId,
        updatedAt: row.updatedAt,
      };
    },
  };
}

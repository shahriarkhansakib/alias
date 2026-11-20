import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '../../authn/infrastructure/schema.js';

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  scope: text('scope').notNull().default('platform'),
  hierarchyRank: integer('hierarchy_rank').notNull(),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_role_permissions_role_permission').on(table.roleId, table.permission),
  ],
);

export const platformRoleAssignments = pgTable(
  'platform_role_assignments',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    grantedByUserId: uuid('granted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    grantedReason: text('granted_reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_platform_role_assignments_user_id').on(table.userId),
    uniqueIndex('uq_platform_role_assignments_active_user')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('uq_platform_role_assignments_single_active_super_admin')
      .on(table.roleKey)
      .where(sql`${table.roleKey} = 'super_admin' AND ${table.status} = 'active'`),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    outcome: text('outcome').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_action_created_at').on(table.action, table.createdAt),
    index('idx_audit_logs_actor_user_id').on(table.actorUserId),
  ],
);

export const platformSecuritySettings = pgTable(
  'platform_security_settings',
  {
    id: text('id').primaryKey().default('default'),
    requirePlatformMfa: boolean('require_platform_mfa').notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_platform_security_settings_updated_by_user_id').on(table.updatedByUserId)],
);

export const authzSchema = {
  roles,
  rolePermissions,
  platformRoleAssignments,
  platformSecuritySettings,
  auditLogs,
};

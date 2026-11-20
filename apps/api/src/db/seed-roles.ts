import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { generateId } from '../shared/id.js';
import { rolePermissions, roles } from './schema.js';

interface SystemRoleDefinition {
  key: 'super_admin' | 'platform_admin';
  name: string;
  description: string;
  hierarchyRank: number;
  permissions: readonly string[];
}

const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'super_admin',
    name: 'Super Administrator',
    description: 'Root platform administrator with full status visibility and admin provisioning.',
    hierarchyRank: 100,
    permissions: ['platform:status:read', 'platform:admins:manage'],
  },
  {
    key: 'platform_admin',
    name: 'Platform Administrator',
    description: 'Internal platform operator with platform status and admin roster visibility.',
    hierarchyRank: 50,
    permissions: ['platform:status:read'],
  },
];

export async function seedSystemRoles(db: NodePgDatabase<Record<string, unknown>>): Promise<void> {
  for (const roleDef of SYSTEM_ROLES) {
    const existingRows = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, roleDef.key))
      .limit(1);

    let roleId = existingRows[0]?.id;
    if (!roleId) {
      roleId = generateId();
      await db
        .insert(roles)
        .values({
          id: roleId,
          key: roleDef.key,
          name: roleDef.name,
          description: roleDef.description,
          scope: 'platform',
          hierarchyRank: roleDef.hierarchyRank,
          isSystem: true,
        })
        .onConflictDoNothing({ target: roles.key });

      const resolved = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, roleDef.key))
        .limit(1);
      roleId = resolved[0]?.id ?? roleId;
    }

    for (const permission of roleDef.permissions) {
      await db
        .insert(rolePermissions)
        .values({
          id: generateId(),
          roleId,
          permission,
        })
        .onConflictDoNothing({
          target: [rolePermissions.roleId, rolePermissions.permission],
        });
    }
  }
}

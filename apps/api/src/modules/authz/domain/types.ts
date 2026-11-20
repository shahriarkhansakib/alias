import type { AuthenticatedIdentity } from '../../authn/index.js';

export type PrincipalType = 'admin' | 'user';

export type PlatformRoleKey = 'super_admin' | 'platform_admin';

export type PlatformPermission = 'platform:status:read' | 'platform:admins:manage';

export type PlatformRoleAssignmentStatus = 'active' | 'revoked';

export interface RoleRecord {
  id: string;
  key: PlatformRoleKey;
  name: string;
  description: string | null;
  scope: 'platform';
  hierarchyRank: number;
  isSystem: boolean;
}

export interface PlatformRoleAssignmentRecord {
  id: string;
  userId: string;
  roleId: string;
  roleKey: PlatformRoleKey;
  status: PlatformRoleAssignmentStatus;
  grantedByUserId: string | null;
  grantedReason: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformSecuritySettingsRecord {
  id: string;
  requirePlatformMfa: boolean;
  updatedByUserId: string | null;
  updatedAt: Date;
}

export type AuthorizationScope =
  | { kind: 'customer' }
  | { kind: 'platform'; permission: PlatformPermission };

export interface AccessContext {
  principalType: PrincipalType;
  platformRoleKey: PlatformRoleKey | null;
  requirePlatformMfa: boolean;
  mfaRequired: boolean;
  user: AuthenticatedIdentity;
}

export interface ResolvedAccessState {
  accessContext: AccessContext;
  permissions: PlatformPermission[];
}

export interface AuditLogEntry {
  actorUserId: string | null;
  actorType: 'admin' | 'user' | 'system';
  action: string;
  outcome: 'success' | 'rejected' | 'noop';
  targetType: string;
  targetId: string | null;
  requestId: string | null;
  metadata?: Record<string, unknown>;
}

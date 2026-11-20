import type { TransactionContext } from '../../../shared/ports.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import type {
  AccessContext,
  AuditLogEntry,
  AuthorizationScope,
  PlatformPermission,
  PlatformRoleAssignmentRecord,
  PlatformRoleKey,
  PlatformSecuritySettingsRecord,
  ResolvedAccessState,
  RoleRecord,
} from './types.js';

export interface CreatePlatformRoleAssignmentInput {
  userId: string;
  roleId: string;
  roleKey: PlatformRoleKey;
  grantedByUserId: string | null;
  grantedReason: string | null;
}

export interface UpsertPlatformSecuritySettingsInput {
  requirePlatformMfa: boolean;
  updatedByUserId: string | null;
}

export interface AuthorizationRepositoryPort {
  findRoleByKey(roleKey: PlatformRoleKey, tx?: TransactionContext): Promise<RoleRecord | null>;
  findRolePermissions(roleId: string, tx?: TransactionContext): Promise<PlatformPermission[]>;
  findActivePlatformAssignmentByUserId(
    userId: string,
    tx?: TransactionContext,
  ): Promise<PlatformRoleAssignmentRecord | null>;
  findActiveSuperAdmin(tx?: TransactionContext): Promise<PlatformRoleAssignmentRecord | null>;
  listPlatformAssignments(tx?: TransactionContext): Promise<PlatformRoleAssignmentRecord[]>;
  countActivePlatformAdmins(tx?: TransactionContext): Promise<number>;
  createPlatformRoleAssignment(
    input: CreatePlatformRoleAssignmentInput,
    tx?: TransactionContext,
  ): Promise<PlatformRoleAssignmentRecord>;
  findPlatformSecuritySettings(
    tx?: TransactionContext,
  ): Promise<PlatformSecuritySettingsRecord | null>;
  upsertPlatformSecuritySettings(
    input: UpsertPlatformSecuritySettingsInput,
    tx?: TransactionContext,
  ): Promise<PlatformSecuritySettingsRecord>;
}

export interface AuditLogPort {
  append(entry: AuditLogEntry, tx?: TransactionContext): Promise<void>;
}

export interface AuthorizationEnginePort {
  isPlatformMfaRequired(tx?: TransactionContext): Promise<boolean>;
  resolveAccessState(identity: AuthenticatedIdentity): Promise<ResolvedAccessState>;
  resolveAccessContext(identity: AuthenticatedIdentity): Promise<AccessContext>;
  getAccessContext(identity: AuthenticatedIdentity): Promise<AccessContext>;
  authorize(
    identity: AuthenticatedIdentity,
    scope: AuthorizationScope,
  ): Promise<ResolvedAccessState>;
  requireCustomerAccess(identity: AuthenticatedIdentity): Promise<AccessContext>;
  requirePlatformAccess(
    identity: AuthenticatedIdentity,
    requiredPermission: PlatformPermission,
  ): Promise<ResolvedAccessState>;
}

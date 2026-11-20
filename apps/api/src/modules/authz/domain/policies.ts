import { ForbiddenError } from '../../../shared/errors.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import type {
  AccessContext,
  PlatformPermission,
  PlatformRoleAssignmentRecord,
  PlatformRoleKey,
  ResolvedAccessState,
} from './types.js';

export const PLATFORM_ROLE_HIERARCHY: Record<PlatformRoleKey, number> = {
  super_admin: 100,
  platform_admin: 50,
};

export function resolveAccessContext(
  identity: AuthenticatedIdentity,
  assignment: PlatformRoleAssignmentRecord | null,
  requirePlatformMfa: boolean,
): AccessContext {
  if (assignment?.status !== 'active') {
    return {
      principalType: 'user',
      platformRoleKey: null,
      requirePlatformMfa,
      mfaRequired: false,
      user: identity,
    };
  }

  return {
    principalType: 'admin',
    platformRoleKey: assignment.roleKey,
    requirePlatformMfa,
    mfaRequired: requirePlatformMfa && !identity.mfaEnabled,
    user: identity,
  };
}

export function assertCustomerAccess(context: AccessContext): void {
  if (context.principalType === 'admin') {
    throw new ForbiddenError(
      'Platform administrators cannot access customer workspace resources',
      'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
    );
  }
}

export function assertPlatformAccess(
  state: ResolvedAccessState,
  requiredPermission: PlatformPermission,
): void {
  const { accessContext, permissions } = state;

  if (accessContext.principalType !== 'admin' || !accessContext.platformRoleKey) {
    throw new ForbiddenError('Platform administrator access required');
  }

  if (!accessContext.user.emailVerified) {
    throw new ForbiddenError(
      'Verified email address is required for platform administration',
      'USER_NOT_VERIFIED',
    );
  }

  if (accessContext.requirePlatformMfa && !accessContext.user.mfaEnabled) {
    throw new ForbiddenError(
      'Multi-factor authentication enrollment is required for platform administration',
      'PLATFORM_MFA_REQUIRED',
    );
  }

  if (!permissions.includes(requiredPermission)) {
    throw new ForbiddenError(`Missing required platform permission: ${requiredPermission}`);
  }
}

export function canManagePlatformRole(
  actorRoleKey: PlatformRoleKey,
  targetRoleKey: PlatformRoleKey,
): boolean {
  return PLATFORM_ROLE_HIERARCHY[actorRoleKey] > PLATFORM_ROLE_HIERARCHY[targetRoleKey];
}

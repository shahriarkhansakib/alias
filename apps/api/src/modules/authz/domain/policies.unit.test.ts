import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../shared/errors.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import {
  assertCustomerAccess,
  assertPlatformAccess,
  canManagePlatformRole,
  resolveAccessContext,
} from './policies.js';
import type { PlatformRoleAssignmentRecord, ResolvedAccessState } from './types.js';

const baseIdentity: AuthenticatedIdentity = {
  userId: '01950000-0000-7000-8000-000000000001',
  sessionId: '01950000-0000-7000-8000-000000000002',
  email: 'person@example.com',
  name: 'Example Person',
  emailVerified: true,
  mfaEnabled: false,
};

function makeAssignment(
  overrides: Partial<PlatformRoleAssignmentRecord> = {},
): PlatformRoleAssignmentRecord {
  return {
    id: '01950000-0000-7000-8000-000000000010',
    userId: baseIdentity.userId,
    roleId: '01950000-0000-7000-8000-000000000020',
    roleKey: 'super_admin',
    status: 'active',
    grantedByUserId: null,
    grantedReason: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('authz domain policies', () => {
  it('resolves customer context when no active platform assignment exists', () => {
    const noAssignment = resolveAccessContext(baseIdentity, null, true);
    expect(noAssignment).toEqual({
      principalType: 'user',
      platformRoleKey: null,
      requirePlatformMfa: true,
      mfaRequired: false,
      user: baseIdentity,
    });

    const revokedAssignment = resolveAccessContext(
      baseIdentity,
      makeAssignment({ status: 'revoked' }),
      false,
    );
    expect(revokedAssignment.principalType).toBe('user');
    expect(revokedAssignment.platformRoleKey).toBeNull();
    expect(revokedAssignment.requirePlatformMfa).toBe(false);
    expect(revokedAssignment.mfaRequired).toBe(false);
  });

  it('resolves admin context and computes mfaRequired based on requirePlatformMfa', () => {
    const pendingMfa = resolveAccessContext(
      baseIdentity,
      makeAssignment({ roleKey: 'super_admin' }),
      true,
    );
    expect(pendingMfa).toEqual({
      principalType: 'admin',
      platformRoleKey: 'super_admin',
      requirePlatformMfa: true,
      mfaRequired: true,
      user: baseIdentity,
    });

    const mfaOptionalAdmin = resolveAccessContext(
      baseIdentity,
      makeAssignment({ roleKey: 'super_admin' }),
      false,
    );
    expect(mfaOptionalAdmin).toEqual({
      principalType: 'admin',
      platformRoleKey: 'super_admin',
      requirePlatformMfa: false,
      mfaRequired: false,
      user: baseIdentity,
    });

    const mfaIdentity: AuthenticatedIdentity = { ...baseIdentity, mfaEnabled: true };
    const readyAdmin = resolveAccessContext(
      mfaIdentity,
      makeAssignment({ roleKey: 'platform_admin' }),
      true,
    );
    expect(readyAdmin).toEqual({
      principalType: 'admin',
      platformRoleKey: 'platform_admin',
      requirePlatformMfa: true,
      mfaRequired: false,
      user: mfaIdentity,
    });
  });

  it('blocks platform admins from customer workspace access', () => {
    const customerContext = resolveAccessContext(baseIdentity, null, true);
    expect(() => assertCustomerAccess(customerContext)).not.toThrow();

    const adminContext = resolveAccessContext(
      { ...baseIdentity, mfaEnabled: true },
      makeAssignment(),
      true,
    );
    expect(() => assertCustomerAccess(adminContext)).toThrowError(ForbiddenError);

    try {
      assertCustomerAccess(adminContext);
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).code).toBe('PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED');
    }
  });

  it('enforces admin role, email verification, conditional MFA, and permission for platform access', () => {
    const customerState: ResolvedAccessState = {
      accessContext: resolveAccessContext(baseIdentity, null, true),
      permissions: [],
    };
    expect(() => assertPlatformAccess(customerState, 'platform:status:read')).toThrowError(
      ForbiddenError,
    );

    const unverifiedAdminState: ResolvedAccessState = {
      accessContext: resolveAccessContext(
        { ...baseIdentity, emailVerified: false, mfaEnabled: true },
        makeAssignment(),
        true,
      ),
      permissions: ['platform:status:read'],
    };
    try {
      assertPlatformAccess(unverifiedAdminState, 'platform:status:read');
      expect.unreachable('Expected ForbiddenError');
    } catch (error) {
      expect((error as ForbiddenError).code).toBe('USER_NOT_VERIFIED');
    }

    const noMfaAdminRequiredState: ResolvedAccessState = {
      accessContext: resolveAccessContext(
        { ...baseIdentity, emailVerified: true, mfaEnabled: false },
        makeAssignment(),
        true,
      ),
      permissions: ['platform:status:read', 'platform:admins:manage'],
    };
    try {
      assertPlatformAccess(noMfaAdminRequiredState, 'platform:status:read');
      expect.unreachable('Expected ForbiddenError');
    } catch (error) {
      expect((error as ForbiddenError).code).toBe('PLATFORM_MFA_REQUIRED');
    }

    const noMfaAdminOptionalState: ResolvedAccessState = {
      accessContext: resolveAccessContext(
        { ...baseIdentity, emailVerified: true, mfaEnabled: false },
        makeAssignment(),
        false,
      ),
      permissions: ['platform:status:read', 'platform:admins:manage'],
    };
    expect(() =>
      assertPlatformAccess(noMfaAdminOptionalState, 'platform:status:read'),
    ).not.toThrow();

    const platformAdminState: ResolvedAccessState = {
      accessContext: resolveAccessContext(
        { ...baseIdentity, emailVerified: true, mfaEnabled: true },
        makeAssignment({ roleKey: 'platform_admin' }),
        true,
      ),
      permissions: ['platform:status:read'],
    };
    expect(() => assertPlatformAccess(platformAdminState, 'platform:status:read')).not.toThrow();
    expect(() => assertPlatformAccess(platformAdminState, 'platform:admins:manage')).toThrowError(
      ForbiddenError,
    );

    const superAdminState: ResolvedAccessState = {
      accessContext: resolveAccessContext(
        { ...baseIdentity, emailVerified: true, mfaEnabled: true },
        makeAssignment({ roleKey: 'super_admin' }),
        true,
      ),
      permissions: ['platform:status:read', 'platform:admins:manage'],
    };
    expect(() => assertPlatformAccess(superAdminState, 'platform:admins:manage')).not.toThrow();
  });

  it('enforces platform role hierarchy for admin provisioning', () => {
    expect(canManagePlatformRole('super_admin', 'platform_admin')).toBe(true);
    expect(canManagePlatformRole('super_admin', 'super_admin')).toBe(false);
    expect(canManagePlatformRole('platform_admin', 'platform_admin')).toBe(false);
    expect(canManagePlatformRole('platform_admin', 'super_admin')).toBe(false);
  });
});

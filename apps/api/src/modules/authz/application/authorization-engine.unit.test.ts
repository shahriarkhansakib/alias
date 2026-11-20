import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../shared/errors.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import type { AuthorizationRepositoryPort } from '../domain/ports.js';
import type {
  PlatformPermission,
  PlatformRoleAssignmentRecord,
  PlatformSecuritySettingsRecord,
} from '../domain/types.js';
import { createAuthorizationEngine } from './authorization-engine.js';

function createStubRepository(options: {
  assignment: PlatformRoleAssignmentRecord | null;
  permissions?: PlatformPermission[];
  securitySettings?: PlatformSecuritySettingsRecord | null;
}): AuthorizationRepositoryPort {
  return {
    async findRoleByKey() {
      return null;
    },
    async findRolePermissions() {
      return options.permissions ?? ['platform:status:read', 'platform:admins:manage'];
    },
    async findActivePlatformAssignmentByUserId() {
      return options.assignment;
    },
    async findActiveSuperAdmin() {
      return options.assignment;
    },
    async listPlatformAssignments() {
      return options.assignment ? [options.assignment] : [];
    },
    async countActivePlatformAdmins() {
      return options.assignment ? 1 : 0;
    },
    async createPlatformRoleAssignment() {
      throw new Error('Not implemented in unit stub');
    },
    async findPlatformSecuritySettings() {
      return options.securitySettings ?? null;
    },
    async upsertPlatformSecuritySettings() {
      throw new Error('Not implemented in unit stub');
    },
  };
}

const adminIdentityNoMfa: AuthenticatedIdentity = {
  userId: '01950000-0000-7000-8000-000000000001',
  sessionId: '01950000-0000-7000-8000-000000000002',
  email: 'admin@example.com',
  name: 'Admin User',
  emailVerified: true,
  mfaEnabled: false,
};

const adminAssignment: PlatformRoleAssignmentRecord = {
  id: '01950000-0000-7000-8000-000000000010',
  userId: adminIdentityNoMfa.userId,
  roleId: '01950000-0000-7000-8000-000000000020',
  roleKey: 'super_admin',
  status: 'active',
  grantedByUserId: null,
  grantedReason: null,
  revokedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('AuthorizationEngine platform 2FA policy', () => {
  it('defaults to OFF when defaultRequirePlatformMfa=false (development) and no DB row exists', async () => {
    const engine = createAuthorizationEngine(
      createStubRepository({ assignment: adminAssignment }),
      {
        defaultRequirePlatformMfa: false,
      },
    );

    expect(await engine.isPlatformMfaRequired()).toBe(false);

    const context = await engine.resolveAccessContext(adminIdentityNoMfa);
    expect(context.requirePlatformMfa).toBe(false);
    expect(context.mfaRequired).toBe(false);

    await expect(
      engine.authorize(adminIdentityNoMfa, {
        kind: 'platform',
        permission: 'platform:status:read',
      }),
    ).resolves.toMatchObject({
      accessContext: {
        principalType: 'admin',
        requirePlatformMfa: false,
        mfaRequired: false,
      },
    });
  });

  it('defaults to ON when defaultRequirePlatformMfa=true (production/test) and no DB row exists', async () => {
    const engine = createAuthorizationEngine(
      createStubRepository({ assignment: adminAssignment }),
      {
        defaultRequirePlatformMfa: true,
      },
    );

    expect(await engine.isPlatformMfaRequired()).toBe(true);

    const context = await engine.resolveAccessContext(adminIdentityNoMfa);
    expect(context.requirePlatformMfa).toBe(true);
    expect(context.mfaRequired).toBe(true);

    try {
      await engine.authorize(adminIdentityNoMfa, {
        kind: 'platform',
        permission: 'platform:status:read',
      });
      expect.unreachable('Expected ForbiddenError');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).code).toBe('PLATFORM_MFA_REQUIRED');
    }
  });

  it('lets persisted DB settings override the environment default in both directions', async () => {
    const devOverriddenOn = createAuthorizationEngine(
      createStubRepository({
        assignment: adminAssignment,
        securitySettings: {
          id: 'default',
          requirePlatformMfa: true,
          updatedByUserId: adminIdentityNoMfa.userId,
          updatedAt: new Date(),
        },
      }),
      { defaultRequirePlatformMfa: false },
    );
    expect(await devOverriddenOn.isPlatformMfaRequired()).toBe(true);
    expect((await devOverriddenOn.resolveAccessContext(adminIdentityNoMfa)).mfaRequired).toBe(true);

    const prodOverriddenOff = createAuthorizationEngine(
      createStubRepository({
        assignment: adminAssignment,
        securitySettings: {
          id: 'default',
          requirePlatformMfa: false,
          updatedByUserId: adminIdentityNoMfa.userId,
          updatedAt: new Date(),
        },
      }),
      { defaultRequirePlatformMfa: true },
    );
    expect(await prodOverriddenOff.isPlatformMfaRequired()).toBe(false);
    expect((await prodOverriddenOff.resolveAccessContext(adminIdentityNoMfa)).mfaRequired).toBe(
      false,
    );
    await expect(
      prodOverriddenOff.authorize(adminIdentityNoMfa, {
        kind: 'platform',
        permission: 'platform:status:read',
      }),
    ).resolves.toBeDefined();
  });

  it('always computes mfaRequired=false for regular customer users even when policy is ON', async () => {
    const engine = createAuthorizationEngine(createStubRepository({ assignment: null }), {
      defaultRequirePlatformMfa: true,
    });

    const context = await engine.resolveAccessContext(adminIdentityNoMfa);
    expect(context.principalType).toBe('user');
    expect(context.requirePlatformMfa).toBe(true);
    expect(context.mfaRequired).toBe(false);
  });
});

import type { TransactionContext } from '../../../shared/ports.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import {
  assertCustomerAccess,
  assertPlatformAccess,
  resolveAccessContext,
} from '../domain/policies.js';
import type { AuthorizationEnginePort, AuthorizationRepositoryPort } from '../domain/ports.js';
import type {
  AccessContext,
  AuthorizationScope,
  PlatformPermission,
  ResolvedAccessState,
} from '../domain/types.js';

export interface AuthorizationEngineOptions {
  defaultRequirePlatformMfa: boolean;
}

export function createAuthorizationEngine(
  repository: AuthorizationRepositoryPort,
  options: AuthorizationEngineOptions,
): AuthorizationEnginePort {
  async function isPlatformMfaRequired(tx?: TransactionContext): Promise<boolean> {
    const settings = await repository.findPlatformSecuritySettings(tx);
    return settings ? settings.requirePlatformMfa : options.defaultRequirePlatformMfa;
  }

  async function resolveAccessState(identity: AuthenticatedIdentity): Promise<ResolvedAccessState> {
    const [assignment, requirePlatformMfa] = await Promise.all([
      repository.findActivePlatformAssignmentByUserId(identity.userId),
      isPlatformMfaRequired(),
    ]);
    const accessContext = resolveAccessContext(identity, assignment, requirePlatformMfa);

    if (assignment?.status !== 'active') {
      return {
        accessContext,
        permissions: [],
      };
    }

    const permissions = await repository.findRolePermissions(assignment.roleId);
    return {
      accessContext,
      permissions,
    };
  }

  async function resolveContext(identity: AuthenticatedIdentity): Promise<AccessContext> {
    const state = await resolveAccessState(identity);
    return state.accessContext;
  }

  async function authorize(
    identity: AuthenticatedIdentity,
    scope: AuthorizationScope,
  ): Promise<ResolvedAccessState> {
    if (scope.kind === 'customer') {
      const state = await resolveAccessState(identity);
      assertCustomerAccess(state.accessContext);
      return state;
    }

    const [assignment, requirePlatformMfa] = await Promise.all([
      repository.findActivePlatformAssignmentByUserId(identity.userId),
      isPlatformMfaRequired(),
    ]);
    const accessContext = resolveAccessContext(identity, assignment, requirePlatformMfa);
    const permissions =
      assignment?.status === 'active'
        ? await repository.findRolePermissions(assignment.roleId)
        : [];

    const state: ResolvedAccessState = {
      accessContext,
      permissions,
    };
    assertPlatformAccess(state, scope.permission);
    return state;
  }

  return {
    isPlatformMfaRequired,
    resolveAccessState,
    resolveAccessContext: resolveContext,
    getAccessContext: resolveContext,
    authorize,

    async requireCustomerAccess(identity: AuthenticatedIdentity): Promise<AccessContext> {
      const state = await authorize(identity, { kind: 'customer' });
      return state.accessContext;
    },

    async requirePlatformAccess(
      identity: AuthenticatedIdentity,
      requiredPermission: PlatformPermission,
    ): Promise<ResolvedAccessState> {
      return authorize(identity, { kind: 'platform', permission: requiredPermission });
    },
  };
}

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createAuthorizationEngine } from './application/authorization-engine.js';
import type {
  AuditLogPort,
  AuthorizationEnginePort,
  AuthorizationRepositoryPort,
} from './domain/ports.js';
import { createDrizzleAuditLogRepository } from './infrastructure/audit-log-repository.js';
import { createDrizzleAuthorizationRepository } from './infrastructure/authorization-repository.js';

export { createAuthorizationEngine } from './application/authorization-engine.js';
export { canManagePlatformRole } from './domain/policies.js';
export type {
  AuditLogPort,
  AuthorizationEnginePort,
  AuthorizationRepositoryPort,
} from './domain/ports.js';
export type {
  AccessContext,
  AuditLogEntry,
  AuthorizationScope,
  PlatformPermission,
  PlatformRoleAssignmentRecord,
  PlatformRoleAssignmentStatus,
  PlatformRoleKey,
  PlatformSecuritySettingsRecord,
  PrincipalType,
  ResolvedAccessState,
  RoleRecord,
} from './domain/types.js';
export {
  createRequireCustomerAccessMiddleware,
  createRequirePlatformPermissionMiddleware,
} from './http/middleware.js';
export { createAccessContextRouter } from './http/routes.js';

export interface AuthzInfrastructure {
  authorizationRepository: AuthorizationRepositoryPort;
  auditLogRepository: AuditLogPort;
  authorizationEngine: AuthorizationEnginePort;
}

export function createAuthzInfrastructure(
  db: NodePgDatabase<Record<string, unknown>>,
  options?: { defaultRequirePlatformMfa?: boolean },
): AuthzInfrastructure {
  const authorizationRepository = createDrizzleAuthorizationRepository(db);
  const auditLogRepository = createDrizzleAuditLogRepository(db);
  const authorizationEngine = createAuthorizationEngine(authorizationRepository, {
    defaultRequirePlatformMfa: options?.defaultRequirePlatformMfa ?? true,
  });

  return {
    authorizationRepository,
    auditLogRepository,
    authorizationEngine,
  };
}

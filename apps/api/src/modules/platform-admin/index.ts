import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import type { TransactionContext, UnitOfWork } from '../../shared/ports.js';
import type { AuthUserLookupPort } from '../authn/index.js';
import type {
  AuditLogPort,
  AuthorizationRepositoryPort,
  PlatformPermission,
} from '../authz/index.js';
import { createBootstrapSuperAdminUseCase } from './application/bootstrap-super-admin.js';
import { createGetPlatformStatusUseCase } from './application/get-platform-status.js';
import { createListPlatformAdminsUseCase } from './application/list-platform-admins.js';
import { createProvisionPlatformAdminUseCase } from './application/provision-platform-admin.js';
import { createUpdatePlatformSecuritySettingsUseCase } from './application/update-platform-security-settings.js';
import { createPlatformAdminRouter } from './http/routes.js';

export { createBootstrapSuperAdminUseCase } from './application/bootstrap-super-admin.js';
export type {
  BootstrapSuperAdminResult,
  PlatformAdminRosterItem,
  PlatformSecuritySettingsResult,
  PlatformStatusSummary,
  ProvisionPlatformAdminInput,
  UpdatePlatformSecuritySettingsInput,
} from './domain/types.js';

export function createPlatformAdminModule(deps: {
  unitOfWork: UnitOfWork;
  authorizationRepository: AuthorizationRepositoryPort;
  authUserLookup: AuthUserLookupPort;
  auditLog: AuditLogPort;
  isPlatformMfaRequired: (tx?: TransactionContext) => Promise<boolean>;
  requireAuth: MiddlewareHandler<AppEnv>;
  requirePlatformPermission: (permission: PlatformPermission) => MiddlewareHandler<AppEnv>;
}) {
  const getPlatformStatus = createGetPlatformStatusUseCase({
    authorizationRepository: deps.authorizationRepository,
    isPlatformMfaRequired: deps.isPlatformMfaRequired,
  });
  const listPlatformAdmins = createListPlatformAdminsUseCase({
    authorizationRepository: deps.authorizationRepository,
    authUserLookup: deps.authUserLookup,
  });
  const provisionPlatformAdmin = createProvisionPlatformAdminUseCase({
    unitOfWork: deps.unitOfWork,
    authorizationRepository: deps.authorizationRepository,
    authUserLookup: deps.authUserLookup,
    auditLog: deps.auditLog,
  });
  const bootstrapSuperAdmin = createBootstrapSuperAdminUseCase({
    unitOfWork: deps.unitOfWork,
    authorizationRepository: deps.authorizationRepository,
    authUserLookup: deps.authUserLookup,
    auditLog: deps.auditLog,
  });
  const updatePlatformSecuritySettings = createUpdatePlatformSecuritySettingsUseCase({
    unitOfWork: deps.unitOfWork,
    authorizationRepository: deps.authorizationRepository,
    auditLog: deps.auditLog,
    isPlatformMfaRequired: deps.isPlatformMfaRequired,
  });

  const router = createPlatformAdminRouter({
    requireAuth: deps.requireAuth,
    requirePlatformPermission: deps.requirePlatformPermission,
    getPlatformStatus,
    listPlatformAdmins,
    provisionPlatformAdmin,
    updatePlatformSecuritySettings,
  });

  return {
    router,
    bootstrapSuperAdmin,
    provisionPlatformAdmin,
    listPlatformAdmins,
    getPlatformStatus,
    updatePlatformSecuritySettings,
  };
}

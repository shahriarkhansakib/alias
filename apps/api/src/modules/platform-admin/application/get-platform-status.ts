import type { AuthorizationRepositoryPort, PlatformRoleKey } from '../../authz/index.js';
import type { PlatformStatusSummary } from '../domain/types.js';

export function createGetPlatformStatusUseCase(deps: {
  authorizationRepository: AuthorizationRepositoryPort;
  isPlatformMfaRequired: () => Promise<boolean>;
}) {
  return async function getPlatformStatus(actor: {
    userId: string;
    email: string;
    roleKey: PlatformRoleKey;
  }): Promise<PlatformStatusSummary> {
    const [activeAdminCount, requirePlatformMfa] = await Promise.all([
      deps.authorizationRepository.countActivePlatformAdmins(),
      deps.isPlatformMfaRequired(),
    ]);

    return {
      status: 'operational',
      service: 'alias-api',
      database: 'connected',
      activeAdminCount,
      requirePlatformMfa,
      actor,
      timestamp: new Date().toISOString(),
    };
  };
}

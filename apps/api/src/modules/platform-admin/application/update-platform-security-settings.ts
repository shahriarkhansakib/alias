import { ConflictError } from '../../../shared/errors.js';
import type { TransactionContext, UnitOfWork } from '../../../shared/ports.js';
import type { AuditLogPort, AuthorizationRepositoryPort } from '../../authz/index.js';
import type {
  PlatformSecuritySettingsResult,
  UpdatePlatformSecuritySettingsInput,
} from '../domain/types.js';

export function createUpdatePlatformSecuritySettingsUseCase(deps: {
  unitOfWork: UnitOfWork;
  authorizationRepository: AuthorizationRepositoryPort;
  auditLog: AuditLogPort;
  isPlatformMfaRequired: (tx?: TransactionContext) => Promise<boolean>;
}) {
  return async function updatePlatformSecuritySettings(
    input: UpdatePlatformSecuritySettingsInput,
  ): Promise<PlatformSecuritySettingsResult> {
    if (input.requirePlatformMfa && !input.actorMfaEnabled) {
      throw new ConflictError(
        'Enable and verify your own 2FA authenticator before turning on the platform-wide 2FA requirement',
        'MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT',
      );
    }

    return deps.unitOfWork.runInTransaction(async (tx) => {
      const previousRequirePlatformMfa = await deps.isPlatformMfaRequired(tx);
      const updated = await deps.authorizationRepository.upsertPlatformSecuritySettings(
        {
          requirePlatformMfa: input.requirePlatformMfa,
          updatedByUserId: input.actorUserId,
        },
        tx,
      );

      await deps.auditLog.append(
        {
          actorUserId: input.actorUserId,
          actorType: 'admin',
          action: 'platform.security.mfa_policy_updated',
          outcome: 'success',
          targetType: 'platform_security_settings',
          targetId: 'default',
          requestId: input.requestId,
          metadata: {
            previousRequirePlatformMfa,
            nextRequirePlatformMfa: updated.requirePlatformMfa,
          },
        },
        tx,
      );

      return {
        requirePlatformMfa: updated.requirePlatformMfa,
        updatedAt: updated.updatedAt.toISOString(),
        updatedByUserId: updated.updatedByUserId,
      };
    });
  };
}

import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '../../../shared/errors.js';
import type { UnitOfWork } from '../../../shared/ports.js';
import type { AuthUserLookupPort } from '../../authn/index.js';
import {
  type AuditLogPort,
  type AuthorizationRepositoryPort,
  canManagePlatformRole,
} from '../../authz/index.js';
import type { PlatformAdminRosterItem, ProvisionPlatformAdminInput } from '../domain/types.js';
import { AuditRejectedError, runWithRejectionAudit } from './audit-rejection.js';

export function createProvisionPlatformAdminUseCase(deps: {
  unitOfWork: UnitOfWork;
  authorizationRepository: AuthorizationRepositoryPort;
  authUserLookup: AuthUserLookupPort;
  auditLog: AuditLogPort;
}) {
  return async function provisionPlatformAdmin(
    input: ProvisionPlatformAdminInput,
  ): Promise<PlatformAdminRosterItem> {
    const normalizedEmail = input.email.trim().toLowerCase();

    if (!canManagePlatformRole(input.actorRoleKey, input.roleKey)) {
      await deps.auditLog.append({
        actorUserId: input.actorUserId,
        actorType: 'admin',
        action: 'platform.admin.provision.rejected',
        outcome: 'rejected',
        targetType: 'user',
        targetId: null,
        requestId: input.requestId,
        metadata: {
          email: normalizedEmail,
          targetRoleKey: input.roleKey,
          reason: 'INSUFFICIENT_ROLE_HIERARCHY',
        },
      });
      throw new ForbiddenError('Insufficient platform role hierarchy to provision administrator');
    }

    return runWithRejectionAudit(deps.auditLog, () =>
      deps.unitOfWork.runInTransaction(async (tx) => {
        const targetUser = await deps.authUserLookup.findByEmail(normalizedEmail, tx);
        if (!targetUser) {
          throw new AuditRejectedError(
            {
              actorUserId: input.actorUserId,
              actorType: 'admin',
              action: 'platform.admin.provision.rejected',
              outcome: 'rejected',
              targetType: 'user',
              targetId: null,
              requestId: input.requestId,
              metadata: {
                email: normalizedEmail,
                targetRoleKey: input.roleKey,
                reason: 'USER_NOT_FOUND',
              },
            },
            new NotFoundError(`No registered user found for email ${normalizedEmail}`),
          );
        }

        if (!targetUser.emailVerified) {
          throw new AuditRejectedError(
            {
              actorUserId: input.actorUserId,
              actorType: 'admin',
              action: 'platform.admin.provision.rejected',
              outcome: 'rejected',
              targetType: 'user',
              targetId: targetUser.id,
              requestId: input.requestId,
              metadata: {
                email: normalizedEmail,
                targetRoleKey: input.roleKey,
                reason: 'USER_NOT_VERIFIED',
              },
            },
            new ConflictError(
              'User must verify their email address before being provisioned as a platform administrator',
              'USER_NOT_VERIFIED',
            ),
          );
        }

        const existingAssignment =
          await deps.authorizationRepository.findActivePlatformAssignmentByUserId(
            targetUser.id,
            tx,
          );
        if (existingAssignment) {
          throw new AuditRejectedError(
            {
              actorUserId: input.actorUserId,
              actorType: 'admin',
              action: 'platform.admin.provision.rejected',
              outcome: 'rejected',
              targetType: 'user',
              targetId: targetUser.id,
              requestId: input.requestId,
              metadata: {
                email: normalizedEmail,
                targetRoleKey: input.roleKey,
                existingRoleKey: existingAssignment.roleKey,
                reason: 'USER_ALREADY_ADMIN',
              },
            },
            new ConflictError(
              'User already holds an active platform administrator role',
              'USER_ALREADY_ADMIN',
            ),
          );
        }

        const role = await deps.authorizationRepository.findRoleByKey(input.roleKey, tx);
        if (!role) {
          throw new InternalError(`System role ${input.roleKey} is not seeded`);
        }

        const assignment = await deps.authorizationRepository.createPlatformRoleAssignment(
          {
            userId: targetUser.id,
            roleId: role.id,
            roleKey: input.roleKey,
            grantedByUserId: input.actorUserId,
            grantedReason: input.reason ?? 'Provisioned via platform admin panel',
          },
          tx,
        );

        await deps.auditLog.append(
          {
            actorUserId: input.actorUserId,
            actorType: 'admin',
            action: 'platform.admin.provision.succeeded',
            outcome: 'success',
            targetType: 'platform_role_assignment',
            targetId: assignment.id,
            requestId: input.requestId,
            metadata: {
              targetUserId: targetUser.id,
              email: targetUser.email,
              roleKey: assignment.roleKey,
            },
          },
          tx,
        );

        return {
          assignmentId: assignment.id,
          userId: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
          roleKey: assignment.roleKey,
          status: assignment.status,
          mfaEnabled: targetUser.twoFactorEnabled,
          createdAt: assignment.createdAt.toISOString(),
        };
      }),
    );
  };
}

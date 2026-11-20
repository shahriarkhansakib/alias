import { ConflictError, InternalError, NotFoundError } from '../../../shared/errors.js';
import type { UnitOfWork } from '../../../shared/ports.js';
import type { AuthUserLookupPort } from '../../authn/index.js';
import type { AuditLogPort, AuthorizationRepositoryPort } from '../../authz/index.js';
import { type BootstrapSuperAdminResult, SUPER_ADMIN_BOOTSTRAP_LOCK_KEY } from '../domain/types.js';
import { AuditRejectedError, runWithRejectionAudit } from './audit-rejection.js';

export function createBootstrapSuperAdminUseCase(deps: {
  unitOfWork: UnitOfWork;
  authorizationRepository: AuthorizationRepositoryPort;
  authUserLookup: AuthUserLookupPort;
  auditLog: AuditLogPort;
}) {
  return async function bootstrapSuperAdmin(email: string): Promise<BootstrapSuperAdminResult> {
    const normalizedEmail = email.trim().toLowerCase();

    return runWithRejectionAudit(deps.auditLog, () =>
      deps.unitOfWork.runWithAdvisoryLock(SUPER_ADMIN_BOOTSTRAP_LOCK_KEY, async (tx) => {
        const targetUser = await deps.authUserLookup.findByEmail(normalizedEmail, tx);
        if (!targetUser) {
          throw new AuditRejectedError(
            {
              actorUserId: null,
              actorType: 'system',
              action: 'platform.super_admin.bootstrap.rejected',
              outcome: 'rejected',
              targetType: 'user',
              targetId: null,
              requestId: null,
              metadata: {
                email: normalizedEmail,
                reason: 'USER_NOT_FOUND',
              },
            },
            new NotFoundError(`No registered user found for email ${normalizedEmail}`),
          );
        }

        if (!targetUser.emailVerified) {
          throw new AuditRejectedError(
            {
              actorUserId: null,
              actorType: 'system',
              action: 'platform.super_admin.bootstrap.rejected',
              outcome: 'rejected',
              targetType: 'user',
              targetId: targetUser.id,
              requestId: null,
              metadata: {
                email: normalizedEmail,
                reason: 'USER_NOT_VERIFIED',
              },
            },
            new ConflictError(
              'Initial super_admin bootstrap requires a verified user account',
              'USER_NOT_VERIFIED',
            ),
          );
        }

        const existingSuperAdmin = await deps.authorizationRepository.findActiveSuperAdmin(tx);
        if (existingSuperAdmin) {
          if (existingSuperAdmin.userId === targetUser.id) {
            await deps.auditLog.append(
              {
                actorUserId: targetUser.id,
                actorType: 'system',
                action: 'platform.super_admin.bootstrap.idempotent',
                outcome: 'noop',
                targetType: 'platform_role_assignment',
                targetId: existingSuperAdmin.id,
                requestId: null,
                metadata: {
                  email: targetUser.email,
                  roleKey: 'super_admin',
                },
              },
              tx,
            );

            return {
              outcome: 'already_bootstrapped',
              assignmentId: existingSuperAdmin.id,
              userId: targetUser.id,
              email: targetUser.email,
            };
          }

          throw new AuditRejectedError(
            {
              actorUserId: null,
              actorType: 'system',
              action: 'platform.super_admin.bootstrap.rejected',
              outcome: 'rejected',
              targetType: 'user',
              targetId: targetUser.id,
              requestId: null,
              metadata: {
                email: targetUser.email,
                existingSuperAdminUserId: existingSuperAdmin.userId,
                reason: 'SUPER_ADMIN_ALREADY_EXISTS',
              },
            },
            new ConflictError(
              'An active super_admin already exists; cannot hijack initial bootstrap',
              'SUPER_ADMIN_ALREADY_EXISTS',
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
              actorUserId: null,
              actorType: 'system',
              action: 'platform.super_admin.bootstrap.rejected',
              outcome: 'rejected',
              targetType: 'user',
              targetId: targetUser.id,
              requestId: null,
              metadata: {
                email: targetUser.email,
                existingRoleKey: existingAssignment.roleKey,
                reason: 'USER_ALREADY_ADMIN',
              },
            },
            new ConflictError(
              'Target user already holds an active platform role',
              'USER_ALREADY_ADMIN',
            ),
          );
        }

        const superAdminRole = await deps.authorizationRepository.findRoleByKey('super_admin', tx);
        if (!superAdminRole) {
          throw new InternalError('System role super_admin is not seeded');
        }

        const assignment = await deps.authorizationRepository.createPlatformRoleAssignment(
          {
            userId: targetUser.id,
            roleId: superAdminRole.id,
            roleKey: 'super_admin',
            grantedByUserId: null,
            grantedReason: 'Initial CLI super_admin bootstrap',
          },
          tx,
        );

        await deps.auditLog.append(
          {
            actorUserId: targetUser.id,
            actorType: 'system',
            action: 'platform.super_admin.bootstrap.succeeded',
            outcome: 'success',
            targetType: 'platform_role_assignment',
            targetId: assignment.id,
            requestId: null,
            metadata: {
              email: targetUser.email,
              roleKey: 'super_admin',
            },
          },
          tx,
        );

        return {
          outcome: 'created',
          assignmentId: assignment.id,
          userId: targetUser.id,
          email: targetUser.email,
        };
      }),
    );
  };
}

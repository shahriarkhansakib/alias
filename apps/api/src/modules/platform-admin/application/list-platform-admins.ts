import type { AuthUserLookupPort } from '../../authn/index.js';
import type { AuthorizationRepositoryPort } from '../../authz/index.js';
import type { PlatformAdminRosterItem } from '../domain/types.js';

export function createListPlatformAdminsUseCase(deps: {
  authorizationRepository: AuthorizationRepositoryPort;
  authUserLookup: AuthUserLookupPort;
}) {
  return async function listPlatformAdmins(): Promise<{ admins: PlatformAdminRosterItem[] }> {
    const assignments = await deps.authorizationRepository.listPlatformAssignments();
    const userIds = Array.from(new Set(assignments.map((assignment) => assignment.userId)));
    const users = await deps.authUserLookup.findByIds(userIds);
    const userById = new Map(users.map((user) => [user.id, user]));

    const admins: PlatformAdminRosterItem[] = [];
    for (const assignment of assignments) {
      const user = userById.get(assignment.userId);
      if (!user) {
        continue;
      }
      admins.push({
        assignmentId: assignment.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        roleKey: assignment.roleKey,
        status: assignment.status,
        mfaEnabled: user.twoFactorEnabled,
        createdAt: assignment.createdAt.toISOString(),
      });
    }

    return { admins };
  };
}

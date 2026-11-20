import {
  ApiErrorEnvelopeSchema,
  ListPlatformAdminsResponseSchema,
  PlatformSecuritySettingsDtoSchema,
  PlatformStatusResponseSchema,
  ProvisionPlatformAdminRequestSchema,
  ProvisionPlatformAdminResponseSchema,
  UpdatePlatformSecuritySettingsRequestSchema,
} from '@alias/contracts';
import { createRoute } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors.js';
import { createOpenAPIApp } from '../../../shared/http/openapi.js';
import type { AppEnv } from '../../../shared/http/types.js';
import type { PlatformPermission, PlatformRoleKey } from '../../authz/index.js';
import type {
  PlatformAdminRosterItem,
  PlatformSecuritySettingsResult,
  PlatformStatusSummary,
  ProvisionPlatformAdminInput,
  UpdatePlatformSecuritySettingsInput,
} from '../domain/types.js';

const getPlatformStatusRoute = createRoute({
  method: 'get',
  path: '/api/v1/platform/status',
  tags: ['Platform Admin'],
  summary: 'Get platform operational status (MFA required)',
  responses: {
    200: {
      description: 'Platform operational summary',
      content: {
        'application/json': {
          schema: PlatformStatusResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    403: {
      description: 'Platform admin access and MFA required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
  },
});

const listPlatformAdminsRoute = createRoute({
  method: 'get',
  path: '/api/v1/platform/admins',
  tags: ['Platform Admin'],
  summary: 'List platform administrators (MFA required)',
  responses: {
    200: {
      description: 'Platform administrator roster',
      content: {
        'application/json': {
          schema: ListPlatformAdminsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    403: {
      description: 'Platform admin access and MFA required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
  },
});

const provisionPlatformAdminRoute = createRoute({
  method: 'post',
  path: '/api/v1/platform/admins',
  tags: ['Platform Admin'],
  summary: 'Provision a verified user as platform_admin (super_admin + MFA required)',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ProvisionPlatformAdminRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Platform administrator provisioned',
      content: {
        'application/json': {
          schema: ProvisionPlatformAdminResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request payload',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    403: {
      description: 'Super admin access and MFA required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    404: {
      description: 'Target user not found',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    409: {
      description: 'Target user unverified or already an admin',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
  },
});

const patchPlatformSecuritySettingsRoute = createRoute({
  method: 'patch',
  path: '/api/v1/platform/security-settings',
  tags: ['Platform Admin'],
  summary: 'Toggle platform-wide 2FA requirement (super_admin only)',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpdatePlatformSecuritySettingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated platform security settings',
      content: {
        'application/json': {
          schema: PlatformSecuritySettingsDtoSchema,
        },
      },
    },
    400: {
      description: 'Invalid request payload',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    403: {
      description: 'Super admin access required',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
    409: {
      description:
        'Calling super_admin must enable personal 2FA before enforcing platform-wide 2FA',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
  },
});

export function createPlatformAdminRouter(deps: {
  requireAuth: MiddlewareHandler<AppEnv>;
  requirePlatformPermission: (permission: PlatformPermission) => MiddlewareHandler<AppEnv>;
  getPlatformStatus: (actor: {
    userId: string;
    email: string;
    roleKey: PlatformRoleKey;
  }) => Promise<PlatformStatusSummary>;
  listPlatformAdmins: () => Promise<{ admins: PlatformAdminRosterItem[] }>;
  provisionPlatformAdmin: (input: ProvisionPlatformAdminInput) => Promise<PlatformAdminRosterItem>;
  updatePlatformSecuritySettings: (
    input: UpdatePlatformSecuritySettingsInput,
  ) => Promise<PlatformSecuritySettingsResult>;
}) {
  const router = createOpenAPIApp();

  router.use(
    '/api/v1/platform/status',
    deps.requireAuth,
    deps.requirePlatformPermission('platform:status:read'),
  );
  router.openapi(getPlatformStatusRoute, async (c) => {
    const accessContext = c.get('accessContext');
    if (!accessContext?.platformRoleKey) {
      throw new ForbiddenError('Platform administrator access required');
    }

    const summary = await deps.getPlatformStatus({
      userId: accessContext.user.userId,
      email: accessContext.user.email,
      roleKey: accessContext.platformRoleKey,
    });

    return c.json(summary, 200);
  });

  router.use('/api/v1/platform/admins', deps.requireAuth);
  router.use('/api/v1/platform/admins', async (c, next) => {
    const permission: PlatformPermission =
      c.req.method === 'POST' ? 'platform:admins:manage' : 'platform:status:read';
    return deps.requirePlatformPermission(permission)(c, next);
  });

  router.openapi(listPlatformAdminsRoute, async (c) => {
    const result = await deps.listPlatformAdmins();
    return c.json(result, 200);
  });

  router.openapi(provisionPlatformAdminRoute, async (c) => {
    const accessContext = c.get('accessContext');
    if (!accessContext?.platformRoleKey) {
      throw new UnauthorizedError('Platform administrator access required');
    }

    const body = c.req.valid('json');
    const admin = await deps.provisionPlatformAdmin({
      actorUserId: accessContext.user.userId,
      actorRoleKey: accessContext.platformRoleKey,
      email: body.email,
      roleKey: body.roleKey,
      reason: body.reason,
      requestId: c.get('requestId'),
    });

    return c.json({ admin }, 201);
  });

  router.use(
    '/api/v1/platform/security-settings',
    deps.requireAuth,
    deps.requirePlatformPermission('platform:admins:manage'),
  );
  router.openapi(patchPlatformSecuritySettingsRoute, async (c) => {
    const accessContext = c.get('accessContext');
    if (!accessContext?.platformRoleKey) {
      throw new UnauthorizedError('Platform administrator access required');
    }

    const body = c.req.valid('json');
    const settings = await deps.updatePlatformSecuritySettings({
      actorUserId: accessContext.user.userId,
      actorMfaEnabled: accessContext.user.mfaEnabled,
      requirePlatformMfa: body.requirePlatformMfa,
      requestId: c.get('requestId'),
    });

    return c.json(settings, 200);
  });

  return router;
}

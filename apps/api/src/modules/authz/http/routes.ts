import {
  AccessContextResponseSchema,
  ApiErrorEnvelopeSchema,
  CustomerWorkspaceResponseSchema,
} from '@alias/contracts';
import { createRoute } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError } from '../../../shared/errors.js';
import { createOpenAPIApp } from '../../../shared/http/openapi.js';
import type { AppEnv } from '../../../shared/http/types.js';
import type { AuthorizationEnginePort } from '../domain/ports.js';

const getAccessContextRoute = createRoute({
  method: 'get',
  path: '/api/v1/access-context',
  tags: ['Access'],
  summary: 'Resolve current user principal type and MFA requirements',
  responses: {
    200: {
      description: 'Resolved access context for authenticated principal',
      content: {
        'application/json': {
          schema: AccessContextResponseSchema,
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
  },
});

const getCustomerWorkspaceRoute = createRoute({
  method: 'get',
  path: '/api/v1/customer/workspace',
  tags: ['Customer'],
  summary: 'Get customer workspace context (customer principals only)',
  responses: {
    200: {
      description: 'Customer workspace shell payload',
      content: {
        'application/json': {
          schema: CustomerWorkspaceResponseSchema,
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
      description: 'Platform administrators cannot access customer workspace resources',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
  },
});

export function createAccessContextRouter(deps: {
  requireAuth: MiddlewareHandler<AppEnv>;
  requireCustomerAccess: MiddlewareHandler<AppEnv>;
  authzEngine: AuthorizationEnginePort;
}) {
  const router = createOpenAPIApp();

  router.use('/api/v1/access-context', deps.requireAuth);
  router.openapi(getAccessContextRoute, async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new UnauthorizedError('Authentication required');
    }

    const context = await deps.authzEngine.resolveAccessContext(auth);
    return c.json(context, 200);
  });

  router.use('/api/v1/customer/*', deps.requireAuth, deps.requireCustomerAccess);
  router.openapi(getCustomerWorkspaceRoute, (c) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new UnauthorizedError('Authentication required');
    }

    return c.json(
      {
        principalType: 'user' as const,
        user: auth,
      },
      200,
    );
  });

  return router;
}

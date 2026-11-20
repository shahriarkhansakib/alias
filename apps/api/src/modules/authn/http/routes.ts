import { ApiErrorEnvelopeSchema, MeResponseSchema } from '@alias/contracts';
import { createRoute } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError } from '../../../shared/errors.js';
import { createOpenAPIApp } from '../../../shared/http/openapi.js';
import type { AppEnv } from '../../../shared/http/types.js';
import { getCurrentUserProfile } from '../application/get-current-user.js';

const getMeRoute = createRoute({
  method: 'get',
  path: '/api/v1/me',
  tags: ['Auth'],
  summary: 'Get authenticated user profile',
  responses: {
    200: {
      description: 'Current authenticated user',
      content: {
        'application/json': {
          schema: MeResponseSchema,
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

export function createAuthRouter(deps: {
  handleAuthRequest: (request: Request) => Promise<Response>;
  requireAuth: MiddlewareHandler<AppEnv>;
}) {
  const router = createOpenAPIApp();

  router.on(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], '/api/auth/*', (c) => {
    return deps.handleAuthRequest(c.req.raw);
  });

  router.use('/api/v1/me', deps.requireAuth);
  router.openapi(getMeRoute, (c) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new UnauthorizedError('Authentication required');
    }
    return c.json(getCurrentUserProfile(auth), 200);
  });

  return router;
}

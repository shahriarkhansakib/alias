import { ApiErrorEnvelopeSchema, HealthResponseSchema } from '@alias/contracts';
import { createRoute } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { HTTPException } from 'hono/http-exception';
import {
  createAuthnInfrastructure,
  createAuthRouter,
  createRequireAuthMiddleware,
} from './modules/authn/index.js';
import {
  createAccessContextRouter,
  createAuthzInfrastructure,
  createRequireCustomerAccessMiddleware,
  createRequirePlatformPermissionMiddleware,
} from './modules/authz/index.js';
import { createPlatformAdminModule } from './modules/platform-admin/index.js';
import type { AppEnvConfig } from './shared/env.js';
import { AppError, ForbiddenError } from './shared/errors.js';
import { createOpenAPIApp } from './shared/http/openapi.js';
import { generateId } from './shared/id.js';
import type { Logger } from './shared/logger.js';
import type { MailerPort, UnitOfWork } from './shared/ports.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'API and PostgreSQL readiness check',
  responses: {
    200: {
      description: 'Service is healthy',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
    500: {
      description: 'Database check failed',
      content: {
        'application/json': {
          schema: ApiErrorEnvelopeSchema,
        },
      },
    },
  },
});

function resolveHeaderOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export interface ApiAppDependencies {
  env: AppEnvConfig;
  db: NodePgDatabase<Record<string, unknown>>;
  unitOfWork: UnitOfWork;
  pingDb: () => Promise<void>;
  mailer: MailerPort;
  logger: Logger;
  defaultRequirePlatformMfa?: boolean;
}

export function createApiApp(deps: ApiAppDependencies) {
  const app = createOpenAPIApp();
  const trustedOrigins = new Set(deps.env.trustedOrigins.map((origin) => new URL(origin).origin));

  app.use('*', async (c, next) => {
    const incomingRequestId = c.req.header('x-request-id');
    const requestId =
      incomingRequestId && /^[a-zA-Z0-9_-]{8,64}$/.test(incomingRequestId)
        ? incomingRequestId
        : generateId();

    c.set('requestId', requestId);
    c.header('x-request-id', requestId);

    const startedAt = Date.now();
    try {
      await next();
    } finally {
      deps.logger.info(
        {
          requestId,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Date.now() - startedAt,
        },
        'HTTP request completed',
      );
    }
  });

  app.use('/api/v1/*', async (c, next) => {
    if (!STATE_CHANGING_METHODS.has(c.req.method)) {
      return next();
    }

    const originHeader = c.req.header('origin');
    if (originHeader !== undefined) {
      const origin = resolveHeaderOrigin(originHeader);
      if (!origin || !trustedOrigins.has(origin)) {
        throw new ForbiddenError('Untrusted request origin', 'CSRF_ORIGIN_INVALID');
      }
      return next();
    }

    const refererHeader = c.req.header('referer');
    if (refererHeader !== undefined) {
      const refererOrigin = resolveHeaderOrigin(refererHeader);
      if (!refererOrigin || !trustedOrigins.has(refererOrigin)) {
        throw new ForbiddenError('Untrusted request referer', 'CSRF_ORIGIN_INVALID');
      }
    }

    return next();
  });

  app.openapi(healthRoute, async (c) => {
    await deps.pingDb();
    return c.json(
      {
        status: 'ok' as const,
        service: 'alias-api' as const,
        database: 'connected' as const,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  });

  const authn = createAuthnInfrastructure({
    db: deps.db,
    secret: deps.env.betterAuthSecret,
    baseUrl: deps.env.betterAuthUrl,
    trustedOrigins: deps.env.trustedOrigins,
    nodeEnv: deps.env.nodeEnv,
    mailer: deps.mailer,
    logger: deps.logger,
    googleClientId: deps.env.googleClientId,
    googleClientSecret: deps.env.googleClientSecret,
    rateLimitEnabled: deps.env.authRateLimitEnabled,
  });

  const defaultRequirePlatformMfa =
    deps.defaultRequirePlatformMfa ?? deps.env.nodeEnv !== 'development';

  const authz = createAuthzInfrastructure(deps.db, {
    defaultRequirePlatformMfa,
  });
  const requireAuth = createRequireAuthMiddleware(authn.sessionResolver);
  const requireCustomerAccess = createRequireCustomerAccessMiddleware(authz.authorizationEngine);

  const authRouter = createAuthRouter({
    handleAuthRequest: authn.handleAuthRequest,
    requireAuth,
  });

  const accessContextRouter = createAccessContextRouter({
    requireAuth,
    requireCustomerAccess,
    authzEngine: authz.authorizationEngine,
  });

  const platformAdminModule = createPlatformAdminModule({
    unitOfWork: deps.unitOfWork,
    authorizationRepository: authz.authorizationRepository,
    authUserLookup: authn.userLookup,
    auditLog: authz.auditLogRepository,
    isPlatformMfaRequired: authz.authorizationEngine.isPlatformMfaRequired,
    requireAuth,
    requirePlatformPermission: (permission) =>
      createRequirePlatformPermissionMiddleware(authz.authorizationEngine, permission),
  });

  app.route('/', authRouter);
  app.route('/', accessContextRouter);
  app.route('/', platformAdminModule.router);

  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Alias API',
      version: '0.1.0',
      description: 'Alias modular monolith REST & OpenAPI specification.',
    },
  });

  app.get(
    '/api/docs',
    Scalar({
      url: '/api/openapi.json',
      pageTitle: 'Alias API Reference',
    }),
  );

  app.notFound((c) => {
    const requestId = c.get('requestId') ?? generateId();
    return c.json(
      {
        error: {
          code: 'NOT_FOUND' as const,
          message: `Route not found: ${c.req.method} ${c.req.path}`,
          requestId,
        },
      },
      404,
    );
  });

  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? generateId();

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        deps.logger.error({ err: error, requestId }, error.message);
      }
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
            requestId,
          },
        },
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500,
      );
    }

    if (error instanceof HTTPException) {
      const status = error.status;
      const code =
        status === 400
          ? 'VALIDATION_ERROR'
          : status === 401
            ? 'UNAUTHORIZED'
            : status === 403
              ? 'FORBIDDEN'
              : status === 404
                ? 'NOT_FOUND'
                : status === 409
                  ? 'CONFLICT'
                  : status === 429
                    ? 'RATE_LIMITED'
                    : 'INTERNAL_ERROR';
      return c.json(
        {
          error: {
            code,
            message: error.message || 'HTTP request failed',
            requestId,
          },
        },
        status,
      );
    }

    deps.logger.error({ err: error, requestId }, 'Unhandled server error');
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: 'Internal server error',
          requestId,
        },
      },
      500,
    );
  });

  return {
    app,
    bootstrapSuperAdmin: platformAdminModule.bootstrapSuperAdmin,
  };
}

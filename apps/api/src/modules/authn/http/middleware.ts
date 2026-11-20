import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError } from '../../../shared/errors.js';
import type { AppEnv } from '../../../shared/http/types.js';
import type { SessionResolverPort } from '../domain/ports.js';

export function createRequireAuthMiddleware(
  sessionResolver: SessionResolverPort,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const disableRefresh = c.req.header('x-alias-disable-refresh') === 'true';
    const identity = await sessionResolver.resolveSession(c.req.raw.headers, {
      disableRefresh,
    });

    if (!identity) {
      throw new UnauthorizedError('Authentication required');
    }

    c.set('auth', identity);
    await next();
  };
}

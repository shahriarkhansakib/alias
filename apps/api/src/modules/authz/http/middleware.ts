import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError } from '../../../shared/errors.js';
import type { AppEnv } from '../../../shared/http/types.js';
import type { AuthorizationEnginePort } from '../domain/ports.js';
import type { PlatformPermission } from '../domain/types.js';

export function createRequireCustomerAccessMiddleware(
  authzEngine: AuthorizationEnginePort,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new UnauthorizedError('Authentication required');
    }

    const accessContext = await authzEngine.requireCustomerAccess(auth);
    c.set('accessContext', accessContext);
    await next();
  };
}

export function createRequirePlatformPermissionMiddleware(
  authzEngine: AuthorizationEnginePort,
  permission: PlatformPermission,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new UnauthorizedError('Authentication required');
    }

    const state = await authzEngine.requirePlatformAccess(auth, permission);
    c.set('accessContext', state.accessContext);
    await next();
  };
}

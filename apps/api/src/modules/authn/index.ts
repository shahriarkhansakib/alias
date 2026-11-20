import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Logger } from '../../shared/logger.js';
import type { MailerPort } from '../../shared/ports.js';
import type { AuthUserLookupPort, SessionResolverPort } from './domain/ports.js';
import { createBetterAuth } from './infrastructure/better-auth.js';
import { createBetterAuthSessionResolver } from './infrastructure/session-resolver.js';
import { createDrizzleAuthUserLookup } from './infrastructure/user-lookup-repository.js';

export type {
  AuthUserLookupPort,
  SessionResolveOptions,
  SessionResolverPort,
} from './domain/ports.js';
export type { AuthenticatedIdentity, AuthUserRecord } from './domain/types.js';
export { createRequireAuthMiddleware } from './http/middleware.js';
export { createAuthRouter } from './http/routes.js';

export interface AuthnInfrastructure {
  sessionResolver: SessionResolverPort;
  userLookup: AuthUserLookupPort;
  handleAuthRequest: (request: Request) => Promise<Response>;
}

export function createAuthnInfrastructure(config: {
  db: NodePgDatabase<Record<string, unknown>>;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  nodeEnv: 'development' | 'test' | 'production';
  mailer: MailerPort;
  logger: Logger;
  googleClientId?: string;
  googleClientSecret?: string;
  rateLimitEnabled: boolean;
}): AuthnInfrastructure {
  const auth = createBetterAuth(config);
  const sessionResolver = createBetterAuthSessionResolver(auth);
  const userLookup = createDrizzleAuthUserLookup(config.db);

  return {
    sessionResolver,
    userLookup,
    handleAuthRequest: (request: Request) => auth.handler(request),
  };
}

import type { SessionResolveOptions, SessionResolverPort } from '../domain/ports.js';
import type { AuthenticatedIdentity } from '../domain/types.js';
import type { BetterAuthInstance } from './better-auth.js';

export function createBetterAuthSessionResolver(auth: BetterAuthInstance): SessionResolverPort {
  return {
    async resolveSession(
      headers: Headers,
      options?: SessionResolveOptions,
    ): Promise<AuthenticatedIdentity | null> {
      const result = await auth.api.getSession({
        headers,
        query: options?.disableRefresh ? { disableRefresh: true } : undefined,
      });

      if (!result?.user || !result?.session) {
        return null;
      }

      return {
        userId: result.user.id,
        sessionId: result.session.id,
        email: result.user.email,
        name: result.user.name,
        emailVerified: Boolean(result.user.emailVerified),
        mfaEnabled: Boolean(result.user.twoFactorEnabled),
      };
    },
  };
}

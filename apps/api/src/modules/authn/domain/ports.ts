import type { TransactionContext } from '../../../shared/ports.js';
import type { AuthenticatedIdentity, AuthUserRecord } from './types.js';

export interface SessionResolveOptions {
  disableRefresh?: boolean;
}

export interface SessionResolverPort {
  resolveSession(
    headers: Headers,
    options?: SessionResolveOptions,
  ): Promise<AuthenticatedIdentity | null>;
}

export interface AuthUserLookupPort {
  findByEmail(email: string, tx?: TransactionContext): Promise<AuthUserRecord | null>;
  findByIds(ids: string[], tx?: TransactionContext): Promise<AuthUserRecord[]>;
}

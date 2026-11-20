import type { AuthenticatedIdentity } from '../domain/types.js';

export function getCurrentUserProfile(identity: AuthenticatedIdentity) {
  return {
    user: identity,
  };
}

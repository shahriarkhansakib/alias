/**
 * Access rules for the single-URL gateway.
 *
 * apps/web on :3000 is the only address users open. It forwards these paths to the
 * system apps running in the background (see next.config.ts rewrites):
 *   /intake/*          -> System 1 (client chat + operator console)
 *   /studio/*          -> System 2 web (creative studio)
 *   /publish/*         -> System 3 web (publishing & analytics)
 *   /svc/creative/*    -> System 2 API
 *   /svc/publishing/*  -> System 3 API
 *
 * Clients (principalType "user") may only use the System 1 client chat.
 * Admins may use everything. Signed-out visitors are sent to /login.
 */

export type GatewayPrincipal = 'anonymous' | 'client' | 'admin';

export type GatewayDecision =
  | { kind: 'not-gated' }
  | { kind: 'allow' }
  | { kind: 'redirect'; to: '/login' | '/dashboard' }
  | { kind: 'forbidden' };

const GATED_PREFIXES = ['/intake', '/studio', '/publish', '/svc'] as const;

/** System 1 paths that only operators may reach (pages and their APIs). */
const INTAKE_ADMIN_PREFIXES = ['/intake/admin', '/intake/api/admin'] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Static build assets and NextAuth endpoints are needed by every signed-in page. */
function isSharedSystemAsset(pathname: string): boolean {
  return (
    matchesPrefix(pathname, '/intake/_next') ||
    matchesPrefix(pathname, '/intake/api/auth') ||
    pathname === '/intake/favicon.ico'
  );
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/svc/') || pathname.startsWith('/intake/api/');
}

export function isGatewayPath(pathname: string): boolean {
  return GATED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function decideGatewayAccess(
  pathname: string,
  principal: GatewayPrincipal,
): GatewayDecision {
  if (!isGatewayPath(pathname)) {
    return { kind: 'not-gated' };
  }

  if (principal === 'anonymous') {
    return isApiPath(pathname) ? { kind: 'forbidden' } : { kind: 'redirect', to: '/login' };
  }

  if (principal === 'admin') {
    return { kind: 'allow' };
  }

  // Client
  if (isSharedSystemAsset(pathname)) {
    return { kind: 'allow' };
  }
  const isIntake = matchesPrefix(pathname, '/intake');
  const isIntakeAdmin = INTAKE_ADMIN_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
  if (isIntake && !isIntakeAdmin) {
    return { kind: 'allow' };
  }
  return isApiPath(pathname) ? { kind: 'forbidden' } : { kind: 'redirect', to: '/dashboard' };
}

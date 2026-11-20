import { type NextRequest, NextResponse } from 'next/server';
import { decideGatewayAccess, type GatewayPrincipal, isGatewayPath } from '@/lib/gateway-policy';

/**
 * Gateway auth gate (Next.js 16 "proxy", formerly middleware).
 * Runs before the rewrites in next.config.ts, so a system path is only forwarded
 * after the platform session and role have been checked.
 */

function getApiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

async function resolvePrincipal(request: NextRequest): Promise<GatewayPrincipal> {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    return 'anonymous';
  }
  try {
    const response = await fetch(`${getApiInternalUrl()}/api/v1/access-context`, {
      headers: { accept: 'application/json', cookie, 'x-alias-disable-refresh': 'true' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return 'anonymous';
    }
    const body = (await response.json()) as { principalType?: string; mfaRequired?: boolean };
    if (body.principalType === 'admin') {
      return body.mfaRequired ? 'anonymous' : 'admin';
    }
    return body.principalType === 'user' ? 'client' : 'anonymous';
  } catch {
    return 'anonymous';
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isGatewayPath(pathname)) {
    return NextResponse.next();
  }

  const decision = decideGatewayAccess(pathname, await resolvePrincipal(request));
  switch (decision.kind) {
    case 'not-gated':
    case 'allow':
      return NextResponse.next();
    case 'forbidden':
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    case 'redirect': {
      const target = new URL(decision.to, request.url);
      if (decision.to === '/login') {
        target.searchParams.set('next', `${pathname}${search}`);
      }
      return NextResponse.redirect(target);
    }
  }
}

export const config = {
  matcher: ['/intake/:path*', '/studio/:path*', '/publish/:path*', '/svc/:path*'],
};

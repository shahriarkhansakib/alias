import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_FORWARD_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-request-id',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
] as const;

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function getApiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

async function proxyRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const targetPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  const incomingUrl = new URL(request.url);
  const upstreamUrl = `${getApiInternalUrl()}/api/${targetPath}${incomingUrl.search}`;

  const headers = new Headers();
  for (const headerName of ALLOWED_FORWARD_HEADERS) {
    const value = request.headers.get(headerName);
    if (value !== null) {
      headers.set(headerName, value);
    }
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers,
    body,
    redirect: 'manual',
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'set-cookie' ||
      lowerKey === 'transfer-encoding' ||
      lowerKey === 'content-encoding' ||
      lowerKey === 'content-length' ||
      lowerKey === 'connection'
    ) {
      return;
    }
    responseHeaders.set(key, value);
  });

  const setCookies = upstreamResponse.headers.getSetCookie();
  for (const cookie of setCookies) {
    responseHeaders.append('set-cookie', cookie);
  }

  if (NULL_BODY_STATUSES.has(upstreamResponse.status)) {
    return new Response(null, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  const responseBody = await upstreamResponse.arrayBuffer();
  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

import type {
  AccessContextResponse,
  ListPlatformAdminsResponse,
  PlatformStatusResponse,
} from '@alias/contracts';
import { cookies } from 'next/headers';

function getApiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

async function fetchFromServerApi<T>(path: string): Promise<T | null> {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map((entry) => `${entry.name}=${entry.value}`)
      .join('; ');

    const headers = new Headers({
      accept: 'application/json',
      'x-alias-disable-refresh': 'true',
    });
    if (cookieHeader.length > 0) {
      headers.set('cookie', cookieHeader);
    }

    const response = await fetch(`${getApiInternalUrl()}${path}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function getServerAccessContext(): Promise<AccessContextResponse | null> {
  return fetchFromServerApi<AccessContextResponse>('/api/v1/access-context');
}

export function getServerPlatformStatus(): Promise<PlatformStatusResponse | null> {
  return fetchFromServerApi<PlatformStatusResponse>('/api/v1/platform/status');
}

export function getServerPlatformAdmins(): Promise<ListPlatformAdminsResponse | null> {
  return fetchFromServerApi<ListPlatformAdminsResponse>('/api/v1/platform/admins');
}

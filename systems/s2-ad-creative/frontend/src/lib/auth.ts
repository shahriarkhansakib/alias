// Client-side authentication helpers for Phase 7.4
const TOKEN_KEY = 'alias_auth_token';
const SESSION_KEY = 'alias_auth_session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface UserSession {
  user: {
    id: string;
    email: string;
    full_name?: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  role: string;
  access_token: string;
}

export function isTokenExpired(token: string): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    if (payload.exp && typeof payload.exp === 'number') {
      // Buffer by 30 seconds before exact expiration
      return Date.now() >= (payload.exp - 30) * 1000;
    }
    return false;
  } catch {
    return true;
  }
}

export function getAuthSession(): UserSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: UserSession = JSON.parse(raw);
    if (session?.access_token && isTokenExpired(session.access_token)) {
      clearAuthSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setAuthSession(session: UserSession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, session.access_token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

let refreshPromise: Promise<UserSession | null> | null = null;

export async function ensureFreshSession(): Promise<UserSession | null> {
  const current = getAuthSession();
  if (current?.access_token && !isTokenExpired(current.access_token)) {
    return current;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await loginWithDevCredentials('developer@example.com');
      if (res.success && res.session) {
        setAuthSession(res.session);
        return res.session;
      }
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function getAuthHeaders(): Record<string, string> {
  const session = getAuthSession();
  if (!session?.access_token) return {};
  return {
    Authorization: `Bearer ${session.access_token}`,
    'X-Tenant-ID': session.tenant?.id || '',
  };
}

export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const session = await ensureFreshSession();
  const headers: Record<string, string> = {
    ...(session?.access_token ? {
      Authorization: `Bearer ${session.access_token}`,
      'X-Tenant-ID': session.tenant?.id || '',
    } : {}),
    ...((init.headers as Record<string, string>) || {}),
  };

  let res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    clearAuthSession();
    const freshSession = await ensureFreshSession();
    if (freshSession?.access_token) {
      const retryHeaders = {
        ...((init.headers as Record<string, string>) || {}),
        Authorization: `Bearer ${freshSession.access_token}`,
        'X-Tenant-ID': freshSession.tenant?.id || '',
      };
      res = await fetch(url, { ...init, headers: retryHeaders });
    }
  }

  return res;
}

export async function loginWithDevCredentials(
  email: string = 'developer@example.com',
  tenantId?: string
): Promise<{ success: boolean; session?: UserSession; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tenant_id: tenantId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      return { success: false, error: err.detail || 'Authentication failed' };
    }

    const data = await res.json();
    const session: UserSession = {
      user: data.user,
      tenant: data.tenant,
      role: data.role,
      access_token: data.access_token,
    };
    setAuthSession(session);
    return { success: true, session };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error during login';
    return { success: false, error: message };
  }
}

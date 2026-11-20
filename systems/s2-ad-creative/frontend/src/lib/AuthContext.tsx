'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserSession, getAuthSession, clearAuthSession, loginWithDevCredentials } from './auth';

interface AuthContextType {
  session: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email?: string, tenantId?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ success: false }),
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSessionState] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Auto-bootstrap or restore session on client mount to prevent SSR hydration mismatch
  useEffect(() => {
    let isMounted = true;

    const restoreOrBootstrap = async () => {
      const existingSession = getAuthSession();
      if (existingSession) {
        if (isMounted) {
          setSessionState(existingSession);
          setIsLoading(false);
        }
        return;
      }

      try {
        const res = await loginWithDevCredentials('developer@example.com');
        if (isMounted && res.success && res.session) {
          setSessionState(res.session);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    restoreOrBootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (email: string = 'developer@example.com', tenantId?: string) => {
    setIsLoading(true);
    const result = await loginWithDevCredentials(email, tenantId);
    if (result.success && result.session) {
      setSessionState(result.session);
    }
    setIsLoading(false);
    return { success: result.success, error: result.error };
  }, []);

  const logout = useCallback(() => {
    clearAuthSession();
    setSessionState(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: !!session?.access_token,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  return useContext(AuthContext);
}

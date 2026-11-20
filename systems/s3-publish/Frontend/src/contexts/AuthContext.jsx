import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiService } from '../services/api';

const AuthContext = createContext(null);

const getSessionKey = (userId) => (userId ? `social_onboarding_completed_${userId}` : null);

const isSessionCompletedForUser = (userId) => {
  if (!userId || typeof window === 'undefined' || !window.sessionStorage) return false;
  try {
    return window.sessionStorage.getItem(getSessionKey(userId)) === 'true';
  } catch {
    return false;
  }
};

const setSessionCompletedForUser = (userId, completed) => {
  if (!userId || typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    const key = getSessionKey(userId);
    if (completed) {
      window.sessionStorage.setItem(key, 'true');
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage may be blocked or restricted
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasSelectedAccount, setHasSelectedAccount] = useState(false);

  useEffect(() => {
    apiService
      .getCurrentUser()
      .then((data) => {
        const currentUser = data?.user || null;
        setUser(currentUser);
        const userId = currentUser?.id || currentUser?.userId;
        // Verify if this specific user already completed onboarding in this browser session
        setHasSelectedAccount(isSessionCompletedForUser(userId));
      })
      .catch(() => {
        setUser(null);
        setHasSelectedAccount(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const data = await apiService.login(email, password);
    const loggedInUser = data?.user || null;
    const userId = loggedInUser?.id || loggedInUser?.userId;
    // Always start a fresh account-selection step on login
    setSessionCompletedForUser(userId, false);
    setUser(loggedInUser);
    setHasSelectedAccount(false);
    return data;
  };

  const signup = async (email, password) => {
    const data = await apiService.signup(email, password);
    const newUser = data?.user || null;
    const userId = newUser?.id || newUser?.userId;
    // Always start a fresh account-selection step on signup
    setSessionCompletedForUser(userId, false);
    setUser(newUser);
    setHasSelectedAccount(false);
    return data;
  };

  const completeAccountSelection = () => {
    const userId = user?.id || user?.userId;
    if (userId) {
      setSessionCompletedForUser(userId, true);
    }
    setHasSelectedAccount(true);
  };

  const resetAccountSelection = () => {
    const userId = user?.id || user?.userId;
    if (userId) {
      setSessionCompletedForUser(userId, false);
    }
    setHasSelectedAccount(false);
  };

  const logout = async () => {
    const userId = user?.id || user?.userId;
    if (userId) {
      setSessionCompletedForUser(userId, false);
    }
    try {
      await apiService.logout();
    } finally {
      setUser(null);
      setHasSelectedAccount(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        hasSelectedAccount,
        completeAccountSelection,
        resetAccountSelection,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

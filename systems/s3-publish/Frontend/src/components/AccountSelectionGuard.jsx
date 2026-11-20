import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from './LoadingSpinner';

/**
 * Route guard that ensures the authenticated user has explicitly chosen an
 * account or completed verified provider onboarding in this session before
 * accessing app feature pages (Dashboard, Create Post, Posts, Analytics).
 */
export default function AccountSelectionGuard({ children }) {
  const { user, loading, hasSelectedAccount } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner text="Verifying session..." />;
  }

  // Not authenticated -> redirect to login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated but has not chosen/connected an account in this session -> redirect to /accounts
  if (!hasSelectedAccount) {
    return <Navigate to="/accounts" replace />;
  }

  return children;
}

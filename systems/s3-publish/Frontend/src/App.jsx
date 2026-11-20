import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import LoadingSpinner from './components/LoadingSpinner';
import ProtectedRoute from './components/ProtectedRoute';
import AccountSelectionGuard from './components/AccountSelectionGuard';
import { AuthProvider } from './contexts/AuthContext';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CreatePostPage = lazy(() => import('./pages/CreatePostPage'));
const PostsPage = lazy(() => import('./pages/PostsPage'));
const PostDetailsPage = lazy(() => import('./pages/PostDetailsPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const SocialAccountsPage = lazy(() => import('./pages/SocialAccountsPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const OwnerSetupPage = lazy(() => import('./pages/OwnerSetupPage'));

export default function App() {
  return (
    <Router basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AuthProvider>
        <Suspense fallback={<LoadingSpinner text="Loading view..." />}>
          <Routes>
            {/* Public auth routes — no MainLayout, no ProtectedRoute */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/owner-setup" element={<OwnerSetupPage />} />

            {/* Protected routes — wrapped in MainLayout */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <MainLayout>
                    <Routes>
                      {/* Social Accounts is directly accessible to complete onboarding */}
                      <Route path="/accounts" element={<SocialAccountsPage />} />
                      <Route path="/social-accounts" element={<SocialAccountsPage />} />

                      {/* App feature routes guarded until account is selected/connected */}
                      <Route
                        path="/"
                        element={
                          <AccountSelectionGuard>
                            <DashboardPage />
                          </AccountSelectionGuard>
                        }
                      />
                      <Route
                        path="/create"
                        element={
                          <AccountSelectionGuard>
                            <CreatePostPage />
                          </AccountSelectionGuard>
                        }
                      />
                      <Route
                        path="/posts"
                        element={
                          <AccountSelectionGuard>
                            <PostsPage />
                          </AccountSelectionGuard>
                        }
                      />
                      <Route
                        path="/posts/:postId"
                        element={
                          <AccountSelectionGuard>
                            <PostDetailsPage />
                          </AccountSelectionGuard>
                        }
                      />
                      <Route
                        path="/analytics"
                        element={
                          <AccountSelectionGuard>
                            <AnalyticsPage />
                          </AccountSelectionGuard>
                        }
                      />

                      {/* Catch-all redirects to /accounts */}
                      <Route path="*" element={<Navigate to="/accounts" replace />} />
                    </Routes>
                  </MainLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { HealthDashboard } from '../components/HealthDashboard';
import { LoginView } from '../components/auth/LoginView';
import { fetchHealth, fetchStatus } from '../lib/api';
import { SystemHealthResponse, SystemStatusResponse } from '../lib/types';
import { useAuth } from '../lib/AuthContext';
import { useIsMounted } from '../lib/useIsMounted';

export default function Home() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const mounted = useIsMounted();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [health, setHealth] = useState<SystemHealthResponse | undefined>(undefined);
  const [status, setStatus] = useState<SystemStatusResponse | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);

  const loadSystemInfo = useCallback(async () => {
    try {
      const [healthRes, statusRes] = await Promise.all([fetchHealth(), fetchStatus()]);
      if (healthRes.data) {
        setHealth(healthRes.data);
      }
      setLatencyMs(healthRes.latencyMs);

      if (statusRes.data) {
        setStatus(statusRes.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadSystemInfo();
    }
  }, [isAuthenticated, loadSystemInfo]);

  if (!mounted || authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-xs">
        Verifying tenant credentials...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Left Sidebar */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header
          health={health}
          loading={loading}
          latencyMs={latencyMs}
          onRefresh={loadSystemInfo}
        />

        {/* Scrollable Dashboard View */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6">
          {activeTab === 'dashboard' && (
            <HealthDashboard
              health={health}
              status={status}
              loading={loading}
              latencyMs={latencyMs}
              onRefresh={loadSystemInfo}
            />
          )}

          {activeTab !== 'dashboard' && (
            <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center space-y-3">
              <h3 className="text-base font-semibold text-slate-300 capitalize">{activeTab} View</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                This module is scheduled for implementation in subsequent phases according to the master roadmap.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

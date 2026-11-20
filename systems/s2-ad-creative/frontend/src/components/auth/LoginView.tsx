'use client';

import React, { useState } from 'react';
import { Building2, ArrowRight, Lock } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';

export const LoginView: React.FC = () => {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('developer@example.com');
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (targetEmail: string) => {
    setError(null);
    const result = await login(targetEmail);
    if (!result.success) {
      setError(result.error || 'Failed to authenticate');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-2">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Campaign Studio Login</h2>
          <p className="text-xs text-slate-400">
            Multi-Tenant Isolation & Authentication Active
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Dev Login Profiles */}
        <div className="space-y-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Select Organization Session
          </span>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => handleLogin('developer@example.com')}
              disabled={isLoading}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/50 transition-all text-left text-xs"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Default Developer (Owner)</div>
                  <div className="text-slate-400 text-[11px]">Default Organization • developer@example.com</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </button>

            <button
              onClick={() => handleLogin('alice@alpha.test')}
              disabled={isLoading}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-purple-500/50 transition-all text-left text-xs"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Alice Alpha (Owner)</div>
                  <div className="text-slate-400 text-[11px]">Alpha Corp • alice@alpha.test</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </button>

            <button
              onClick={() => handleLogin('bob@beta.test')}
              disabled={isLoading}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-cyan-500/50 transition-all text-left text-xs"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Bob Beta (Member)</div>
                  <div className="text-slate-400 text-[11px]">Beta LLC • bob@beta.test</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Custom Email Form */}
        <div className="pt-2 border-t border-slate-800 space-y-3">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
            Or Login with Registered Email
          </label>
          <div className="flex space-x-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@organization.com"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => handleLogin(email)}
              disabled={isLoading || !email}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all"
            >
              Sign In
            </button>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center pt-2">
          <p className="text-[11px] text-slate-400">
            Protected by Server-Verified JWT Tokens & DB Authoritative Membership
          </p>
        </div>
      </div>
    </div>
  );
};

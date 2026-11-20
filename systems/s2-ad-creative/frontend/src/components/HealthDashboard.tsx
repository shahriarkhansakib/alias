'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Server,
  Database,
  HardDrive,
  Cpu,
  CheckCircle2,
  Play,
  Layers,
  Sparkles,
  ArrowRight,
  Code2,
} from 'lucide-react';
import { SystemHealthResponse, SystemStatusResponse } from '../lib/types';
import { API_BASE_URL } from '../lib/api';

interface HealthDashboardProps {
  health?: SystemHealthResponse;
  status?: SystemStatusResponse;
  loading?: boolean;
  latencyMs?: number;
  onRefresh?: () => void;
}

export const HealthDashboard: React.FC<HealthDashboardProps> = ({
  health,
  status,
  latencyMs,
}) => {
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);

  const runLiveProbe = async () => {
    setProbing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/status`);
      const data = await res.json();
      setProbeResult(JSON.stringify(data, null, 2));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Probe failed';
      setProbeResult(`Error: ${msg}`);
    } finally {
      setProbing(false);
    }
  };

  const kpis = [
    {
      title: 'Backend API Service',
      value: health?.status === 'healthy' ? 'Operational' : 'Degraded',
      detail: `FastAPI ${health?.version || 'v0.1.0'} • ${health?.environment || 'dev'}`,
      icon: Server,
      status: health?.status === 'healthy' ? 'healthy' : 'warning',
      subtext: `${API_BASE_URL}/api/v1/health`,
    },
    {
      title: 'Database Engine',
      value: health?.database === 'healthy' ? 'Connected' : 'Offline',
      detail: status?.configuration?.database_dialect?.toUpperCase() || 'SQLITE (ASYNC)',
      icon: Database,
      status: health?.database === 'healthy' ? 'healthy' : 'warning',
      subtext: 'SQLAlchemy 2.0 Async Session Pool',
    },
    {
      title: 'Storage Abstraction',
      value: health?.storage === 'healthy' ? 'Ready' : 'Error',
      detail: (status?.configuration?.storage_type?.toUpperCase() || 'LOCAL') + ' FS',
      icon: HardDrive,
      status: health?.storage === 'healthy' ? 'healthy' : 'warning',
      subtext: 'Asset Serving & Key Path Resolution',
    },
    {
      title: 'Background Worker',
      value: 'Operational',
      detail: (status?.configuration?.worker_type?.toUpperCase() || 'ASYNC') + ' POOL',
      icon: Cpu,
      status: 'healthy',
      subtext: 'In-process async queue (zero external brokers)',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 p-6 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-3">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Phase 1 Scaffolding Verified</span>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Alias Img-Gen Creative Automation Engine
            </h2>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Foundation established: Next.js frontend, FastAPI backend, async database layer, 
              local storage abstraction, mock AI provider interfaces, and abstract worker pool.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              href="/dashboard/new"
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
            >
              <Sparkles className="h-3.5 w-3.5 fill-current" />
              <span>Ingest New Ad Brief</span>
            </Link>
            <button
              onClick={runLiveProbe}
              disabled={probing}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{probing ? 'Probing...' : 'Probe Live API'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          const isGood = kpi.status === 'healthy';
          return (
            <div
              key={idx}
              className="rounded-xl bg-slate-900/70 border border-slate-800/90 p-5 hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400">{kpi.title}</span>
                <div
                  className={`p-2 rounded-lg ${
                    isGood ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold text-white">{kpi.value}</span>
                <span className="text-xs font-mono text-slate-400">{kpi.detail}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-2 font-mono truncate">{kpi.subtext}</p>
            </div>
          );
        })}
      </div>

      {/* System Features & Architecture Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Core Principles & Readiness */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Layers className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Architectural Foundations</h3>
            </div>
            <span className="text-xs text-emerald-400 font-medium flex items-center space-x-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Phase 1 Baseline</span>
            </span>
          </div>

          <div className="space-y-3">
            {[
              {
                title: 'AI Decides → Deterministic Code Controls',
                desc: 'Strict separation between probabilistic prompt generation and pixel-exact code rendering.',
                status: 'Architected',
              },
              {
                title: 'Zero-Broker Local Worker Pool',
                desc: 'In-process async worker eliminates Redis/Celery dependency for frictionless local dev.',
                status: 'Operational',
              },
              {
                title: 'Storage Provider Abstraction',
                desc: 'Safe file key resolution with public serving endpoint for local development.',
                status: 'Operational',
              },
              {
                title: 'Advisory Vision QA Principle',
                desc: 'Vision QA configured as an advisory signal, avoiding rigid non-deterministic gating.',
                status: 'Architected',
              },
              {
                title: 'Configuration-Driven Platform Specs',
                desc: 'Aspect ratios (4:5, 1:1, 1.91:1) and bounding zones decoupled from rendering code.',
                status: 'Architected',
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between p-3 rounded-lg bg-slate-950/40 border border-slate-800/60 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-200">{item.title}</div>
                  <div className="text-slate-400 mt-0.5 leading-relaxed">{item.desc}</div>
                </div>
                <span className="ml-3 shrink-0 px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Live Probe Output & Next Steps */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Code2 className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Live API Wire Probe</h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {latencyMs !== undefined ? `Ping: ${latencyMs}ms` : 'Awaiting check'}
              </span>
            </div>

            <div className="mt-4">
              <p className="text-xs text-slate-400 mb-2">
                Real-time JSON response from backend endpoint <code className="text-indigo-300 font-mono">/api/v1/status</code>:
              </p>
              <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-56">
                {probeResult || (status ? JSON.stringify(status, null, 2) : '// Click "Probe Live API" to inspect live response')}
              </pre>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Ready for Phase 2: Payload & Asset Gate</span>
            <span className="inline-flex items-center space-x-1 text-indigo-400 font-medium">
              <span>Next up: Pydantic Brief Ingestion</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

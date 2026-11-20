'use client';

import React, { useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  History,
  Copy,
  Check,
} from 'lucide-react';
import { DiagnosticCheck, FinalAdProvenance, VisionQAResultSpec } from '../../lib/types';

interface TechnicalDrawerProps {
  stageName: string;
  structuredJson?: unknown;
  generationDetails?: {
    prompt?: string;
    negative_prompt?: string;
    model?: string;
    provider?: string;
    seed?: number | string;
    attempt?: number;
    timestamp?: string;
    cost?: string;
  } | null;
  qaDiagnostics?: {
    status?: 'PASS' | 'WARNING' | 'FAIL';
    checks?: DiagnosticCheck[];
    issues?: string[];
    warnings?: string[];
    visionAdvisory?: VisionQAResultSpec | Record<string, unknown>;
  } | null;
  provenance?: FinalAdProvenance | Record<string, unknown> | null;
  versionHistory?: {
    currentAttempt: number;
    isCached: boolean;
    timestamp?: string;
  } | null;
}

export function TechnicalDrawer({
  stageName,
  structuredJson,
  generationDetails,
  qaDiagnostics,
  provenance,
  versionHistory,
}: TechnicalDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'json' | 'generation' | 'qa' | 'provenance' | 'history'>('json');
  const [copied, setCopied] = useState(false);

  const handleCopyJson = () => {
    if (!structuredJson) return;
    navigator.clipboard.writeText(JSON.stringify(structuredJson, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-t border-slate-800 bg-slate-950/90 backdrop-blur-md transition-all duration-300 shrink-0">
      {/* Drawer Toggle Header Bar */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-slate-800/60 text-xs">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center space-x-2 text-slate-400 hover:text-white font-medium transition-colors cursor-pointer"
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            <span className="font-semibold text-slate-300">Technical Details & Transparency</span>
            <span className="text-[11px] font-mono text-slate-500">({stageName})</span>
          </button>

          {qaDiagnostics?.status && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                qaDiagnostics.status === 'PASS'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : qaDiagnostics.status === 'WARNING'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              QA: {qaDiagnostics.status}
            </span>
          )}
        </div>

        {isOpen && (
          <div className="flex items-center space-x-1 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => setActiveTab('json')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                activeTab === 'json' ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              JSON
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generation')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                activeTab === 'generation' ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Generation
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('qa')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                activeTab === 'qa' ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              QA Diagnostics
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('provenance')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                activeTab === 'provenance' ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Provenance
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                activeTab === 'history' ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Version
            </button>
          </div>
        )}
      </div>

      {/* Expanded Content Panel */}
      {isOpen && (
        <div className="p-6 max-h-72 overflow-y-auto font-mono text-xs text-slate-300 animate-in fade-in duration-150">
          {/* TAB 1: Structured JSON */}
          {activeTab === 'json' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px] font-sans">
                  Structured representation of current stage payload.
                </span>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[11px] transition-all"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>
              <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-indigo-200/90 overflow-x-auto">
                {structuredJson ? JSON.stringify(structuredJson, null, 2) : '// No structured JSON available for this stage'}
              </pre>
            </div>
          )}

          {/* TAB 2: Generation Details */}
          {activeTab === 'generation' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Positive Prompt
                </span>
                <p className="text-xs text-slate-200 leading-relaxed font-sans">
                  {generationDetails?.prompt || 'Deterministic layout engine without generative AI prompt.'}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Negative Prompt & Constraints
                </span>
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  {generationDetails?.negative_prompt || 'text, typography, watermark, logo, product, smartwatch, human face, blurry'}
                </p>
              </div>

              <div className="md:col-span-2 p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-wrap gap-6 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Model & Provider:</span>
                  <span className="text-indigo-400 font-semibold">{generationDetails?.model || 'deterministic-renderer-v1'} ({generationDetails?.provider || 'alias-core'})</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Attempt Number:</span>
                  <span className="text-slate-200 font-semibold">{generationDetails?.attempt || 1}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Timestamp:</span>
                  <span className="text-slate-400">{generationDetails?.timestamp || new Date().toISOString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: QA Diagnostics */}
          {activeTab === 'qa' && (
            <div className="space-y-3">
              <div className="space-y-2">
                {qaDiagnostics?.checks && qaDiagnostics.checks.length > 0 ? (
                  qaDiagnostics.checks.map((check, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start space-x-2.5">
                        {check.passed ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : check.severity === 'WARNING' ? (
                          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="text-xs font-sans text-slate-200 font-medium">{check.details}</p>
                          {check.metrics && (
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                              {JSON.stringify(check.metrics)}
                            </p>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                          check.passed
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : check.severity === 'WARNING'
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {check.severity}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 font-sans">
                    Deterministic checks passed. No validation anomalies recorded.
                  </p>
                )}

                {/* Level 4 Vision Advisory */}
                {qaDiagnostics?.visionAdvisory && (
                  <div className="mt-3 p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-1.5 font-sans">
                    <span className="text-[11px] font-semibold text-indigo-300 flex items-center space-x-1.5">
                      <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Level 4 Final Vision Model Advisory</span>
                    </span>
                    <pre className="text-[11px] font-mono text-indigo-200">
                      {JSON.stringify(qaDiagnostics.visionAdvisory, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: Provenance */}
          {activeTab === 'provenance' && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2 text-xs font-mono">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block font-sans">
                Cryptographic Provenance Chain
              </span>
              <pre className="text-[11px] text-slate-300 overflow-x-auto">
                {provenance ? JSON.stringify(provenance, null, 2) : '// Provenance chain recorded upon artifact finalization'}
              </pre>
            </div>
          )}

          {/* TAB 5: Version History */}
          {activeTab === 'history' && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3 font-sans">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200 flex items-center space-x-2">
                  <History className="h-4 w-4 text-indigo-400" />
                  <span>Current Version: Attempt #{versionHistory?.currentAttempt || 1}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  {versionHistory?.isCached ? 'CACHED (Deterministic Match)' : 'NEWLY SYNTHESIZED'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                To create a new version without losing history, click <strong>Regenerate</strong> in the primary workspace controls.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

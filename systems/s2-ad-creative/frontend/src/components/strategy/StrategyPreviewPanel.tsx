'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Palette,
  Lightbulb,
  Layout,
  Type,
  Ban,
  Info,
} from 'lucide-react';
import {
  StrategyGenerationResponse,
  ClaimAuditItem,
  CopyPolicyClassification,
  BriefPayload,
} from '../../lib/types';
import { generateStrategy } from '../../lib/api';

interface StrategyPreviewPanelProps {
  briefPayload?: BriefPayload | null;
  briefId?: string;
  onStrategyGenerated?: (response: StrategyGenerationResponse) => void;
  initialStrategy?: StrategyGenerationResponse | null;
}

export const StrategyPreviewPanel: React.FC<StrategyPreviewPanelProps> = ({
  briefId,
  onStrategyGenerated,
  initialStrategy,
}) => {
  const [loading, setLoading] = useState(false);
  const [strategyResult, setStrategyResult] = useState<StrategyGenerationResponse | null>(initialStrategy || null);
  const [prevInitial, setPrevInitial] = useState(initialStrategy);

  if (initialStrategy !== prevInitial) {
    setPrevInitial(initialStrategy);
    setStrategyResult(initialStrategy || null);
  }

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'strategy' | 'claims' | 'visuals'>('strategy');

  const handleGenerate = async () => {
    if (!briefId) {
      setErrorMessage('Please save and validate the Ad Brief (passing Asset Gate) before generating a creative strategy.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await generateStrategy({
        brief_id: briefId,
      });

      if (res.error) {
        setErrorMessage(res.error);
      } else if (res.data) {
        setStrategyResult(res.data);
        if (onStrategyGenerated) onStrategyGenerated(res.data);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  const getSourceBadge = (policy?: CopyPolicyClassification) => {
    switch (policy) {
      case 'FACTUAL':
      case 'USER_PROVIDED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
            FACTUAL / BRIEF
          </span>
        );
      case 'AI_GENERATED_CREATIVE':
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="h-2.5 w-2.5 mr-1" />
            AI CREATIVE COPY
          </span>
        );
    }
  };

  const renderClaimAuditItem = (item: ClaimAuditItem, index: number) => {
    let icon = <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    let statusBg = 'bg-emerald-950/20 border-emerald-500/30';
    let statusText = '✓ Supported Fact';

    if (!item.is_supported) {
      icon = <XCircle className="h-4 w-4 text-rose-400 shrink-0" />;
      statusBg = 'bg-rose-950/20 border-rose-500/30';
      statusText = '✕ Unsupported Claim (Rejected)';
    } else if (item.classification === 'AI_GENERATED_CREATIVE') {
      icon = <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />;
      statusBg = 'bg-amber-950/20 border-amber-500/30';
      statusText = '⚠ AI Creative Wording (Non-Factual)';
    }

    return (
      <div
        key={index}
        className={`p-3.5 rounded-lg border ${statusBg} flex flex-col space-y-2 transition-all`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start space-x-2.5">
            <div className="mt-0.5">{icon}</div>
            <div>
              <p className="text-xs font-semibold text-white tracking-wide font-mono">
                &quot;{item.text_segment}&quot;
              </p>
              {item.reason && (
                <p className="text-[11px] text-slate-300 mt-0.5">{item.reason}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                !item.is_supported
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : item.classification === 'AI_GENERATED_CREATIVE'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {statusText}
            </span>
            {getSourceBadge(item.classification)}
          </div>
        </div>

        {item.source_reference && (
          <div className="text-[11px] font-mono text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800/80 flex items-center space-x-1.5">
            <Info className="h-3 w-3 text-indigo-400 shrink-0" />
            <span className="truncate">Evidence in Brief: {item.source_reference}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Creative Strategy & Claim Gate
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Phase 3 Active
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Generate deterministic ad strategy with hard claim validation, copy policies, and approved templates.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {!briefId && (
            <div className="flex items-center space-x-1.5 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Save & validate Ad Brief (Step 1) first</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !briefId}
            title={!briefId ? 'Please save and validate the Ad Brief (passing Asset Gate) first' : undefined}
            className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-xs shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <>
                <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Generating & Gating...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>{strategyResult ? 'Regenerate Strategy' : 'Generate Creative Strategy'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-rose-200">Strategy Generation/Validation Failed:</span>
            <p className="text-rose-300/90">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Empty State before first generation */}
      {!strategyResult && !loading && !errorMessage && (
        <div className="py-12 px-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center space-y-3">
          <div className="p-3 bg-slate-900 rounded-full w-fit mx-auto border border-slate-800 text-slate-500">
            <Layout className="h-6 w-6" />
          </div>
          <h4 className="text-sm font-semibold text-slate-300">Ready to Strategize</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Click <strong>Generate Creative Strategy</strong> to transform your validated ad brief into a structured, claim-gated advertising direction.
          </p>
        </div>
      )}

      {/* Strategy Display */}
      {strategyResult && strategyResult.strategy && (
        <div className="space-y-6">
          {/* Top Status & Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">Status</span>
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="h-3 w-3" />
                {strategyResult.status === 'APPROVED' ? 'APPROVED STRATEGY' : 'REJECTED STRATEGY'}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">Template ID</span>
              <span className="text-xs font-mono font-medium text-indigo-300 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-800/40 inline-block mt-0.5">
                {strategyResult.strategy.template_id}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">Claim Gate</span>
              <span className="text-xs font-semibold text-emerald-300 block mt-0.5">
                {strategyResult.claim_report.passed ? 'PASSED (0 Violations)' : 'FAILED'}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">Attempts</span>
              <span className="text-xs font-mono text-slate-300 block mt-0.5">
                {strategyResult.retry_count + 1} of 3 attempts
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('strategy')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'strategy'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Lightbulb className="h-3.5 w-3.5" />
              Creative Concept & Copy
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('claims')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'claims'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Claim Gate Audit Matrix ({strategyResult.claim_report.claims_audit?.length || 0})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('visuals')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'visuals'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Palette className="h-3.5 w-3.5" />
              Visual Direction & Atmosphere
            </button>
          </div>

          {/* TAB 1: CREATIVE CONCEPT & COPY */}
          {activeTab === 'strategy' && (
            <div className="space-y-5">
              {/* Concept Card */}
              <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                    <Lightbulb className="h-4 w-4" />
                    Creative Concept
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded">
                    Angle: {strategyResult.strategy.concept.creative_angle || strategyResult.strategy.concept.angle}
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {strategyResult.strategy.concept.name}
                  </h3>
                  {(strategyResult.strategy.concept.reasoning_notes || strategyResult.strategy.concept.notes) && (
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {strategyResult.strategy.concept.reasoning_notes || strategyResult.strategy.concept.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Copy Hierarchy with Copy Policy Badges */}
              <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Type className="h-4 w-4 text-indigo-400" />
                    Ad Copy Spec & Source Policies
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Source policy strictly tagged
                  </span>
                </div>

                {/* Headline */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase text-slate-400">Headline</span>
                    {getSourceBadge(strategyResult.strategy.copy_spec.headline_policy)}
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800 text-sm font-bold text-white tracking-tight">
                    {strategyResult.strategy.copy_spec.headline}
                  </div>
                </div>

                {/* Subheadline */}
                {strategyResult.strategy.copy_spec.subheadline && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-slate-400">Subheadline</span>
                      {getSourceBadge(strategyResult.strategy.copy_spec.subheadline_policy)}
                    </div>
                    <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800 text-xs text-slate-200">
                      {strategyResult.strategy.copy_spec.subheadline}
                    </div>
                  </div>
                )}

                {/* CTA */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase text-slate-400">Call to Action (CTA)</span>
                    {getSourceBadge(strategyResult.strategy.copy_spec.cta_policy)}
                  </div>
                  <div className="p-2 rounded bg-indigo-950/30 border border-indigo-800/40 text-xs font-bold text-indigo-200">
                    {strategyResult.strategy.copy_spec.cta}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CLAIM GATE AUDIT MATRIX */}
          {activeTab === 'claims' && (
            <div className="space-y-4">
              {/* Summary Stats Header */}
              <div className="grid grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
                <div className="text-center p-2 rounded bg-emerald-950/20 border border-emerald-500/20">
                  <span className="text-[10px] text-emerald-400 uppercase font-mono block">Supported Facts</span>
                  <span className="text-lg font-bold text-emerald-300">
                    {strategyResult.claim_report.supported_facts?.length || 0}
                  </span>
                </div>

                <div className="text-center p-2 rounded bg-amber-950/20 border border-amber-500/20">
                  <span className="text-[10px] text-amber-400 uppercase font-mono block">Creative Flourishes</span>
                  <span className="text-lg font-bold text-amber-300">
                    {strategyResult.claim_report.creative_flourishes?.length || 0}
                  </span>
                </div>

                <div className="text-center p-2 rounded bg-rose-950/20 border border-rose-500/20">
                  <span className="text-[10px] text-rose-400 uppercase font-mono block">Unsupported Claims</span>
                  <span className="text-lg font-bold text-rose-300">
                    {strategyResult.claim_report.unsupported_claims?.length || 0}
                  </span>
                </div>
              </div>

              {/* Summary Message */}
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 font-mono">
                {strategyResult.claim_report.summary}
              </div>

              {/* Claim Audit List */}
              <div className="space-y-2.5">
                {strategyResult.claim_report.claims_audit?.map((item, idx) =>
                  renderClaimAuditItem(item, idx)
                )}
              </div>
            </div>
          )}

          {/* TAB 3: VISUAL DIRECTION */}
          {activeTab === 'visuals' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-400">Mood Atmosphere</span>
                  <p className="text-xs font-medium text-slate-200">
                    {strategyResult.strategy.visual_direction.mood}
                  </p>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-400">Lighting Setup</span>
                  <p className="text-xs font-medium text-slate-200">
                    {strategyResult.strategy.visual_direction.lighting}
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5">
                <span className="text-[10px] font-mono uppercase text-slate-400">Background Generation Direction</span>
                <p className="text-xs text-slate-200 leading-relaxed font-mono bg-slate-950/60 p-2.5 rounded border border-slate-800">
                  {strategyResult.strategy.visual_direction.background_direction}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Product Placement:</span>
                  <span className="text-xs font-mono text-indigo-300 font-semibold">
                    {strategyResult.strategy.visual_direction.product_placement}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Text Placement:</span>
                  <span className="text-xs font-mono text-indigo-300 font-semibold">
                    {strategyResult.strategy.visual_direction.text_placement}
                  </span>
                </div>
              </div>

              {/* Negative Prompt */}
              <div className="p-3.5 rounded-lg bg-rose-950/20 border border-rose-900/30 space-y-1.5">
                <span className="text-[10px] font-mono uppercase text-rose-400 flex items-center gap-1">
                  <Ban className="h-3 w-3" />
                  Negative Prompt Direction (Artifact Exclusion)
                </span>
                <p className="text-xs text-slate-300 font-mono bg-slate-950/80 p-2.5 rounded border border-slate-800">
                  {strategyResult.strategy.visual_direction.negative_prompt}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

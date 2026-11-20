'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Image as ImageIcon,
  Zap,
  Info,
} from 'lucide-react';
import {
  TargetPlatform,
  BackgroundResponse,
  DiagnosticCheck,
} from '../../lib/types';
import { generateBackground, regenerateBackground, API_BASE_URL } from '../../lib/api';
import { getAuthSession } from '../../lib/auth';

interface BackgroundPreviewPanelProps {
  strategyId?: string;
  templateId?: string;
  onBackgroundGenerated?: (bg: BackgroundResponse | null) => void;
  initialBackground?: BackgroundResponse | null;
  platform?: TargetPlatform;
}

export function BackgroundPreviewPanel({
  strategyId,
  onBackgroundGenerated,
  initialBackground,
  platform: platformProp,
}: BackgroundPreviewPanelProps) {
  const [localPlatform, setLocalPlatform] = useState<TargetPlatform>(platformProp || 'instagram');
  const platform = platformProp || localPlatform;
  const setPlatform = (p: TargetPlatform) => setLocalPlatform(p);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backgroundData, setBackgroundData] = useState<BackgroundResponse | null>(initialBackground || null);
  const [prevInitial, setPrevInitial] = useState(initialBackground);
  const [prevPlatformProp, setPrevPlatformProp] = useState(platformProp);
  const forceRegenerate = false;

  if (initialBackground !== prevInitial) {
    setPrevInitial(initialBackground);
    setBackgroundData(initialBackground || null);
  }

  if (platformProp && platformProp !== prevPlatformProp) {
    setPrevPlatformProp(platformProp);
    setLocalPlatform(platformProp);
  }

  // Regeneration states
  const [customFeedback, setCustomFeedback] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleGenerate = async () => {
    if (!strategyId) {
      setError('Please generate and approve a Creative Strategy first.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await generateBackground({
      strategy_id: strategyId,
      platform,
      force_regenerate: forceRegenerate,
    });

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setBackgroundData(res.data);
      onBackgroundGenerated?.(res.data);
    }

    setLoading(false);
  };

  const handleRegenerate = async () => {
    if (!backgroundData) return;

    setIsRegenerating(true);
    setError(null);

    const res = await regenerateBackground(
      backgroundData.id,
      customFeedback.trim() || undefined
    );

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setBackgroundData(res.data);
      onBackgroundGenerated?.(res.data);
      setCustomFeedback('');
    }

    setIsRegenerating(false);
  };

  const getFullImageUrl = (path: string) => {
    if (!path) return '';
    let url = path.startsWith('http://') || path.startsWith('https://') ? path : `${API_BASE_URL}${path}`;
    const session = getAuthSession();
    if (session?.access_token && url.includes('/storage/')) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}token=${encodeURIComponent(session.access_token)}`;
    }
    return url;
  };

  const renderStatusBadge = (status: 'PASS' | 'WARNING' | 'FAIL') => {
    switch (status) {
      case 'PASS':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> QA PASSED
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> QA ADVISORY WARNING
          </span>
        );
      case 'FAIL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" /> QA REJECTED
          </span>
        );
    }
  };

  const renderDiagnosticRow = (label: string, check: DiagnosticCheck) => {
    const isPass = check.severity === 'PASS';
    const isWarn = check.severity === 'WARNING';

    return (
      <div className="flex items-start justify-between py-2 border-b border-slate-800/60 last:border-0 text-xs">
        <div className="space-y-0.5 max-w-[70%]">
          <div className="font-medium text-slate-300 flex items-center gap-1.5">
            {isPass ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : isWarn ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            )}
            <span>{label}</span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono pl-5">{check.details}</p>
        </div>
        <div className="text-right font-mono text-[11px]">
          <span
            className={
              isPass ? 'text-emerald-400' : isWarn ? 'text-amber-400' : 'text-rose-400 font-bold'
            }
          >
            {Math.round(check.score * 100)}%
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
              <ImageIcon className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-white tracking-wide">
              Phase 4: AI Visual Environment & Background QA
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Synthesizes visual scenery only (no product/copy). Deterministic code validates dimensions, negative space, and artifacts.
          </p>
        </div>

        {/* Platform Selection Buttons */}
        <div className="flex items-center bg-slate-950/80 p-1 rounded-lg border border-slate-800 text-xs font-medium">
          <button
            type="button"
            onClick={() => setPlatform('instagram')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              platform === 'instagram'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Instagram (4:5)
          </button>
          <button
            type="button"
            onClick={() => setPlatform('facebook')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              platform === 'facebook'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Facebook (1:1)
          </button>
          <button
            type="button"
            onClick={() => setPlatform('linkedin')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              platform === 'linkedin'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            LinkedIn (1.91:1)
          </button>
        </div>
      </div>

      {/* Control Actions & Strategy Requirement Notice */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            disabled={loading || !strategyId}
            onClick={handleGenerate}
            className={`px-5 py-2.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-2 shadow-lg cursor-pointer ${
              loading || !strategyId
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 active:scale-95'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Synthesizing Background...
              </>
            ) : backgroundData ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate Background ({platform.toUpperCase()})
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                Generate Background ({platform.toUpperCase()})
              </>
            )}
          </button>
        </div>

        {!strategyId && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-mono bg-amber-500/10 px-3 py-1.5 rounded-md border border-amber-500/20">
            <Info className="w-3.5 h-3.5" />
            <span>Requires an approved Creative Strategy from Step 2</span>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-300 text-xs flex items-start gap-2.5 font-mono">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Generation Results Display */}
      {backgroundData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 border-t border-slate-800 items-start">
          {/* Left Column: Image Preview Canvas (5 cols) */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                Visual Environment Preview
              </span>
              <span className="font-mono text-[11px]">
                {backgroundData.width} × {backgroundData.height} ({backgroundData.aspect_ratio})
              </span>
            </div>

            {/* Canvas Container */}
            <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950/80 shadow-2xl flex items-center justify-center p-2">
              <img
                src={getFullImageUrl(backgroundData.image_url)}
                alt="Generated Background Scenery"
                className="max-h-[380px] w-auto object-contain rounded-lg shadow-inner"
              />

              {/* Watermark/Badges Overlay */}
              <div className="absolute top-4 left-4 flex flex-col gap-1.5">
                {backgroundData.is_cached ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/80 text-white font-bold backdrop-blur-md shadow">
                    CACHED
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/80 text-white font-bold backdrop-blur-md shadow">
                    FRESH (ATTEMPT {backgroundData.attempt_number})
                  </span>
                )}
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900/80 text-slate-300 backdrop-blur-md border border-slate-700">
                  {backgroundData.provider} / {backgroundData.model_name}
                </span>
              </div>
            </div>

            {/* Scenery Prompt Inspector */}
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg space-y-1.5 text-xs">
              <div className="font-mono text-[11px] text-slate-400 flex items-center justify-between">
                <span>Prompt (Untrusted Brief Text Isolated):</span>
                <span className="text-indigo-400">{backgroundData.prompt.prompt_version}</span>
              </div>
              <p className="text-slate-300 text-[11px] line-clamp-2 italic">
                &quot;{backgroundData.prompt.positive_prompt}&quot;
              </p>
            </div>
          </div>

          {/* Right Column: QA Diagnostic Scorecard (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    Deterministic Background QA Scorecard
                  </div>
                  <div className="text-[11px] text-slate-400">
                    7-Point automated suitability evaluation before product compositing
                  </div>
                </div>

                {renderStatusBadge(backgroundData.qa_status)}
              </div>

              {/* Overall Score Meter */}
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">Overall Suitability Score</span>
                  <span
                    className={
                      backgroundData.qa_result.overall_score >= 0.85
                        ? 'text-emerald-400 font-bold'
                        : 'text-amber-400 font-bold'
                    }
                  >
                    {Math.round(backgroundData.qa_result.overall_score * 100)} / 100
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      backgroundData.qa_result.overall_score >= 0.85
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        : backgroundData.qa_result.overall_score >= 0.6
                        ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                        : 'bg-gradient-to-r from-rose-500 to-red-400'
                    }`}
                    style={{ width: `${backgroundData.qa_result.overall_score * 100}%` }}
                  />
                </div>
              </div>

              {/* 7 Diagnostic Checks List */}
              <div className="pt-2 divide-y divide-slate-800/40">
                {renderDiagnosticRow('Dimensions & Aspect Ratio', backgroundData.qa_result.dimension_check)}
                {renderDiagnosticRow('Text / Glyph Artifact Detection', backgroundData.qa_result.text_artifact_check)}
                {renderDiagnosticRow('Logo / Watermark Detection', backgroundData.qa_result.watermark_check)}
                {renderDiagnosticRow('Product-Safe Area Obstruction', backgroundData.qa_result.extra_object_check)}
                {renderDiagnosticRow('Negative Space in Text Zone', backgroundData.qa_result.negative_space_check)}
                {renderDiagnosticRow('Product Stage Cleanliness', backgroundData.qa_result.product_safe_zone_check)}
                {renderDiagnosticRow('Luminance & Contrast Legibility', backgroundData.qa_result.brightness_check)}
              </div>

              {/* Advisory Warnings Notice (Non-blocking concerns preserved) */}
              {backgroundData.qa_result.warnings && backgroundData.qa_result.warnings.length > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs space-y-1">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5 font-mono text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Advisory Warnings (Non-Blocking):
                  </div>
                  <ul className="list-disc list-inside text-amber-200/90 text-[11px] space-y-0.5">
                    {backgroundData.qa_result.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Issues / Retry Guidance Notice */}
              {backgroundData.qa_result.retry_guidance && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs space-y-1">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5 font-mono text-[11px]">
                    <Zap className="w-3.5 h-3.5" />
                    Targeted Correction Guidance for Next Attempt:
                  </div>
                  <p className="text-amber-200/90 text-[11px]">
                    {backgroundData.qa_result.retry_guidance}
                  </p>
                </div>
              )}

              {/* Targeted Regeneration Controls */}
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  placeholder="Optional developer feedback guidance..."
                  value={customFeedback}
                  onChange={(e) => setCustomFeedback(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                />

                <button
                  type="button"
                  disabled={isRegenerating}
                  onClick={handleRegenerate}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                  {isRegenerating ? 'Regenerating...' : 'Targeted Regenerate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

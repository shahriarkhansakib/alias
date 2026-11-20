'use client';

import React, { useState } from 'react';
import {
  Layers,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Info,
  Eye,
} from 'lucide-react';
import {
  CompositeResponse,
  DiagnosticCheck,
} from '../../lib/types';
import { generateComposite, regenerateComposite, API_BASE_URL } from '../../lib/api';
import { getAuthSession } from '../../lib/auth';

interface CompositePreviewPanelProps {
  backgroundId?: string;
  platform?: string;
  productAssetUrl?: string;
  onCompositeGenerated?: (composite: CompositeResponse) => void;
  initialComposite?: CompositeResponse | null;
}

export function CompositePreviewPanel({
  backgroundId,
  platform = 'instagram',
  productAssetUrl,
  onCompositeGenerated,
  initialComposite,
}: CompositePreviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compositeData, setCompositeData] = useState<CompositeResponse | null>(initialComposite || null);
  const [prevInitial, setPrevInitial] = useState(initialComposite);

  if (initialComposite !== prevInitial) {
    setPrevInitial(initialComposite);
    setCompositeData(initialComposite || null);
  }

  // Placement & Shadow controls
  const [scale, setScale] = useState<number>(0.90);
  const [alignment, setAlignment] = useState<'center' | 'bottom' | 'left' | 'right'>('center');
  const [shadowEnabled, setShadowEnabled] = useState<boolean>(true);
  const shadowOpacity = 0.35;
  const [isRecompositing, setIsRecompositing] = useState<boolean>(false);
  const [customFeedback, setCustomFeedback] = useState<string>('');

  const handleGenerate = async () => {
    if (!backgroundId) {
      setError('Please generate and approve a Background in Step 3 first.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await generateComposite({
      background_id: backgroundId,
      product_image_url: productAssetUrl,
      placement: {
        scale,
        alignment,
      },
      shadow: {
        enabled: shadowEnabled,
        opacity: shadowOpacity,
      },
      force_regenerate: true,
    });

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setCompositeData(res.data);
      if (onCompositeGenerated) {
        onCompositeGenerated(res.data);
      }
    }

    setLoading(false);
  };

  const handleRecomposite = async () => {
    if (!compositeData) return;

    setIsRecompositing(true);
    setError(null);

    const res = await regenerateComposite(compositeData.id, {
      product_image_url: productAssetUrl,
      placement: {
        scale,
        alignment,
      },
      shadow: {
        enabled: shadowEnabled,
        opacity: shadowOpacity,
      },
      custom_feedback: customFeedback.trim() || undefined,
    });

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setCompositeData(res.data);
      if (onCompositeGenerated) {
        onCompositeGenerated(res.data);
      }
      setCustomFeedback('');
    }

    setIsRecompositing(false);
  };

  const getFullImageUrl = (path?: string) => {
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
            <CheckCircle2 className="w-3.5 h-3.5" /> COMPOSITE PASSED
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> COMPOSITE ADVISORY
          </span>
        );
      case 'FAIL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" /> COMPOSITE REJECTED
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
            <div className="p-1.5 bg-violet-500/10 rounded-lg text-violet-400 border border-violet-500/20">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-white tracking-wide">
              Phase 5: Product Cutout & Deterministic Compositing
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Places authentic customer product asset onto approved AI background without redesigning or hallucinating product pixels.
          </p>
        </div>

        {backgroundId ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" /> Background Ready ({platform.toUpperCase()})
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
            <Info className="w-3.5 h-3.5 text-amber-400" /> Awaiting Step 3 Background
          </span>
        )}
      </div>

      {/* Control Actions & Placement Configuration */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-slate-950/50 rounded-lg border border-slate-800 text-xs">
        {/* Scale Slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-slate-300 font-medium">
            <span>Product Scale</span>
            <span className="font-mono text-violet-400">{Math.round(scale * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="1.2"
            step="0.05"
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="w-full accent-violet-500 cursor-pointer"
          />
        </div>

        {/* Alignment Selector */}
        <div className="space-y-1.5">
          <label className="text-slate-300 font-medium block">Safe Slot Alignment</label>
          <select
            value={alignment}
            onChange={(e) => setAlignment(e.target.value as 'center' | 'bottom' | 'left' | 'right')}
            className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 focus:outline-none focus:border-violet-500 font-mono text-xs"
          >
            <option value="center">Center</option>
            <option value="bottom">Bottom Grounded</option>
            <option value="left">Left Aligned</option>
            <option value="right">Right Aligned</option>
          </select>
        </div>

        {/* Shadow Options */}
        <div className="space-y-1.5">
          <label className="text-slate-300 font-medium block">Deterministic Shadow</label>
          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-400">
              <input
                type="checkbox"
                checked={shadowEnabled}
                onChange={(e) => setShadowEnabled(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-0 w-3.5 h-3.5"
              />
              <span>Enabled</span>
            </label>
            {shadowEnabled && (
              <span className="font-mono text-[11px] text-slate-500">
                {Math.round(shadowOpacity * 100)}% opacity
              </span>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex flex-col justify-end">
          <button
            type="button"
            disabled={loading || !backgroundId}
            onClick={handleGenerate}
            className={`w-full py-2 px-3 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-lg ${
              loading || !backgroundId
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-500/20 active:scale-95'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Compositing Product...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-violet-200" />
                Composite Product onto Background
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-300 text-xs flex items-start gap-2.5 font-mono">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Composited Results Display */}
      {compositeData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 border-t border-slate-800 items-start">
          {/* Left Column: Image Canvas Preview (5 cols) */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-violet-400" />
                Composited Creative Preview
              </span>
              <span className="font-mono text-[11px]">
                {compositeData.width} × {compositeData.height} ({compositeData.aspect_ratio})
              </span>
            </div>

            {/* Canvas Container */}
            <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950/80 shadow-2xl flex items-center justify-center p-2">
              <img
                src={getFullImageUrl(compositeData.image_url)}
                alt="Composited Product Advertisement"
                className="max-h-[380px] w-auto object-contain rounded-lg shadow-inner"
              />

              {/* Watermark/Badges Overlay */}
              <div className="absolute top-4 left-4 flex flex-col gap-1.5">
                {compositeData.is_cached ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/80 text-white font-bold backdrop-blur-md shadow">
                    CACHED
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-violet-500/80 text-white font-bold backdrop-blur-md shadow">
                    FRESH COMPOSITE
                  </span>
                )}
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900/80 text-slate-300 backdrop-blur-md border border-slate-700">
                  Box: {compositeData.placement_spec.width}×{compositeData.placement_spec.height} at ({compositeData.placement_spec.x}, {compositeData.placement_spec.y})
                </span>
              </div>
            </div>

            {/* Product Authenticity Audit Badge */}
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg space-y-1.5 text-xs">
              <div className="font-mono text-[11px] text-slate-400 flex items-center justify-between">
                <span>Product Pixel Cryptographic Proof:</span>
                <span className="text-emerald-400 font-bold">AUTHENTIC SOURCE</span>
              </div>
              <div className="text-[10px] font-mono text-slate-400 space-y-0.5 break-all">
                <p>Asset ID: {compositeData.integrity_metadata.source_asset_id}</p>
                <p>Asset Hash: {compositeData.integrity_metadata.source_asset_hash.slice(0, 24)}...</p>
                <p>Output Hash: {compositeData.integrity_metadata.output_hash.slice(0, 24)}...</p>
              </div>
            </div>
          </div>

          {/* Right Column: QA Diagnostic Scorecard (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-violet-400" />
                    Deterministic Composite QA Scorecard
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Automated placement, boundary, and alpha blending verification
                  </div>
                </div>

                {renderStatusBadge(compositeData.qa_status)}
              </div>

              {/* Overall Score Meter */}
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">Compositing Score</span>
                  <span
                    className={
                      compositeData.qa_result.overall_score >= 0.85
                        ? 'text-emerald-400 font-bold'
                        : 'text-amber-400 font-bold'
                    }
                  >
                    {Math.round(compositeData.qa_result.overall_score * 100)} / 100
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      compositeData.qa_result.overall_score >= 0.85
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        : compositeData.qa_result.overall_score >= 0.6
                        ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                        : 'bg-gradient-to-r from-rose-500 to-red-400'
                    }`}
                    style={{ width: `${compositeData.qa_result.overall_score * 100}%` }}
                  />
                </div>
              </div>

              {/* 5 Diagnostic Checks List */}
              <div className="pt-2 divide-y divide-slate-800/40">
                {renderDiagnosticRow('Dimensions & Aspect Ratio', compositeData.qa_result.dimension_check)}
                {renderDiagnosticRow('Canvas Boundary Containment', compositeData.qa_result.boundary_check)}
                {renderDiagnosticRow('Product-Safe Slot Placement', compositeData.qa_result.placement_check)}
                {renderDiagnosticRow('Product Visibility & Contrast', compositeData.qa_result.visibility_check)}
                {renderDiagnosticRow('Output Integrity & Opacity', compositeData.qa_result.integrity_check)}
              </div>

              {/* Advisory Warnings Notice */}
              {compositeData.qa_result.warnings && compositeData.qa_result.warnings.length > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs space-y-1">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5 font-mono text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Advisory Warnings:
                  </div>
                  <ul className="list-disc list-inside text-amber-200/90 text-[11px] space-y-0.5">
                    {compositeData.qa_result.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Targeted Recompositing Controls */}
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  placeholder="Optional placement adjustment note..."
                  value={customFeedback}
                  onChange={(e) => setCustomFeedback(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 font-mono"
                />

                <button
                  type="button"
                  disabled={loading || !backgroundId}
                  onClick={handleGenerate}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0 shadow-md shadow-indigo-600/20 cursor-pointer"
                  title="Force a fresh composite using the active product cutout"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Compositing...' : '⚡ Fresh Composite'}
                </button>

                <button
                  type="button"
                  disabled={isRecompositing}
                  onClick={handleRecomposite}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRecompositing ? 'animate-spin' : ''}`} />
                  {isRecompositing ? 'Recompositing...' : 'Recomposite'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

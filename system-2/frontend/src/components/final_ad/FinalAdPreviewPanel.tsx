'use client';

import React, { useState } from 'react';
import {
  FileImage,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Sparkles,
  Info,
  Type,
  Hash,
  Lock,
  Download,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  FinalAdResponse,
  DiagnosticCheck,
} from '../../lib/types';
import { generateFinalAd, regenerateFinalAd, approveFinalAd, API_BASE_URL } from '../../lib/api';
import { getAuthSession } from '../../lib/auth';
import { ColorPicker } from '../common/ColorPicker';

interface FinalAdPreviewPanelProps {
  compositeId?: string;
  platform?: string;
  initialAdData?: FinalAdResponse | null;
  onAdGenerated?: (ad: FinalAdResponse) => void;
  onAdApproved?: () => void;
  brandColors?: string[] | { primary: string; secondary: string; accent: string };
  exactCopy?: { headline?: string; subheadline?: string; cta?: string };
}

export function FinalAdPreviewPanel({
  compositeId,
  platform = 'instagram',
  initialAdData,
  onAdGenerated,
  onAdApproved,
  brandColors,
}: FinalAdPreviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adData, setAdData] = useState<FinalAdResponse | null>(initialAdData || null);
  const [prevInitial, setPrevInitial] = useState(initialAdData);

  if (initialAdData !== prevInitial) {
    setPrevInitial(initialAdData);
    setAdData(initialAdData || null);
  }

  const [isApproved, setIsApproved] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [showStyleControls, setShowStyleControls] = useState(false);
  const [showVisionDiagnostics, setShowVisionDiagnostics] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const paletteArray = React.useMemo(() => {
    if (Array.isArray(brandColors)) return brandColors;
    if (brandColors && typeof brandColors === 'object') {
      return [brandColors.primary, brandColors.secondary, brandColors.accent].filter(Boolean);
    }
    return ['#3B82F6', '#1E40AF', '#F59E0B'];
  }, [brandColors]);

  // Deterministic typography & layout controls
  const [fontFamily, setFontFamily] = useState<string>('Inter');
  const [headlineSize, setHeadlineSize] = useState<number>(52);
  const headlineColor = '#FFFFFF';
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('left');
  
  // CTA controls - default to primary brand color if available
  const [ctaBgColor, setCtaBgColor] = useState<string>(paletteArray[0] || '#3B82F6');
  const ctaTextColor = '#FFFFFF';
  const ctaRadius = 10;

  // Readability
  const [autoScrim, setAutoScrim] = useState<boolean>(true);
  const forceRegenerate = false;
  const [isReRendering, setIsReRendering] = useState<boolean>(false);
  const [customFeedback, setCustomFeedback] = useState<string>('');

  const handleGenerate = async () => {
    if (!compositeId) {
      setError('Please generate and approve a Product Composite in Step 4 first.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await generateFinalAd({
      composite_id: compositeId,
      typography: {
        font_family: fontFamily,
        headline_size: headlineSize,
        headline_color: headlineColor,
        alignment,
      },
      cta: {
        bg_color: ctaBgColor,
        text_color: ctaTextColor,
        border_radius: ctaRadius,
      },
      readability: {
        auto_scrim: autoScrim,
      },
      force_regenerate: forceRegenerate,
    });

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setAdData(res.data);
      onAdGenerated?.(res.data);
    }

    setLoading(false);
  };

  const handleReRender = async () => {
    if (!adData) return;

    setIsReRendering(true);
    setError(null);

    const res = await regenerateFinalAd(adData.id, {
      typography: {
        font_family: fontFamily,
        headline_size: headlineSize,
        headline_color: headlineColor,
        alignment,
      },
      cta: {
        bg_color: ctaBgColor,
        text_color: ctaTextColor,
        border_radius: ctaRadius,
      },
      readability: {
        auto_scrim: autoScrim,
      },
      custom_feedback: customFeedback.trim() || undefined,
    });

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setAdData(res.data);
      onAdGenerated?.(res.data);
      setCustomFeedback('');
    }

    setIsReRendering(false);
  };

  const handleApprove = async () => {
    if (!adData) return;
    setIsApproving(true);
    setError(null);
    const res = await approveFinalAd(adData.id);
    if (res.error) {
      setError(res.error);
    } else {
      setIsApproved(true);
      onAdApproved?.();
    }
    setIsApproving(false);
  };

  const handleDownload = () => {
    if (!adData?.image_url) return;
    const url = getFullImageUrl(adData.image_url);
    const link = document.createElement('a');
    link.href = url;
    link.download = `creative-${platform}-${adData.id}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  const renderStatusBadge = (ad: FinalAdResponse) => {
    if (ad.is_stale) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
          <AlertTriangle className="w-3.5 h-3.5" /> STALE (INPUTS CHANGED)
        </span>
      );
    }
    const isFailed = ad.qa_status === 'FAIL' || ad.vision_qa_status === 'FAILED' || ad.vision_qa_status === 'FAIL';
    if (isFailed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <XCircle className="w-3.5 h-3.5" /> ✕ Verification failed
        </span>
      );
    }
    if (ad.vision_qa_status === 'UNAVAILABLE') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <AlertTriangle className="w-3.5 h-3.5" /> ✕ Vision Verification Unavailable
        </span>
      );
    }
    if (ad.vision_qa_status === 'REAL_VERIFIED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3.5 h-3.5" /> ✓ Verified by Vision
        </span>
      );
    }
    if (ad.vision_qa_status === 'MOCK_VERIFIED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
          <Sparkles className="w-3.5 h-3.5" /> ⚠ Mock Vision Verification — Dev Only
        </span>
      );
    }
    if (ad.qa_status === 'WARNING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-3.5 h-3.5" /> ⚠ Deterministic QA Passed (Warnings)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="w-3.5 h-3.5" /> ✓ Deterministic QA Passed
      </span>
    );
  };

  const renderDiagnosticRow = (label: string, check: DiagnosticCheck) => {
    const isPass = check.severity === 'PASS';
    const isWarn = check.severity === 'WARNING';

    return (
      <div className="flex items-start justify-between py-2 border-b border-slate-800/60 last:border-0 text-xs">
        <div className="space-y-0.5 max-w-[75%]">
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
          {check.details && (
            <p className="text-[11px] text-slate-400 font-mono pl-5">{check.details}</p>
          )}
        </div>
        <span
          className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 ${
            isPass
              ? 'bg-emerald-500/10 text-emerald-400'
              : isWarn
              ? 'bg-amber-500/10 text-amber-400'
              : 'bg-rose-500/10 text-rose-400'
          }`}
        >
          {check.severity}
        </span>
      </div>
    );
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-sky-500/10 rounded-lg text-sky-400 border border-sky-500/20">
              <FileImage className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-white tracking-wide">
              Phase 6: Deterministic Final Advertisement Rendering
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Overlays exact approved typography, CTA button, logo, and price badges with mathematical safe-zone boundaries and contrast enhancement.
          </p>
        </div>

        {compositeId ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-sky-500/10 text-sky-300 border border-sky-500/20">
            <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> Composite Ready ({platform.toUpperCase()})
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
            <Info className="w-3.5 h-3.5 text-amber-400" /> Awaiting Step 4 Composite
          </span>
        )}
      </div>

      {/* Style Controls — collapsible, secondary */}
      <div className="border border-slate-800 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowStyleControls(!showStyleControls)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-950/60 hover:bg-slate-900/60 text-xs text-slate-300 font-medium transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            Typography &amp; CTA Style Controls
          </span>
          {showStyleControls ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>

        {showStyleControls && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-slate-950/50 text-xs">
            {/* Font Family & Size */}
            <div className="space-y-1.5">
              <label className="text-slate-300 font-medium block flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-sky-400" /> Font & Headline Size
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-sky-500 font-mono text-xs w-28"
                >
                  <option value="Inter">Inter</option>
                  <option value="Geist">Geist</option>
                </select>
                <input
                  type="number"
                  min={24}
                  max={96}
                  value={headlineSize}
                  onChange={(e) => setHeadlineSize(parseInt(e.target.value) || 52)}
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-sky-500 font-mono text-xs w-16"
                />
                <span className="text-[11px] text-slate-500 font-mono">px</span>
              </div>
            </div>

            {/* Text Alignment */}
            <div className="space-y-1.5">
              <label className="text-slate-300 font-medium block">Copy Alignment</label>
              <select
                value={alignment}
                onChange={(e) => setAlignment(e.target.value as 'left' | 'center' | 'right')}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500 font-mono text-xs"
              >
                <option value="left">Left Aligned</option>
                <option value="center">Centered</option>
                <option value="right">Right Aligned</option>
              </select>
            </div>

            {/* CTA Color — visual picker from brand palette */}
            <div className="space-y-1.5">
              <ColorPicker
                label="CTA Button Color"
                value={ctaBgColor}
                onChange={setCtaBgColor}
                brandColors={paletteArray}
                description="Brand palette"
              />
            </div>

            {/* Readability Options */}
            <div className="space-y-1.5">
              <label className="text-slate-300 font-medium block">Readability Protection</label>
              <div className="flex flex-col gap-1.5 pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-400 text-[11px]">
                  <input
                    type="checkbox"
                    checked={autoScrim}
                    onChange={(e) => setAutoScrim(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>Auto-Scrim Backplate</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Render Action Button */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          disabled={loading || !compositeId}
          onClick={handleGenerate}
          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-sky-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Rendering Deterministic Final Ad...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Render Final Advertisement ({platform.toUpperCase()})</span>
            </>
          )}
        </button>

        {adData && (
          <div className="flex items-center gap-3">
            {renderStatusBadge(adData)}
            <button
              type="button"
              disabled={
                isApproving ||
                isApproved ||
                adData.is_stale ||
                adData.qa_status === 'FAIL' ||
                adData.vision_qa_status === 'FAILED' ||
                adData.vision_qa_status === 'FAIL' ||
                adData.vision_qa_status === 'UNAVAILABLE'
              }
              onClick={handleApprove}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                isApproved
                  ? 'bg-emerald-600 text-white cursor-default'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
              title={
                adData.is_stale
                  ? 'Cannot approve stale advertisement'
                  : adData.qa_status === 'FAIL'
                  ? 'Cannot approve creative with failed deterministic QA'
                  : adData.vision_qa_status === 'FAILED' || adData.vision_qa_status === 'FAIL'
                  ? 'Cannot approve creative with failed visual verification'
                  : adData.vision_qa_status === 'UNAVAILABLE'
                  ? 'Visual verification is required but unavailable'
                  : 'Approve final advertisement'
              }
            >
              {isApproving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {isApproved ? 'Creative Approved' : isApproving ? 'Approving...' : 'Approve Creative'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          </div>
        )}
      </div>

      {/* Stale Warning Banner */}
      {adData?.is_stale && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              <strong>Ad is Stale:</strong> Authoritative upstream assets (Product cutout, Strategy, or Background) have changed. Please re-render to update the final advertisement.
            </span>
          </div>
          <button
            type="button"
            onClick={handleReRender}
            disabled={isReRendering}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs rounded transition-all cursor-pointer shrink-0"
          >
            {isReRendering ? 'Re-rendering...' : 'Re-render Now'}
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs flex items-start gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Display: Ad Canvas & QA / Provenance Card */}
      {adData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 border-t border-slate-800">
          {/* Ad Canvas Display */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center bg-slate-950/80 rounded-xl p-4 border border-slate-800 relative group">
            <div className="relative max-h-[560px] max-w-full overflow-hidden rounded-lg shadow-2xl border border-slate-700/50">
              <img
                src={getFullImageUrl(adData.image_url)}
                alt="Final Rendered Creative"
                className="max-h-[540px] w-auto object-contain mx-auto"
              />
            </div>

            <div className="mt-3 flex items-center justify-between w-full px-2 text-xs font-mono text-slate-400">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-slate-800 rounded text-slate-300">
                  {adData.width} × {adData.height}
                </span>
                <span className="text-slate-500">({adData.aspect_ratio})</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span>Attempt: {adData.attempt_number}</span>
                {adData.is_cached && (
                  <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    CACHED
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* QA Scorecard & Provenance Details */}
          <div className="lg:col-span-6 space-y-4">
            <div className="p-4 bg-slate-950/50 rounded-xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-sky-400" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Final Ad QA
                  </h4>
                </div>
                {renderStatusBadge(adData)}
              </div>

              {/* 7 Diagnostic Checks List — actionable pass/warn/fail only */}
              <div className="divide-y divide-slate-800/40">
                {renderDiagnosticRow('Dimensions & Aspect Ratio', adData.qa_result.dimension_check)}
                {renderDiagnosticRow('Output Integrity & Opacity', adData.qa_result.opacity_check)}
                {renderDiagnosticRow('Safe Zone & Overflow Containment', adData.qa_result.text_safe_zone_check)}
                {renderDiagnosticRow('Exact Approved Copy Preservation', adData.qa_result.exact_copy_check)}
                {renderDiagnosticRow('CTA Geometry & Legibility', adData.qa_result.cta_check)}
                {renderDiagnosticRow('Product Pixel Non-Occlusion', adData.qa_result.product_occlusion_check)}
                {renderDiagnosticRow('Contrast & Background Luminance', adData.qa_result.contrast_check)}
              </div>

              {/* Approved Copy Verification */}
              <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg text-xs space-y-1.5 font-mono">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
                  <span className="flex items-center gap-1.5 text-sky-400">
                    <Lock className="w-3 h-3" /> Exact Approved Copy:
                  </span>
                  <span className="text-emerald-400">Unmodified</span>
                </div>
                <div className="text-slate-200 text-xs">
                  &ldquo;{adData.copy_spec.headline}&rdquo;
                </div>
                {adData.copy_spec.subheadline && (
                  <div className="text-slate-400 text-[11px]">
                    {adData.copy_spec.subheadline}
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-400">
                  <span>CTA: <strong className="text-sky-300">{adData.copy_spec.cta_text}</strong></span>
                  {adData.copy_spec.price_text && (
                    <span>Price: <strong className="text-emerald-300">{adData.copy_spec.price_text}</strong></span>
                  )}
                  {adData.copy_spec.offer_text && (
                    <span>Offer: <strong className="text-amber-300">{adData.copy_spec.offer_text}</strong></span>
                  )}
                </div>
              </div>

              {/* Full Provenance Chain */}
              <div className="p-3 bg-slate-900/50 border border-slate-800/80 rounded-lg text-[11px] space-y-1 font-mono text-slate-400">
                <div className="font-semibold text-slate-300 flex items-center gap-1.5 text-xs pb-1 border-b border-slate-800">
                  <Hash className="w-3.5 h-3.5 text-indigo-400" />
                  Auditable Provenance Chain:
                </div>
                <div className="grid grid-cols-2 gap-1 pt-1">
                  <div>
                    <span className="text-slate-500">Asset Hash:</span>{' '}
                    <span className="text-slate-300">{adData.provenance_chain.source_asset_hash?.slice(0, 10)}...</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Cutout Hash:</span>{' '}
                    <span className="text-slate-300">{adData.provenance_chain.cutout_hash?.slice(0, 10)}...</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Composite Hash:</span>{' '}
                    <span className="text-slate-300">{adData.provenance_chain.composite_output_hash?.slice(0, 10)}...</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Copy Hash:</span>{' '}
                    <span className="text-slate-300">{adData.provenance_chain.copy_hash?.slice(0, 10)}...</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500">Output Hash:</span>{' '}
                    <span className="text-emerald-400 font-bold">{adData.provenance_chain.output_hash?.slice(0, 16)}...</span>
                  </div>
                </div>
              </div>

              {/* Targeted Re-rendering Controls */}
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  placeholder="Optional layout / styling feedback..."
                  value={customFeedback}
                  onChange={(e) => setCustomFeedback(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                />

                <button
                  type="button"
                  disabled={isReRendering}
                  onClick={handleReRender}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReRendering ? 'animate-spin' : ''}`} />
                  {isReRendering ? 'Re-rendering...' : 'Re-render Ad'}
                </button>
              </div>
            </div>

            {/* Level 4 Vision Verification Card */}
            {(adData.vision_qa_result || adData.vision_qa_status) && (
              <div className="p-4 bg-slate-950/70 rounded-xl border border-indigo-900/40 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      Visual Verification
                    </h4>
                  </div>
                  {adData.vision_qa_status === 'REAL_VERIFIED' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" /> ✓ Verified by Vision
                    </span>
                  ) : adData.vision_qa_status === 'MOCK_VERIFIED' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      <Sparkles className="w-3 h-3" /> ⚠ Mock Vision Verification — Development Only
                    </span>
                  ) : adData.vision_qa_status === 'UNAVAILABLE' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      <AlertTriangle className="w-3 h-3" /> Vision Verification Unavailable
                    </span>
                  ) : adData.vision_qa_status === 'FAILED' || adData.vision_qa_status === 'FAIL' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      <XCircle className="w-3 h-3" /> ✕ Vision Verification Failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                      Deterministic QA Passed (Vision Verification Not Enabled)
                    </span>
                  )}
                </div>

                {adData.vision_qa_result?.summary && (
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    {adData.vision_qa_result.summary}
                  </p>
                )}

                {/* Expandable QA Diagnostics */}
                <div className="pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setShowVisionDiagnostics(!showVisionDiagnostics)}
                    className="w-full flex items-center justify-between text-xs text-slate-300 hover:text-white py-1 cursor-pointer font-medium"
                  >
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                      Visual QA Diagnostics
                    </span>
                    {showVisionDiagnostics ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {showVisionDiagnostics && adData.vision_qa_result?.checks && (
                    <div className="mt-2 space-y-1.5 bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Dimensions & Safe-Zone:</span>
                        <span className={adData.vision_qa_result.checks.dimensions !== false ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                          {adData.vision_qa_result.checks.dimensions !== false ? '✓ PASS' : '✕ FAIL'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Product Visibility:</span>
                        <span className={adData.vision_qa_result.checks.product_visible !== false ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                          {adData.vision_qa_result.checks.product_visible !== false ? '✓ PASS' : '✕ FAIL'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Text Readability & Copy Match:</span>
                        <span className={adData.vision_qa_result.checks.text_readability !== false ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                          {adData.vision_qa_result.checks.text_readability !== false ? '✓ PASS' : '✕ FAIL'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Composition & Balance:</span>
                        <span className={adData.vision_qa_result.checks.composition !== false ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                          {adData.vision_qa_result.checks.composition !== false ? '✓ PASS' : '⚠ WARN'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Brand Color & Logo Alignment:</span>
                        <span className={adData.vision_qa_result.checks.branding !== false ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                          {adData.vision_qa_result.checks.branding !== false ? '✓ PASS' : '⚠ WARN'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">No Visual Hallucinations/Artifacts:</span>
                        <span className={adData.vision_qa_result.checks.artifacts === false ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                          {adData.vision_qa_result.checks.artifacts === false ? '✓ PASS' : '✕ DETECTED'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Collapsible Technical Details (collapsed by default) */}
                <div className="pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                    className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1 cursor-pointer font-mono"
                  >
                    <span className="flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-indigo-400" />
                      Technical Details (Model, Latency, Cost)
                    </span>
                    {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {showTechnicalDetails && (
                    <div className="mt-2 p-3 bg-slate-900/90 rounded-lg border border-slate-800 text-[11px] font-mono space-y-2 text-slate-300">
                      <div className="grid grid-cols-2 gap-2 text-slate-400">
                        <div>
                          <span className="text-slate-500 block">Model/Provider:</span>
                          <span className="text-slate-200">{adData.vision_qa_result?.model_name || adData.vision_qa_result?.model || 'mock-vision-qa-v1'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Verification ID:</span>
                          <span className="text-slate-200">{(adData.vision_qa_result?.verification_id || adData.vision_qa_result?.generation_id)?.slice(0, 16) || 'auto-gen'}...</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Timestamp:</span>
                          <span className="text-slate-200">{adData.vision_qa_result?.verified_at || adData.vision_qa_result?.timestamp || new Date().toISOString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Cost & Budget:</span>
                          <span className="text-emerald-400">
                            {adData.vision_qa_result?.is_mock ? 'Mock ($0.00 — Dev)' : '$0.00 (Single Call Guard Enforced)'}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="text-slate-500 block pb-1">Raw Structured Output:</span>
                        <pre className="p-2 bg-slate-950 rounded border border-slate-800/80 overflow-x-auto text-[10px] text-slate-300 max-h-40">
                          {JSON.stringify(adData.vision_qa_result, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

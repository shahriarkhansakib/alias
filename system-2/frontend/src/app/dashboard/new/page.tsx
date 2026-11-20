'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Sidebar } from '../../../components/Sidebar';
import { Header } from '../../../components/Header';
import { BriefForm } from '../../../components/brief/BriefForm';
import { ValidationFeedbackPanel } from '../../../components/brief/ValidationFeedbackPanel';
import { StrategyPreviewPanel } from '../../../components/strategy/StrategyPreviewPanel';
import { BackgroundPreviewPanel } from '../../../components/background/BackgroundPreviewPanel';
import { CompositePreviewPanel } from '../../../components/composite/CompositePreviewPanel';
import { FinalAdPreviewPanel } from '../../../components/final_ad/FinalAdPreviewPanel';
import { LoginView } from '../../../components/auth/LoginView';
import { StudioHeader } from '../../../components/workspace/StudioHeader';
import { ProductStagePanel } from '../../../components/workspace/ProductStagePanel';
import { DependencyCard } from '../../../components/common/DependencyCard';
import { TechnicalDrawer } from '../../../components/common/TechnicalDrawer';
import {
  fetchHealth,
  fetchSupportedPlatforms,
  fetchBrief,
  getStrategy,
  getBackground,
  getComposite,
  getFinalAd,
  getJobStatus,
  generateStrategy,
  generateBackground,
  generateComposite,
  generateFinalAd,
} from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useIsMounted } from '../../../lib/useIsMounted';
import {
  SystemHealthResponse,
  ValidationReport,
  AssetValidationResponse,
  StrategyGenerationResponse,
  BackgroundResponse,
  CompositeResponse,
  FinalAdResponse,
  WorkflowStage,
  StageStatusInfo,
  TargetPlatform,
  PlatformDefinition,
  BriefPayload,
  VisionQAResultSpec,
} from '../../../lib/types';

export default function NewBriefPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const mounted = useIsMounted();
  const [activeTab, setActiveTab] = useState('briefs');
  const [health, setHealth] = useState<SystemHealthResponse | undefined>(undefined);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);

  // Creative Studio Workspace Stage & Platform Navigation
  const [activeStage, setActiveStage] = useState<WorkflowStage>('brief');
  const [currentPlatform, setCurrentPlatform] = useState<TargetPlatform>('instagram');
  const [availablePlatforms, setAvailablePlatforms] = useState<PlatformDefinition[]>([
    {
      platform: 'instagram',
      name: 'Instagram (4:5)',
      target_width: 1080,
      target_height: 1350,
      aspect_ratio: '4:5',
      creative_characteristics: ['product-focused', 'mobile-first'],
      default_style_notes: 'Vertical portrait',
    },
    {
      platform: 'facebook',
      name: 'Facebook (1:1)',
      target_width: 1080,
      target_height: 1080,
      aspect_ratio: '1:1',
      creative_characteristics: ['balanced', 'square'],
      default_style_notes: 'Square canvas',
    },
    {
      platform: 'linkedin',
      name: 'LinkedIn (1.91:1)',
      target_width: 1200,
      target_height: 628,
      aspect_ratio: '1.91:1',
      creative_characteristics: ['professional', 'landscape'],
      default_style_notes: 'Wide landscape format',
    },
  ]);

  // Brief and Strategy State
  const [briefPayload, setBriefPayload] = useState<BriefPayload | null>(null);
  const [savedBriefId, setSavedBriefId] = useState<string | undefined>(undefined);
  const [strategyResponse, setStrategyResponse] = useState<StrategyGenerationResponse | null>(null);
  const [backgroundData, setBackgroundData] = useState<BackgroundResponse | null>(null);
  const [compositeData, setCompositeData] = useState<CompositeResponse | null>(null);
  const [finalAdData, setFinalAdData] = useState<FinalAdResponse | null>(null);
  const [finalAdApproved, setFinalAdApproved] = useState(false);

  // Pipeline automated execution state
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineStep, setPipelineStep] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Validation Results State
  const [briefReport, setBriefReport] = useState<ValidationReport | null>(null);
  const [assetReport, setAssetReport] = useState<AssetValidationResponse | null>(null);

  // Hydrate state from URL / localStorage on mount
  useEffect(() => {
    async function hydrateState() {
      if (!isAuthenticated) return;
      try {
        const storedBriefId =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('brief_id') ||
              localStorage.getItem('alias_studio_brief_id')
            : null;

        if (storedBriefId) {
          const briefRes = await fetchBrief(storedBriefId);
          if (briefRes.data) {
            setSavedBriefId(storedBriefId);
            setBriefPayload(briefRes.data.payload);
            if (briefRes.data.validation_report) {
              setBriefReport(briefRes.data.validation_report);
            }
          }
        }

        const storedJobId =
          typeof window !== 'undefined' ? localStorage.getItem('alias_studio_job_id') : null;

        if (storedJobId) {
          const jobRes = await getJobStatus(storedJobId);
          if (jobRes.data && (!storedBriefId || jobRes.data.brief_id === storedBriefId)) {
            const { strategy_id, resource_ids } = jobRes.data;

            if (strategy_id) {
              const sRes = await getStrategy(strategy_id);
              if (sRes.data) {
                setStrategyResponse({
                  strategy_id: sRes.data.id,
                  status: sRes.data.status,
                  strategy: sRes.data.strategy_spec,
                  claim_report: sRes.data.claim_validation_report,
                  retry_count: sRes.data.retry_count || 0,
                  job_id: storedJobId,
                  created_at: sRes.data.created_at || undefined,
                });
              }
            }

            if (resource_ids?.background_id) {
              const bgRes = await getBackground(resource_ids.background_id);
              if (bgRes.data) setBackgroundData(bgRes.data);
            }

            if (resource_ids?.composite_id) {
              const compRes = await getComposite(resource_ids.composite_id);
              if (compRes.data) setCompositeData(compRes.data);
            }

            if (resource_ids?.final_ad_id) {
              const adRes = await getFinalAd(resource_ids.final_ad_id);
              if (adRes.data) setFinalAdData(adRes.data);
            }
          } else {
            // Job does not match currently active brief; clear stale job state
            if (typeof window !== 'undefined') {
              localStorage.removeItem('alias_studio_job_id');
            }
          }
        }
      } catch (err) {
        console.warn('Failed to hydrate studio state from backend:', err);
      }
    }

    hydrateState();
  }, [isAuthenticated]);

  // Load platforms dynamically from backend registry
  useEffect(() => {
    async function loadPlatforms() {
      const res = await fetchSupportedPlatforms();
      if (res.data && res.data.length > 0) {
        setAvailablePlatforms(res.data as PlatformDefinition[]);
      }
    }
    loadPlatforms();
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const healthRes = await fetchHealth();
      if (healthRes.data) {
        setHealth(healthRes.data);
      }
      setLatencyMs(healthRes.latencyMs);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadHealth();
    }
  }, [isAuthenticated, loadHealth]);

  const handleValidationOutcome = (
    bReport?: ValidationReport | null,
    aReport?: AssetValidationResponse | null
  ) => {
    if (bReport !== undefined) setBriefReport(bReport);
    if (aReport !== undefined) setAssetReport(aReport);
  };

  const handlePayloadChange = (payload: BriefPayload, briefId?: string) => {
    const imageChanged = briefPayload && payload.images?.[0]?.url !== briefPayload.images?.[0]?.url;
    setBriefPayload(payload);
    if (briefId && briefId !== savedBriefId) {
      setSavedBriefId(briefId);
      // Invalidate downstream stage artifacts from previous brief
      setStrategyResponse(null);
      setBackgroundData(null);
      setCompositeData(null);
      setFinalAdData(null);
      setFinalAdApproved(false);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('alias_studio_job_id');
        localStorage.setItem('alias_studio_brief_id', briefId);
        const url = new URL(window.location.href);
        url.searchParams.set('brief_id', briefId);
        window.history.replaceState({}, '', url.toString());
      }
    } else if (imageChanged) {
      // Invalidate downstream stage artifacts when product image changes
      setStrategyResponse(null);
      setBackgroundData(null);
      setCompositeData(null);
      setFinalAdData(null);
      setFinalAdApproved(false);
    }
  };

  // Authoritative stage status and dependency graph
  const stages: Record<WorkflowStage, StageStatusInfo> = {
    brief: {
      stage: 'brief',
      label: 'Brief',
      stepNumber: 1,
      status: savedBriefId ? 'APPROVED' : 'DRAFT',
      isComplete: !!savedBriefId,
      isLocked: false,
      dependencies: [],
    },
    strategy: {
      stage: 'strategy',
      label: 'Strategy',
      stepNumber: 2,
      status: strategyResponse ? 'APPROVED' : (savedBriefId ? 'DRAFT' : 'LOCKED'),
      isComplete: !!strategyResponse,
      isLocked: !savedBriefId,
      dependencies: [
        {
          id: 'brief_saved',
          name: 'Ad Brief Saved & Validated',
          satisfied: !!savedBriefId,
          targetStage: 'brief',
        },
      ],
    },
    background: {
      stage: 'background',
      label: 'Background',
      stepNumber: 3,
      status: backgroundData ? 'APPROVED' : (strategyResponse ? 'DRAFT' : 'LOCKED'),
      isComplete: !!backgroundData,
      isLocked: !strategyResponse,
      dependencies: [
        {
          id: 'brief_saved',
          name: 'Ad Brief Saved & Validated',
          satisfied: !!savedBriefId,
          targetStage: 'brief',
        },
        {
          id: 'strategy_approved',
          name: 'Creative Strategy Approved',
          satisfied: !!strategyResponse,
          targetStage: 'strategy',
        },
      ],
    },
    product: {
      stage: 'product',
      label: 'Product',
      stepNumber: 4,
      status: (assetReport?.is_valid || briefPayload?.images?.[0]?.url) ? 'APPROVED' : (backgroundData ? 'DRAFT' : 'LOCKED'),
      isComplete: !!(assetReport?.is_valid || briefPayload?.images?.[0]?.url),
      isLocked: !backgroundData,
      dependencies: [
        {
          id: 'background_approved',
          name: 'AI Background Approved',
          satisfied: !!backgroundData,
          targetStage: 'background',
        },
        {
          id: 'product_asset',
          name: 'Product Cutout Asset Provided',
          satisfied: !!(assetReport?.is_valid || briefPayload?.images?.[0]?.url),
          targetStage: 'brief',
        },
      ],
    },
    composite: {
      stage: 'composite',
      label: 'Composite',
      stepNumber: 5,
      status: compositeData ? 'APPROVED' : ((backgroundData && (assetReport?.is_valid || briefPayload?.images?.[0]?.url)) ? 'DRAFT' : 'LOCKED'),
      isComplete: !!compositeData,
      isLocked: !backgroundData || !(assetReport?.is_valid || briefPayload?.images?.[0]?.url),
      dependencies: [
        {
          id: 'brief_saved',
          name: 'Ad Brief Approved',
          satisfied: !!savedBriefId,
          targetStage: 'brief',
        },
        {
          id: 'strategy_approved',
          name: 'Creative Strategy Approved',
          satisfied: !!strategyResponse,
          targetStage: 'strategy',
        },
        {
          id: 'background_approved',
          name: 'AI Background Approved',
          satisfied: !!backgroundData,
          targetStage: 'background',
        },
        {
          id: 'product_qa',
          name: 'Product Cutout QA Verified',
          satisfied: !!(assetReport?.is_valid || briefPayload?.images?.[0]?.url),
          targetStage: 'product',
        },
      ],
    },
    final_ad: {
      stage: 'final_ad',
      label: 'Final Ad',
      stepNumber: 6,
      status: (finalAdApproved || finalAdData) ? 'APPROVED' : (compositeData ? 'DRAFT' : 'LOCKED'),
      isComplete: !!(finalAdApproved || finalAdData),
      isLocked: !compositeData,
      dependencies: [
        {
          id: 'composite_approved',
          name: 'Product Composite Approved',
          satisfied: !!compositeData,
          targetStage: 'composite',
        },
      ],
    },
  };

  const runFullPipeline = async (targetBriefId: string) => {
    if (!targetBriefId) return;
    setPipelineRunning(true);
    setPipelineError(null);
    // Reset any prior stage data to prevent displaying stale outputs
    setStrategyResponse(null);
    setBackgroundData(null);
    setCompositeData(null);
    setFinalAdData(null);
    setFinalAdApproved(false);
    try {
      // Step 2: Strategy
      setPipelineStep('Generating Creative Strategy & verifying claims...');
      const stratRes = await generateStrategy({ brief_id: targetBriefId });
      if (stratRes.error || !stratRes.data) {
        setPipelineError(stratRes.error || 'Failed to generate strategy');
        return;
      }
      setStrategyResponse(stratRes.data);
      const stratId = stratRes.data.strategy_id;
      if (!stratId) {
        setPipelineError('Failed to generate creative strategy: missing strategy ID');
        return;
      }
      if (stratRes.data.job_id && typeof window !== 'undefined') {
        localStorage.setItem('alias_studio_job_id', stratRes.data.job_id);
      }

      // Step 3: Background
      setPipelineStep(`Generating AI Platform Background (${currentPlatform.toUpperCase()})...`);
      const bgRes = await generateBackground({ strategy_id: stratId, platform: currentPlatform });
      if (bgRes.error || !bgRes.data) {
        setPipelineError(bgRes.error || 'Failed to generate background');
        return;
      }
      setBackgroundData(bgRes.data);
      const bgId = bgRes.data.id;

      // Step 4 & 5: Composite
      setPipelineStep('Compositing Authentic Product Cutout onto Background...');
      const compRes = await generateComposite({
        background_id: bgId,
        product_image_url: briefPayload?.images?.[0]?.url,
        placement: { scale: 0.9, alignment: 'center' },
        shadow: { enabled: true, opacity: 0.35 },
        force_regenerate: true,
      });
      if (compRes.error || !compRes.data) {
        setPipelineError(compRes.error || 'Failed to composite product');
        return;
      }
      setCompositeData(compRes.data);
      const compId = compRes.data.id;

      // Step 6: Final Ad — use approved brand palette, not hardcoded colors
      setPipelineStep('Rendering Deterministic Typography, CTA & Scrim...');
      const brandColors = briefPayload?.brand?.colors;
      const brandPrimary = (Array.isArray(brandColors) ? brandColors[0] : undefined) || '#1D4ED8';
      const adRes = await generateFinalAd({
        composite_id: compId,
        typography: { font_family: 'Inter', headline_size: 52, headline_color: '#FFFFFF', alignment: 'left' },
        cta: { bg_color: brandPrimary, text_color: '#FFFFFF', border_radius: 10 },
        readability: { auto_scrim: true },
        force_regenerate: true,
      });
      if (adRes.error || !adRes.data) {
        setPipelineError(adRes.error || 'Failed to render final ad');
        return;
      }
      setFinalAdData(adRes.data);

      // Automatically transition to the hero Final Ad stage
      setActiveStage('final_ad');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Pipeline execution failed';
      setPipelineError(message);
    } finally {
      setPipelineRunning(false);
      setPipelineStep(null);
    }
  };

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

  // Extract persistent product details
  const persistentProduct = {
    url:
      briefPayload?.images?.[0]?.url ||
      assetReport?.asset_metadata?.url ||
      'http://127.0.0.1:8000/api/v1/storage/demo/smartfit_x1.png',
    name: briefPayload?.product?.name || 'SmartFit X1',
    status: assetReport?.status || 'PASS',
  };

  // Determine Layer 3 Technical Details content for active stage
  const getStageStructuredJson = () => {
    switch (activeStage) {
      case 'brief':
        return briefPayload;
      case 'strategy':
        return strategyResponse?.strategy;
      case 'background':
        return backgroundData;
      case 'product':
        return assetReport;
      case 'composite':
        return compositeData;
      case 'final_ad':
        return finalAdData;
    }
  };

  const getStageGenerationDetails = () => {
    switch (activeStage) {
      case 'background':
        return {
          prompt: backgroundData?.prompt?.positive_prompt,
          negative_prompt: backgroundData?.prompt?.negative_prompt,
          model: backgroundData?.model_name || 'mock-studio-v1',
          provider: backgroundData?.provider || 'alias-ai',
          attempt: backgroundData?.attempt_number || 1,
          cost: '$0.00 (Mock / Dev Mode)',
        };
      case 'strategy':
        return {
          prompt: strategyResponse?.strategy?.concept?.creative_angle || strategyResponse?.strategy?.concept?.angle,
          model: 'llm-creative-strategist-v1',
          provider: 'alias-strategy-engine',
          attempt: 1,
        };
      case 'final_ad':
        return {
          prompt: 'Deterministic typography layout & CTA rasterization without generative hallucinations',
          model: 'deterministic-ad-renderer-v1',
          provider: 'pillow-core',
          attempt: finalAdData?.attempt_number || 1,
        };
      default:
        return null;
    }
  };

  const getStageQADiagnostics = () => {
    switch (activeStage) {
      case 'brief':
        return {
          status: briefReport?.status,
          issues: briefReport?.errors,
          warnings: briefReport?.warnings,
        };
      case 'background': {
        const bgQA = backgroundData?.qa_result;
        const bgChecks = bgQA ? [
          bgQA.dimension_check,
          bgQA.text_artifact_check,
          bgQA.watermark_check,
          bgQA.extra_object_check,
          bgQA.negative_space_check,
          bgQA.product_safe_zone_check,
          bgQA.brightness_check,
        ].filter(Boolean) : undefined;
        return {
          status: backgroundData?.qa_status,
          checks: bgChecks,
          issues: bgQA?.issues,
          warnings: bgQA?.warnings,
        };
      }
      case 'product': {
        const rep = assetReport?.report || (assetReport && 'errors' in assetReport ? (assetReport as unknown as ValidationReport) : undefined);
        return {
          status: assetReport?.status || rep?.status,
          issues: rep?.errors,
          warnings: rep?.warnings,
        };
      }
      case 'composite': {
        const compQA = compositeData?.qa_result;
        const compChecks = compQA ? [
          compQA.dimension_check,
          compQA.placement_check,
          compQA.visibility_check,
          compQA.boundary_check,
          compQA.integrity_check,
        ].filter(Boolean) : undefined;
        return {
          status: compositeData?.qa_status,
          checks: compChecks,
          issues: compQA?.issues,
          warnings: compQA?.warnings,
        };
      }
      case 'final_ad':
        return {
          status: finalAdData?.qa_status,
          checks: finalAdData?.qa_result?.checks,
          issues: finalAdData?.qa_result?.issues,
          warnings: finalAdData?.qa_result?.warnings,
          visionAdvisory: (finalAdData?.qa_result?.diagnostics?.vision_advisory as VisionQAResultSpec) || undefined,
        };
    }
  };

  const activeStageInfo = stages[activeStage];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          health={health}
          loading={loadingHealth}
          latencyMs={latencyMs}
          onRefresh={loadHealth}
        />

        {/* Studio Top Navigation & Stepper */}
        <StudioHeader
          activeStage={activeStage}
          onSelectStage={(stage) => setActiveStage(stage)}
          stages={stages}
          productAsset={persistentProduct}
          onReplaceProductImage={() => setActiveStage('brief')}
          currentPlatform={currentPlatform}
          onSelectPlatform={(p) => setCurrentPlatform(p)}
          availablePlatforms={availablePlatforms}
        />

        {/* Global Pipeline Progress / Error Banners */}
        {pipelineRunning && (
          <div className="px-6 py-2 bg-indigo-950/60 border-b border-indigo-500/30 flex items-center justify-between text-xs text-indigo-300 animate-pulse">
            <div className="flex items-center space-x-2.5">
              <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
              <span className="font-semibold text-white">Full Creative Pipeline In Progress:</span>
              <span>{pipelineStep || 'Synthesizing creative stages...'}</span>
            </div>
          </div>
        )}

        {pipelineError && (
          <div className="px-6 py-2 bg-rose-950/60 border-b border-rose-500/30 flex items-center justify-between text-xs text-rose-300">
            <div>
              <span className="font-semibold text-rose-200">Pipeline Notice: </span>
              {pipelineError}
            </div>
            <button
              type="button"
              onClick={() => setPipelineError(null)}
              className="text-xs text-rose-400 hover:text-white underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 70/20 Creative Production Workspace */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {/* Locked Stage Dependency Check */}
          {activeStageInfo.isLocked ? (
            <DependencyCard
              stageName={activeStageInfo.label}
              stageNumber={activeStageInfo.stepNumber}
              dependencies={activeStageInfo.dependencies}
              onNavigateStage={(s) => setActiveStage(s)}
            />
          ) : (
            /* Unlocked Active Stage Content */
            <div>
              {activeStage === 'brief' && (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                  <div className="xl:col-span-8">
                    <BriefForm
                      onValidated={handleValidationOutcome}
                      onPayloadChange={handlePayloadChange}
                      onSavedSuccess={(saved) => {
                        if (saved.id !== savedBriefId) {
                          setSavedBriefId(saved.id);
                          setStrategyResponse(null);
                          setBackgroundData(null);
                          setCompositeData(null);
                          setFinalAdData(null);
                          setFinalAdApproved(false);
                          if (typeof window !== 'undefined') {
                            localStorage.removeItem('alias_studio_job_id');
                            localStorage.setItem('alias_studio_brief_id', saved.id);
                          }
                        }
                      }}
                      onLoadDemoAndRun={async (saved) => {
                        setSavedBriefId(saved.id);
                        await runFullPipeline(saved.id);
                      }}
                      savedBriefId={savedBriefId}
                      initialPayload={briefPayload}
                      onProceedToStrategy={() => setActiveStage('strategy')}
                    />
                  </div>
                  <div className="xl:col-span-4 sticky top-6 space-y-4">
                    <ValidationFeedbackPanel
                      briefReport={briefReport}
                      assetReport={assetReport}
                    />
                    {savedBriefId && (
                      <div className="p-4 rounded-xl bg-indigo-600/10 border border-indigo-500/30 space-y-3">
                        <div className="flex items-center space-x-2 text-xs text-indigo-300 font-semibold">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span>Ad Brief Saved (ID: {savedBriefId.slice(0, 8)}...)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveStage('strategy')}
                          className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
                        >
                          Continue to Step 2: Strategy →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeStage === 'strategy' && (
                <StrategyPreviewPanel
                  briefPayload={briefPayload}
                  briefId={savedBriefId}
                  initialStrategy={strategyResponse}
                  onStrategyGenerated={(res) => {
                    setStrategyResponse(res);
                    setBackgroundData(null);
                    setCompositeData(null);
                    setFinalAdData(null);
                    setFinalAdApproved(false);
                  }}
                />
              )}

              {activeStage === 'background' && (
                <BackgroundPreviewPanel
                  strategyId={strategyResponse?.strategy_id}
                  templateId={strategyResponse?.strategy?.template_id}
                  platform={currentPlatform}
                  initialBackground={backgroundData}
                  onBackgroundGenerated={(bg) => {
                    setBackgroundData(bg);
                    setCompositeData(null);
                    setFinalAdData(null);
                    setFinalAdApproved(false);
                  }}
                />
              )}

              {activeStage === 'product' && (
                <ProductStagePanel
                  productName={briefPayload?.product?.name || 'SmartFit X1'}
                  productImageUrl={
                    briefPayload?.images?.[0]?.url ||
                    assetReport?.asset_metadata?.url ||
                    'http://127.0.0.1:8000/api/v1/storage/demo/smartfit_x1.png'
                  }
                  price={String(briefPayload?.product?.offer?.price || '4999')}
                  currency={briefPayload?.product?.offer?.currency || 'BDT'}
                  sku={briefPayload?.product?.sku}
                  category={briefPayload?.product?.category}
                  assetReport={assetReport}
                  onProceedToComposite={() => setActiveStage('composite')}
                  onReplaceImage={() => setActiveStage('brief')}
                />
              )}

              {activeStage === 'composite' && (
                <CompositePreviewPanel
                  backgroundId={backgroundData?.id}
                  platform={backgroundData?.platform || currentPlatform}
                  productAssetUrl={
                    briefPayload?.images?.[0]?.url ||
                    assetReport?.asset_metadata?.url ||
                    briefPayload?.product?.image_url
                  }
                  initialComposite={compositeData}
                  onCompositeGenerated={(comp) => {
                    setCompositeData(comp);
                    setFinalAdData(null);
                    setFinalAdApproved(false);
                  }}
                />
              )}

              {activeStage === 'final_ad' && (
                <FinalAdPreviewPanel
                  compositeId={compositeData?.id}
                  platform={compositeData?.platform || backgroundData?.platform || currentPlatform}
                  initialAdData={finalAdData}
                  onAdGenerated={(ad) => setFinalAdData(ad)}
                  onAdApproved={() => setFinalAdApproved(true)}
                  brandColors={briefPayload?.brand?.colors || []}
                  exactCopy={{
                    headline: briefPayload?.copy?.headline || strategyResponse?.strategy?.copy_spec?.headline,
                    subheadline: briefPayload?.copy?.subheadline || strategyResponse?.strategy?.copy_spec?.subheadline,
                    cta: briefPayload?.copy?.cta || strategyResponse?.strategy?.copy_spec?.cta,
                  }}
                />
              )}
            </div>
          )}
        </main>

        {/* Layer 3 Progressive Disclosure Technical Drawer */}
        <TechnicalDrawer
          stageName={activeStageInfo.label}
          structuredJson={getStageStructuredJson()}
          generationDetails={getStageGenerationDetails()}
          qaDiagnostics={getStageQADiagnostics()}
          provenance={finalAdData?.provenance_chain || compositeData?.integrity_metadata}
          versionHistory={{
            currentAttempt: finalAdData?.attempt_number || backgroundData?.attempt_number || 1,
            isCached: finalAdData?.is_cached || backgroundData?.is_cached || false,
          }}
        />
      </div>
    </div>
  );
}

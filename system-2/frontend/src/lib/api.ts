import {
  SystemHealthResponse,
  SystemStatusResponse,
  BriefValidationResponse,
  AssetValidationResponse,
  BriefPayload,
  BriefResponse,
  BriefListItem,
  SaveBriefResponse,
  StrategyGenerationResponse,
  StrategyRecordResponse,
  StrategyValidationResponse,
  CreativeStrategySpec,
  TemplateInfo,
  BackgroundResponse,
  CompositeResponse,
  FinalAdResponse,
  FinalAdApprovalResponse,
  JobStatusResponse,
  JobDispatchResponse,
  PlatformDefinition,
  ProductPlacementConfig,
  ShadowConfig,
  TypographyStyle,
  CTAStyle,
  PriceBadgeStyle,
  ReadabilityEnhancementConfig,
} from './types';
import { getAuthHeaders, authFetch } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function fetchHealth(): Promise<{ data?: SystemHealthResponse; error?: string; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${res.statusText}`, latencyMs };
    }
    const data: SystemHealthResponse = await res.json();
    return { data, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : 'Failed to connect to backend';
    return { error: message, latencyMs };
  }
}

export async function fetchStatus(): Promise<{ data?: SystemStatusResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data: SystemStatusResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to connect to backend';
    return { error: message };
  }
}

export async function validateBrief(payload: unknown): Promise<{ data?: BriefValidationResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/briefs/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.detail?.message || (typeof errData.detail === 'string' ? errData.detail : `Validation failed (${res.status})`);
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
    }
    const data: BriefValidationResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Validation request failed';
    return { error: message };
  }
}

export async function validateAssetUrl(
  url: string,
  requireTransparency = true
): Promise<{ data?: AssetValidationResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/assets/validate-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ url, require_transparency: requireTransparency }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.detail?.message || (typeof errData.detail === 'string' ? errData.detail : `Asset validation failed (${res.status})`);
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
    }
    const data: AssetValidationResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Asset validation request failed';
    return { error: message };
  }
}

export async function getDemoBrief(): Promise<{ data?: BriefPayload; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/briefs/demo`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: BriefPayload = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load demo brief';
    return { error: message };
  }
}

export async function fetchBrief(briefId: string): Promise<{ data?: BriefResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/briefs/${briefId}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data.detail || `Failed to fetch brief (${res.status})` };
    }
    const data: BriefResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch brief';
    return { error: message };
  }
}

export async function fetchBriefs(limit = 20): Promise<{ data?: BriefListItem[]; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/briefs?limit=${limit}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data.detail || `Failed to list briefs (${res.status})` };
    }
    const data: BriefListItem[] = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list briefs';
    return { error: message };
  }
}

export async function saveBrief(payload: unknown, requireTransparency = true): Promise<{ data?: SaveBriefResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/briefs?require_transparency=${requireTransparency}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail?.message || data.detail || 'Failed to save brief';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as SaveBriefResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save brief';
    return { error: message };
  }
}

export async function getStrategy(strategyId: string): Promise<{ data?: StrategyRecordResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/strategies/${strategyId}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data.detail || `Failed to fetch strategy (${res.status})` };
    }
    const data: StrategyRecordResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch strategy';
    return { error: message };
  }
}

export async function generateStrategy(params: {
  brief_id: string;
  job_id?: string;
}): Promise<{ data?: StrategyGenerationResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/strategies/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Failed to generate creative strategy';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as StrategyGenerationResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Strategy generation request failed';
    return { error: message };
  }
}

export async function validateStrategy(params: {
  brief_payload: BriefPayload;
  strategy: CreativeStrategySpec;
}): Promise<{ data?: StrategyValidationResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/strategies/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Strategy claim validation failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as StrategyValidationResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Strategy claim validation request failed';
    return { error: message };
  }
}

export async function getStrategyTemplates(): Promise<{ data?: TemplateInfo[]; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/strategies/templates`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch templates';
    return { error: message };
  }
}

export async function generateBackground(params: {
  strategy_id: string;
  platform: string;
  force_regenerate?: boolean;
}): Promise<{ data?: BackgroundResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/backgrounds/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Failed to generate background';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as BackgroundResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Background generation request failed';
    return { error: message };
  }
}

export async function getBackground(id: string): Promise<{ data?: BackgroundResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/backgrounds/${id}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: BackgroundResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch background';
    return { error: message };
  }
}

export async function regenerateBackground(
  id: string,
  customFeedback?: string
): Promise<{ data?: BackgroundResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/backgrounds/${id}/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ custom_feedback: customFeedback || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Targeted regeneration failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as BackgroundResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Regeneration request failed';
    return { error: message };
  }
}

export async function generateComposite(params: {
  background_id: string;
  product_image_url?: string;
  placement?: ProductPlacementConfig;
  shadow?: ShadowConfig;
  force_regenerate?: boolean;
}): Promise<{ data?: CompositeResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/composites/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Failed to generate product composite';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as CompositeResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Product compositing request failed';
    return { error: message };
  }
}

export async function getComposite(id: string): Promise<{ data?: CompositeResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/composites/${id}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: CompositeResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch composite';
    return { error: message };
  }
}

export async function regenerateComposite(
  id: string,
  params?: {
    product_image_url?: string;
    placement?: ProductPlacementConfig;
    shadow?: ShadowConfig;
    custom_feedback?: string;
  }
): Promise<{ data?: CompositeResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/composites/${id}/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(params || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Targeted recompositing failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as CompositeResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Recompositing request failed';
    return { error: message };
  }
}

export async function generateFinalAd(params: {
  composite_id: string;
  typography?: Partial<TypographyStyle>;
  cta?: Partial<CTAStyle>;
  price_badge?: Partial<PriceBadgeStyle>;
  readability?: Partial<ReadabilityEnhancementConfig>;
  force_regenerate?: boolean;
}): Promise<{ data?: FinalAdResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/final-ads/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Failed to render final advertisement';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as FinalAdResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Final advertisement rendering failed';
    return { error: message };
  }
}

export async function getFinalAd(id: string): Promise<{ data?: FinalAdResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/final-ads/${id}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: FinalAdResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch final advertisement';
    return { error: message };
  }
}

export async function regenerateFinalAd(
  id: string,
  params?: {
    typography?: Partial<TypographyStyle>;
    cta?: Partial<CTAStyle>;
    price_badge?: Partial<PriceBadgeStyle>;
    readability?: Partial<ReadabilityEnhancementConfig>;
    custom_feedback?: string;
  }
): Promise<{ data?: FinalAdResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/final-ads/${id}/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(params || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Targeted ad re-rendering failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as FinalAdResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Ad re-rendering request failed';
    return { error: message };
  }
}

export async function approveFinalAd(
  finalAdId: string
): Promise<{ data?: FinalAdApprovalResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/final-ads/${finalAdId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Final ad approval failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as FinalAdApprovalResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Approval request failed';
    return { error: message };
  }
}

export async function getJobStatus(jobId: string): Promise<{ data?: JobStatusResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/jobs/${jobId}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: JobStatusResponse = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch job status';
    return { error: message };
  }
}

export async function dispatchJobStage(
  jobId: string,
  stage: string,
  params?: Record<string, unknown>
): Promise<{ data?: JobDispatchResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/jobs/${jobId}/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ stage, ...(params || {}) }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Job dispatch failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data: data as JobDispatchResponse };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Job dispatch request failed';
    return { error: message };
  }
}

export async function fetchSupportedPlatforms(): Promise<{ data?: PlatformDefinition[]; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/platforms`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: PlatformDefinition[] = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch supported platforms';
    return { error: message };
  }
}


// ==========================================
// Phase 9: Publishing Infrastructure Client
// ==========================================

export async function publishCreative(
  payload: import('./types').PublishRequest
): Promise<{ data?: import('./types').PublishingRecordResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/publishing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Publishing failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to initiate publishing';
    return { error: message };
  }
}

export async function getPublishingRecord(
  id: string
): Promise<{ data?: import('./types').PublishingRecordResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/publishing/${id}`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch publishing record';
    return { error: message };
  }
}

export async function retryPublishing(
  id: string,
  payload?: import('./types').PublishRetryRequest
): Promise<{ data?: import('./types').PublishingRecordResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/publishing/${id}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Retry publishing failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retry publishing';
    return { error: message };
  }
}

export async function reconcilePublishing(
  id: string
): Promise<{ data?: import('./types').PublishingReconcileResponse; error?: string }> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/publishing/${id}/reconcile`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
      },
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || 'Reconcile publishing failed';
      return { error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to reconcile publishing';
    return { error: message };
  }
}

export async function fetchPublishingCapabilities(): Promise<{
  data?: import('./types').PlatformPublishingCapability[];
  error?: string;
}> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/publishing/capabilities`, {
      headers: {
        ...getAuthHeaders(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch publishing capabilities';
    return { error: message };
  }
}

export { API_BASE_URL };


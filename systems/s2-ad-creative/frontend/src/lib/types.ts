export interface SystemHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  environment: string;
  timestamp: string;
  database: string;
  storage: string;
  worker: string;
}

export interface SystemStatusResponse {
  project_name: string;
  version: string;
  environment: string;
  active_features: {
    payload_gate: boolean;
    asset_gate: boolean;
    deterministic_rendering: boolean;
    mock_ai_providers: boolean;
    vision_qa_advisory: boolean;
    async_worker: boolean;
    [key: string]: boolean;
  };
  configuration: {
    storage_type: string;
    worker_type: string;
    cors_origins: string[];
    database_dialect: string;
    [key: string]: unknown;
  };
}

export type ValidationStatus = 'PASS' | 'WARNING' | 'FAIL';
export type ValidationSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface ValidationCheckItem {
  code: string;
  message: string;
  severity: ValidationSeverity;
  passed: boolean;
  metadata?: Record<string, unknown>;
}

export interface ValidationReport {
  status: ValidationStatus;
  gate_name: string;
  summary: string;
  checks: ValidationCheckItem[];
  errors: string[];
  warnings: string[];
}

export interface BriefValidationResponse {
  is_valid: boolean;
  status: ValidationStatus;
  report: ValidationReport;
  validated_payload?: Record<string, unknown>;
}

export interface AssetValidationResponse {
  is_valid: boolean;
  status: ValidationStatus;
  report: ValidationReport;
  asset_metadata?: {
    url?: string;
    file_size_bytes?: number;
    detected_mime?: string;
    width?: number;
    height?: number;
    aspect_ratio?: number;
    has_alpha_channel?: boolean;
    transparency_percent?: number;
    cutout_bbox?: number[];
    [key: string]: unknown;
  };
}

export type CopyPolicyClassification = 'FACTUAL' | 'USER_PROVIDED' | 'AI_GENERATED_CREATIVE';

export interface ConceptSpec {
  name: string;
  creative_angle?: string;
  angle?: string; // backwards compatibility alias
  reasoning_notes?: string;
  notes?: string; // backwards compatibility alias
}

export interface VisualDirectionSpec {
  mood: string;
  lighting: string;
  background_direction: string;
  product_placement: string;
  text_placement: string;
  negative_prompt: string;
}

export interface CopySpec {
  headline: string;
  subheadline?: string;
  cta: string;
  headline_policy: CopyPolicyClassification;
  subheadline_policy: CopyPolicyClassification;
  cta_policy: CopyPolicyClassification;
}

export interface CreativeStrategySpec {
  concept: ConceptSpec;
  visual_direction: VisualDirectionSpec;
  copy_spec: CopySpec;
  template_id: string;
}

export interface ClaimAuditItem {
  text_segment: string;
  classification: CopyPolicyClassification;
  is_supported: boolean;
  source_reference?: string;
  reason?: string;
}

export interface ClaimValidationReport {
  passed: boolean;
  supported_facts: string[];
  creative_flourishes: string[];
  unsupported_claims: string[];
  price_check_passed: boolean;
  discount_check_passed: boolean;
  claims_audit: ClaimAuditItem[];
  summary: string;
}

export interface StrategyGenerationResponse {
  status: 'APPROVED' | 'REJECTED';
  strategy: CreativeStrategySpec;
  claim_report: ClaimValidationReport;
  retry_count: number;
  strategy_id?: string;
  job_id?: string;
  created_at?: string;
}

export interface TemplateInfo {
  template_id: string;
  name: string;
  description: string;
  default_product_placement: string;
  default_text_placement: string;
  supports_dark_mode: boolean;
  recommended_for_objectives: string[];
}

export type TargetPlatform = 'instagram' | 'facebook' | 'linkedin';

export interface DiagnosticCheck {
  passed: boolean;
  score: number;
  severity: 'PASS' | 'WARNING' | 'FAIL';
  details: string;
  metrics?: Record<string, unknown>;
}

export interface BackgroundQAResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  overall_score: number;
  dimension_check: DiagnosticCheck;
  text_artifact_check: DiagnosticCheck;
  watermark_check: DiagnosticCheck;
  extra_object_check: DiagnosticCheck;
  negative_space_check: DiagnosticCheck;
  product_safe_zone_check: DiagnosticCheck;
  brightness_check: DiagnosticCheck;
  issues: string[];
  warnings: string[];
  retry_guidance?: string;
}

export interface BackgroundResponse {
  id: string;
  job_id: string;
  strategy_id: string;
  platform: TargetPlatform;
  width: number;
  height: number;
  aspect_ratio: string;
  image_url: string;
  qa_status: 'PASS' | 'WARNING' | 'FAIL';
  qa_result: BackgroundQAResult;
  attempt_number: number;
  prompt: {
    positive_prompt: string;
    negative_prompt: string;
    width: number;
    height: number;
    aspect_ratio: string;
    platform: string;
    template_id: string;
    prompt_version: string;
  };
  provider: string;
  model_name: string;
  is_cached: boolean;
  created_at: string;
}

export interface ProductPlacementConfig {
  scale?: number;
  alignment?: 'center' | 'bottom' | 'left' | 'right' | 'top';
  padding_pct?: number;
  offset_x?: number;
  offset_y?: number;
}

export interface ShadowConfig {
  enabled?: boolean;
  opacity?: number;
  blur_radius?: number;
  offset_x?: number;
  offset_y?: number;
}

export interface CompositeQAResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  overall_score: number;
  dimension_check: DiagnosticCheck;
  placement_check: DiagnosticCheck;
  visibility_check: DiagnosticCheck;
  boundary_check: DiagnosticCheck;
  integrity_check: DiagnosticCheck;
  issues: string[];
  warnings: string[];
  diagnostics?: Record<string, unknown>;
}

export interface CompositeResponse {
  id: string;
  job_id: string;
  strategy_id: string;
  brief_id?: string;
  background_id: string;
  platform: TargetPlatform;
  width: number;
  height: number;
  aspect_ratio: string;
  image_url: string;
  cutout_url?: string;
  placement_spec: {
    x: number;
    y: number;
    width: number;
    height: number;
    normalized_slot: number[];
  };
  shadow_spec: ShadowConfig;
  integrity_metadata: {
    source_asset_id: string;
    source_asset_hash: string;
    cutout_hash: string;
    background_id: string;
    output_hash: string;
    compositing_method: string;
  };
  qa_status: 'PASS' | 'WARNING' | 'FAIL';
  qa_result: CompositeQAResult;
  attempt_number: number;
  is_cached: boolean;
  created_at: string;
}

export interface GenerateCompositePayload {
  background_id: string;
  placement?: ProductPlacementConfig;
  shadow?: ShadowConfig;
  force_regenerate?: boolean;
}

export interface RegenerateCompositePayload {
  placement?: ProductPlacementConfig;
  shadow?: ShadowConfig;
  custom_feedback?: string;
}

export interface TypographyStyle {
  font_family: string;
  headline_size: number;
  headline_weight: 'regular' | 'bold';
  subheadline_size: number;
  subheadline_weight: 'regular' | 'bold';
  headline_color: string;
  subheadline_color: string;
  line_height_multiplier: number;
  alignment: 'left' | 'center' | 'right';
}

export interface CTAStyle {
  enabled: boolean;
  bg_color: string;
  text_color: string;
  border_radius: number;
  font_size: number;
  padding_x: number;
  padding_y: number;
}

export interface PriceBadgeStyle {
  enabled: boolean;
  bg_color: string;
  text_color: string;
  border_radius: number;
  font_size: number;
}

export interface ReadabilityEnhancementConfig {
  auto_scrim: boolean;
  scrim_opacity: number;
}

export interface FinalAdProvenance {
  source_asset_id: string;
  source_asset_hash: string;
  cutout_hash: string;
  background_id: string;
  composite_id: string;
  composite_output_hash: string;
  copy_hash: string;
  font_hashes: Record<string, string>;
  output_hash: string;
  renderer_version: string;
}

export interface FinalAdQAResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  overall_score: number;
  dimension_check: DiagnosticCheck;
  opacity_check: DiagnosticCheck;
  text_safe_zone_check: DiagnosticCheck;
  exact_copy_check: DiagnosticCheck;
  cta_check: DiagnosticCheck;
  product_occlusion_check: DiagnosticCheck;
  contrast_check: DiagnosticCheck;
  checks?: DiagnosticCheck[];
  issues: string[];
  warnings: string[];
  diagnostics?: Record<string, unknown>;
}

export type VisionQAStatus =
  | 'NOT_RUN'
  | 'REAL_VERIFIED'
  | 'MOCK_VERIFIED'
  | 'UNAVAILABLE'
  | 'FAILED';

export interface VisionCheckResult {
  passed: boolean;
  severity: 'PASS' | 'WARNING' | 'FAIL';
  detail?: string | null;
}

export interface VisionVerificationChecks {
  text_readable?: VisionCheckResult | boolean;
  text_no_clipping?: VisionCheckResult | boolean;
  text_no_unexpected_content?: VisionCheckResult | boolean;
  product_visible?: VisionCheckResult | boolean;
  product_placement_reasonable?: VisionCheckResult | boolean;
  product_no_corruption?: VisionCheckResult | boolean;
  composition_hierarchy?: VisionCheckResult | boolean;
  composition_no_clutter?: VisionCheckResult | boolean;
  branding_colors_present?: VisionCheckResult | boolean;
  branding_no_unauthorized?: VisionCheckResult | boolean;
  no_ai_artifacts?: VisionCheckResult | boolean;
  no_watermarks?: VisionCheckResult | boolean;
  dimensions?: boolean;
  composition?: boolean;
  branding?: boolean;
  text_readability?: boolean;
  artifacts?: boolean;
  [key: string]: unknown;
}

export interface VisionQAResultSpec {
  status?: 'PASS' | 'WARNING' | 'FAIL';
  checks?: VisionVerificationChecks;
  issues?: string[];
  warnings?: string[];
  summary?: string;
  advisory?: boolean;
  provider?: string;
  model_name?: string;
  model?: string;
  is_mock?: boolean;
  verification_id?: string;
  generation_id?: string;
  output_hash?: string;
  final_ad_id?: string;
  verified_at?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface FinalAdResponse {
  id: string;
  job_id: string;
  strategy_id: string;
  brief_id?: string;
  composite_id: string;
  background_id: string;
  platform: TargetPlatform;
  width: number;
  height: number;
  aspect_ratio: string;
  image_url: string;
  copy_spec: {
    headline: string;
    subheadline?: string;
    cta_text: string;
    price_text?: string;
    offer_text?: string;
    brand_name: string;
  };
  typography_spec: TypographyStyle;
  cta_spec: CTAStyle;
  logo_spec?: Record<string, unknown>;
  price_badge_spec?: PriceBadgeStyle;
  readability_spec: ReadabilityEnhancementConfig;
  provenance_chain: FinalAdProvenance;
  qa_status: 'PASS' | 'WARNING' | 'FAIL';
  qa_result: FinalAdQAResult;
  attempt_number: number;
  is_cached: boolean;
  vision_qa_status?: VisionQAStatus | 'PASS' | 'WARNING' | 'FAIL' | null;
  vision_qa_result?: VisionQAResultSpec | null;
  is_stale?: boolean;
  created_at: string;
}

export interface GenerateFinalAdPayload {
  composite_id: string;
  typography?: Partial<TypographyStyle>;
  cta?: Partial<CTAStyle>;
  price_badge?: Partial<PriceBadgeStyle>;
  readability?: Partial<ReadabilityEnhancementConfig>;
  force_regenerate?: boolean;
}

export interface RegenerateFinalAdPayload {
  typography?: Partial<TypographyStyle>;
  cta?: Partial<CTAStyle>;
  price_badge?: Partial<PriceBadgeStyle>;
  readability?: Partial<ReadabilityEnhancementConfig>;
  custom_feedback?: string;
}

export interface PlatformDefinition {
  platform: TargetPlatform;
  name: string;
  target_width: number;
  target_height: number;
  aspect_ratio: string;
  creative_characteristics: string[];
  default_style_notes: string;
}

export type WorkflowStage = 'brief' | 'strategy' | 'background' | 'product' | 'composite' | 'final_ad';

export type StageState = 'DRAFT' | 'VALIDATING' | 'GENERATING' | 'QA' | 'WARNING' | 'APPROVED' | 'FAILED' | 'LOCKED';

export interface StageDependencyCheck {
  id: string;
  name: string;
  satisfied: boolean;
  targetStage: WorkflowStage;
}

export interface StageStatusInfo {
  stage: WorkflowStage;
  label: string;
  stepNumber: number;
  status: StageState;
  isComplete: boolean;
  isLocked: boolean;
  dependencies: StageDependencyCheck[];
}

export type PublishingStatus = 'PUBLISH_QUEUED' | 'PUBLISHING' | 'PUBLISHED' | 'PUBLISH_FAILED';

export interface PublishRequest {
  final_ad_id: string;
  platform: string;
  caption?: string;
  platform_metadata?: Record<string, unknown>;
  idempotency_key?: string;
  account_id?: string;
}

export interface PublishRetryRequest {
  reason?: string;
}

export interface PublishingRecordResponse {
  id: string;
  tenant_id: string;
  final_ad_id: string;
  platform: string;
  status: PublishingStatus;
  provider: string;
  external_account_id?: string | null;
  external_post_id?: string | null;
  post_url?: string | null;
  caption?: string | null;
  platform_metadata: Record<string, unknown>;
  idempotency_key: string;
  requested_at: string;
  published_at?: string | null;
  last_attempt_at?: string | null;
  attempt_count: number;
  error_code?: string | null;
  error_message?: string | null;
  provenance_chain: Record<string, unknown>;
}

export interface PublishingReconcileResponse {
  reconciled: boolean;
  previous_status: string;
  current_status: string;
  external_post_id?: string | null;
  post_url?: string | null;
  message: string;
}

export interface PlatformPublishingCapability {
  platform: string;
  display_name: string;
  supported_media_types: string[];
  supported_aspect_ratios: string[];
  max_caption_length: number;
  supports_hashtags: boolean;
  max_hashtags?: number | null;
  supports_links: boolean;
  provider_type: string;
  integration_status: 'MOCK' | 'NOT_CONFIGURED' | 'AVAILABLE';
}

export interface BriefPayload {
  product?: {
    name?: string;
    category?: string;
    sku?: string;
    image_url?: string;
    offer?: {
      price?: number;
      original_price?: number;
      currency?: string;
      discount_percent?: number;
      promo_code?: string;
    };
    features?: string[];
  };
  brand?: {
    name?: string;
    logo_url?: string;
    colors?: string[];
    font_family?: string;
  };
  campaign?: {
    name?: string;
    objective?: string;
    platforms?: string[];
    target_audience?: string;
  };
  approved_claims?: string[];
  copy?: {
    headline?: string;
    subheadline?: string;
    cta?: string;
  };
  images?: Array<{
    url: string;
    asset_type?: string;
    description?: string;
    require_transparency?: boolean;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface BriefResponse {
  id: string;
  brand_name: string;
  product_name: string;
  campaign_name: string;
  price?: number;
  currency?: string;
  platforms?: string[];
  validation_status: string;
  payload: BriefPayload;
  validation_report: ValidationReport;
  created_at?: string | null;
}

export interface BriefListItem {
  id: string;
  tenant_id: string;
  brand_name: string;
  product_name: string;
  campaign_name: string;
  price?: number;
  currency?: string;
  platforms?: string[];
  validation_status: string;
  created_at?: string | null;
}

export interface SaveBriefResponse {
  id: string;
  tenant_id: string;
  validation_status: string;
  brand_name: string;
  product_name: string;
  platforms: string[];
  brief_report: ValidationReport;
  asset_report?: ValidationReport | null;
  asset_result?: AssetValidationResponse | null;
  created_at?: string | null;
  detail?: { message?: string; gate_name?: string; report?: ValidationReport } | string;
}

export interface StrategyRecordResponse {
  id: string;
  tenant_id: string;
  brief_id: string;
  version_number: number;
  status: 'APPROVED' | 'REJECTED';
  template_id: string;
  strategy_spec: CreativeStrategySpec;
  claim_validation_report: ClaimValidationReport;
  retry_count: number;
  created_at?: string | null;
}

export interface StrategyValidationResponse {
  is_valid: boolean;
  status: string;
  claim_report: ClaimValidationReport;
}

export interface FinalAdApprovalResponse {
  approved: boolean;
  message: string;
  final_ad_id: string;
  job_id: string;
  qa_status: string;
  vision_qa_status: string;
}

export interface JobStatusResponse {
  id: string;
  brief_id?: string | null;
  strategy_id?: string | null;
  status: string;
  current_stage: string;
  progress_pct: number;
  stage_data?: Record<string, unknown> | null;
  error_details?: Record<string, unknown> | null;
  resource_ids: Record<string, string | null>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface JobDispatchResponse {
  job_id: string;
  task_id: string;
  status: string;
  stage: string;
}




export type SourceValidationStatus =
  | "VERIFIED"
  | "REDIRECTED_AND_VERIFIED"
  | "SEARCH_RESULT_ONLY"
  | "ACCESS_RESTRICTED"
  | "TEMPORARILY_UNAVAILABLE"
  | "BROKEN"
  | "REJECTED";

export type ResearchCompletionStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PARTIALLY_COMPLETED"
  | "COMPLETED"
  | "FAILED";

export type EvidenceStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "CONTRADICTED";

export type FindingNature = "FACT" | "TREND" | "HYPOTHESIS" | "RECOMMENDATION";

export type ResearchDepth = "COMPREHENSIVE" | "STANDARD" | "LEAN";

export type SourceTier = "PRIMARY" | "SECONDARY" | "TERTIARY";

export type ConfidenceLevel = "High" | "Medium" | "Low";

export type SemanticRelevanceStatus =
  | "HIGHLY_RELEVANT"
  | "PARTIALLY_RELEVANT"
  | "IRRELEVANT"
  | "INSUFFICIENT_EVIDENCE";

export interface CampaignResearchProfile {
  business_name: string;
  industry: string;
  business_model_hint: string;
  campaign_objective: string;
  campaign_type: string;
  geography: string;
  target_audience: string;
  budget_level: string;
  duration: string;
  research_depth: ResearchDepth;
  selected_categories: string[];
  generated_queries: string[];
}

export interface ResearchSource {
  source_id: string; // e.g. "SRC-001"
  title: string;
  publisher: string;
  domain: string;
  original_url: string;
  final_url: string;
  published_date: string | null;
  accessed_date: string;
  http_status: number | null;
  validation_status: SourceValidationStatus;
  semantic_relevance?: SemanticRelevanceStatus;
  relevance_notes?: string;
  is_social_media?: boolean;
  is_directory_listing?: boolean;
  source_type: string;
  source_tier: SourceTier;
  evidence_excerpt: string;
  supported_finding_ids: string[];
  redirect_chain?: string[];
  content_snippet?: string;
}

export interface ResearchFinding {
  finding_id: string; // e.g. "FND-001"
  category: string; // Dynamically determined per campaign
  title: string;
  claim: string;
  explanation: string;
  evidence_excerpt: string;
  supporting_source_ids: string[];
  confidence: ConfidenceLevel;
  evidence_status: EvidenceStatus;
  semantic_relevance?: SemanticRelevanceStatus;
  finding_nature?: FindingNature;
  evidence_evaluation?: string;
  rejection_reasons?: string[];
  direct_evidence?: boolean;
  limitations: string | null;
  retrieved_date: string;
}

export interface CompetitorAnalysisItem {
  name: string;
  website: string;
  is_official_domain: boolean;
  business_description: string;
  products: string;
  pricing: string;
  positioning: string;
  offers: string;
  strengths: string[];
  weaknesses: string[];
  source_ids: string[];
  last_verified_date: string;
  validation_status: SourceValidationStatus;
  notes?: string;
}

export type LiveSearchErrorCategory =
  | "AUTH_ERROR"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "NO_RESULTS"
  | "NONE";

export interface SearchProviderStatus {
  active_provider: string;
  is_live_search_available: boolean;
  missing_credentials: string[];
  provider_notes: string;
  live_search_attempted?: boolean;
  live_search_succeeded?: boolean;
  live_query_count?: number;
  live_results_count?: number;
  error_category?: LiveSearchErrorCategory;
  error_message?: string;
}

export interface ResearchDossier {
  artifact_id: "artifact_2";
  type: "research_enrichment";
  campaign_id: string;
  version: string;
  business_name: string;
  industry: string;
  campaign_profile?: CampaignResearchProfile;
  research_status: ResearchCompletionStatus;
  completion_date: string;
  categories_completed: string[];
  findings: ResearchFinding[];
  competitors: CompetitorAnalysisItem[];
  sources: ResearchSource[];
  stats: {
    total_sources: number;
    verified_sources: number;
    unverified_sources: number;
    primary_sources: number;
    secondary_sources: number;
    tertiary_sources: number;
    total_findings: number;
    verified_findings: number;
    partially_verified_findings: number;
    unverified_findings: number;
    contradicted_findings: number;
    completion_rate_percent: number;
  };
  search_provider_status: SearchProviderStatus;
  limitations: string[];
  revision_history?: {
    version: string;
    completed_at: string;
    status: ResearchCompletionStatus;
    sources_count: number;
    findings_count: number;
  }[];
  provider_metadata: {
    provider: string;
    queries_executed: string[];
    generated_at: string;
    version: string;
  };
  // Backward compatibility fields for legacy views
  market_research?: any;
  competitor_research?: any[];
  audience_research?: any;
  platform_research?: any[];
  pricing_research?: any;
  trends_and_opportunities?: any;
}

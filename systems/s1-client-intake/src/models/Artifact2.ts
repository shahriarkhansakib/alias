import mongoose, { Schema, Document } from "mongoose";

export interface IArtifact2 extends Document {
  campaignId: mongoose.Types.ObjectId;
  type: string;
  status: "draft" | "confirmed";
  research_status: "NOT_STARTED" | "IN_PROGRESS" | "PARTIALLY_COMPLETED" | "COMPLETED" | "FAILED";
  version?: string;
  revision_history?: any[];
  search_provider_status?: any;
  business_name?: string;
  industry?: string;
  campaign_profile?: any;
  completion_date?: string;
  categories_completed?: string[];
  findings?: any[];
  competitors?: any[];
  sources: any[];
  stats?: any;
  limitations?: string[];
  provider_metadata?: any;
  // Legacy fields preserved for backward compatibility
  market_research?: {
    overview: string;
    market_size: string;
    growth: string;
    trends: string[];
    opportunities: string[];
    risks: string[];
  };
  competitor_research?: any[];
  audience_research?: {
    demographics: string[];
    interests: string[];
    behaviors: string[];
    pain_points: string[];
    motivations: string[];
    buying_patterns: string[];
    platform_usage: string[];
  };
  platform_research?: any[];
  pricing_research?: {
    market_price_range: string;
    competitor_prices: any[];
    common_offers: string[];
    discount_patterns: string[];
  };
  trends_and_opportunities?: {
    content_trends: string[];
    consumer_trends: string[];
    seasonal_trends: string[];
    opportunities: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const Artifact2Schema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    type: { type: String, default: "research_enrichment" },
    status: { type: String, enum: ["draft", "confirmed"], default: "draft" },
    research_status: {
      type: String,
      enum: ["NOT_STARTED", "IN_PROGRESS", "PARTIALLY_COMPLETED", "COMPLETED", "FAILED"],
      default: "IN_PROGRESS",
    },
    version: { type: String, default: "1.0" },
    revision_history: [{ type: Schema.Types.Mixed }],
    search_provider_status: { type: Schema.Types.Mixed },
    business_name: { type: String, default: "" },
    industry: { type: String, default: "" },
    campaign_profile: { type: Schema.Types.Mixed },
    completion_date: { type: String, default: "" },
    categories_completed: [{ type: String }],
    findings: [{ type: Schema.Types.Mixed }],
    competitors: [{ type: Schema.Types.Mixed }],
    sources: [{ type: Schema.Types.Mixed }],
    stats: { type: Schema.Types.Mixed },
    limitations: [{ type: String }],
    provider_metadata: { type: Schema.Types.Mixed },

    // Legacy fields preserved
    market_research: {
      overview: { type: String, default: "" },
      market_size: { type: String, default: "" },
      growth: { type: String, default: "" },
      trends: [{ type: String }],
      opportunities: [{ type: String }],
      risks: [{ type: String }],
    },
    competitor_research: [{ type: Schema.Types.Mixed }],
    audience_research: {
      demographics: [{ type: String }],
      interests: [{ type: String }],
      behaviors: [{ type: String }],
      pain_points: [{ type: String }],
      motivations: [{ type: String }],
      buying_patterns: [{ type: String }],
      platform_usage: [{ type: String }],
    },
    platform_research: [{ type: Schema.Types.Mixed }],
    pricing_research: {
      market_price_range: { type: String, default: "" },
      competitor_prices: [{ type: Schema.Types.Mixed }],
      common_offers: [{ type: String }],
      discount_patterns: [{ type: String }],
    },
    trends_and_opportunities: {
      content_trends: [{ type: String }],
      consumer_trends: [{ type: String }],
      seasonal_trends: [{ type: String }],
      opportunities: [{ type: String }],
    },
  },
  { timestamps: true }
);

export default mongoose.models.Artifact2 || mongoose.model<IArtifact2>("Artifact2", Artifact2Schema);

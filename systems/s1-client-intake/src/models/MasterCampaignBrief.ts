import mongoose, { Schema, Document } from "mongoose";

export interface IMasterCampaignBrief extends Document {
  campaignId: mongoose.Types.ObjectId;
  status: "draft" | "confirmed";
  version: string;
  campaign_summary: {
    campaign_name: string;
    business: string;
    product_service: string;
    objective: string;
    desired_result: string;
  };
  target_audience: {
    client_stated: any;
    research_insights: any;
  };
  market_insights: {
    key_findings: string[];
    trends: string[];
    opportunities: string[];
    risks: string[];
  };
  competitor_insights: {
    key_competitors: any[];
    pricing_insights: string[];
    positioning_insights: string[];
    content_insights: string[];
  };
  platform_insights: any[];
  offer_and_pricing: {
    client_offer: string;
    market_price_range: string;
    recommended_offer_direction: string;
  };
  brand_guidelines: {
    tone: string[];
    language: string[];
    visual_preferences: string[];
    do: string[];
    dont: string[];
  };
  budget: {
    amount: number | null;
    currency: string;
  };
  timeline: {
    start_date: string;
    end_date: string;
    duration: string;
  };
  strategic_direction: {
    key_message: string;
    content_direction: string[];
    campaign_direction: string[];
  };
  masterBriefMarkdown?: string;
  executionScriptMarkdown?: string;
  sources: any[];
  createdAt: Date;
  updatedAt: Date;
}

const MasterCampaignBriefSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    status: { type: String, enum: ["draft", "confirmed"], default: "draft" },
    version: { type: String, default: "1.0" },
    campaign_summary: {
      campaign_name: { type: String, default: "" },
      business: { type: String, default: "" },
      product_service: { type: String, default: "" },
      objective: { type: String, default: "" },
      desired_result: { type: String, default: "" },
    },
    target_audience: {
      client_stated: { type: Schema.Types.Mixed },
      research_insights: { type: Schema.Types.Mixed },
    },
    market_insights: {
      key_findings: [{ type: String }],
      trends: [{ type: String }],
      opportunities: [{ type: String }],
      risks: [{ type: String }],
    },
    competitor_insights: {
      key_competitors: [{ type: Schema.Types.Mixed }],
      pricing_insights: [{ type: String }],
      positioning_insights: [{ type: String }],
      content_insights: [{ type: String }],
    },
    platform_insights: [{ type: Schema.Types.Mixed }],
    offer_and_pricing: {
      client_offer: { type: String, default: "" },
      market_price_range: { type: String, default: "" },
      recommended_offer_direction: { type: String, default: "" },
    },
    brand_guidelines: {
      tone: [{ type: String }],
      language: [{ type: String }],
      visual_preferences: [{ type: String }],
      do: [{ type: String }],
      dont: [{ type: String }],
    },
    budget: {
      amount: { type: Number, default: null },
      currency: { type: String, default: "BDT" },
    },
    timeline: {
      start_date: { type: String, default: "" },
      end_date: { type: String, default: "" },
      duration: { type: String, default: "" },
    },
    strategic_direction: {
      key_message: { type: String, default: "" },
      content_direction: [{ type: String }],
      campaign_direction: [{ type: String }],
    },
    masterBriefMarkdown: { type: String, default: "" },
    executionScriptMarkdown: { type: String, default: "" },
    sources: [{ type: Schema.Types.Mixed }],
  },
  { timestamps: true }
);

export default mongoose.models.MasterCampaignBrief || mongoose.model<IMasterCampaignBrief>("MasterCampaignBrief", MasterCampaignBriefSchema);

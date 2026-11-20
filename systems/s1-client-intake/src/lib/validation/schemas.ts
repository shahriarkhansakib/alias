import { z } from "zod";

// ARTIFACT 1: CLIENT FACTS SCHEMA (Section 7)
export const Artifact1Schema = z.object({
  artifact_id: z.string().default("artifact_1"),
  type: z.literal("client_facts").default("client_facts"),
  status: z.enum(["draft", "confirmed"]).default("draft"),
  client: z.object({
    name: z.string().default(""),
    company_name: z.string().default(""),
    industry: z.string().default(""),
    website: z.string().default(""),
    business_description: z.string().default(""),
    brand_personality: z.string().default(""),
    competitor_references: z.array(z.string()).default([]),
    usp: z.string().default(""),
    operating_history: z.string().default(""),
  }),
  product_service: z.object({
    name: z.string().default(""),
    type: z.string().default(""),
    description: z.string().default(""),
    price: z.number().nullable().default(null),
    price_range: z.string().default(""),
    offer: z.string().default(""),
    pain_point_solved: z.string().default(""),
  }),
  campaign: z.object({
    name: z.string().default(""),
    objective: z.string().default(""),
    campaign_type: z.string().default(""),
    desired_result: z.string().default(""),
    theme: z.string().default(""),
    ad_structure: z.string().default(""),
    channels: z.object({
      paid: z.array(z.string()).default([]),
      organic: z.array(z.string()).default([]),
    }).default({ paid: [], organic: [] }),
  }),
  target_audience: z.object({
    age_range: z.string().default(""),
    gender: z.string().default(""),
    location: z.string().default(""),
    description: z.string().default(""),
    pain_points: z.string().default(""),
  }),
  budget: z.object({
    amount: z.number().nullable().default(null),
    currency: z.string().default("BDT"),
    type: z.enum(["exact", "approximate", "range", "unknown", "unspecified"]).default("unspecified"),
  }),
  timeline: z.object({
    start_date: z.string().default(""),
    end_date: z.string().default(""),
    duration: z.string().default(""),
  }),
  brand_preferences: z.object({
    tone: z.array(z.string()).default([]),
    language: z.array(z.string()).default([]),
    visual_preference: z.string().default(""),
    colors: z.array(z.string()).default([]),
    do: z.array(z.string()).default([]),
    dont: z.array(z.string()).default([]),
  }),
  assets: z.object({
    logo: z.array(z.string()).default([]),
    images: z.array(z.string()).default([]),
    videos: z.array(z.string()).default([]),
    documents: z.array(z.string()).default([]),
    links: z.array(z.string()).default([]),
    readiness: z.string().default(""),
  }),
  offers: z.object({
    primary_offer: z.string().default(""),
    secondary_offer: z.string().default(""),
    status: z.enum(["suggested", "client_approved", "pending"]).default("suggested"),
  }).default({ primary_offer: "", secondary_offer: "", status: "suggested" }),
  operations: z.object({
    response_time: z.string().default(""),
    team_size: z.string().default(""),
    auto_reply_needed: z.boolean().default(true),
    delivery_partner: z.string().default(""),
    cod_available: z.boolean().default(true),
    exchange_policy: z.string().default(""),
  }).default({
    response_time: "",
    team_size: "",
    auto_reply_needed: true,
    delivery_partner: "",
    cod_available: true,
    exchange_policy: "",
  }),
  confirmed_facts: z.record(z.string(), z.any()).default({}),
  ai_recommendations: z.record(z.string(), z.any()).default({}),
  assumptions: z.record(z.string(), z.any()).default({}),
  missing_information: z.array(z.string()).default([]),
});

// ARTIFACT 2: RESEARCH ENRICHMENT SCHEMA (Section 10)
export const Artifact2Schema = z.object({
  artifact_id: z.string().default("artifact_2"),
  type: z.literal("research_enrichment").default("research_enrichment"),
  status: z.enum(["draft", "confirmed"]).default("draft"),
  research_status: z
    .enum(["NOT_STARTED", "IN_PROGRESS", "PARTIALLY_COMPLETED", "COMPLETED", "FAILED"])
    .default("IN_PROGRESS"),
  business_name: z.string().optional().default(""),
  industry: z.string().optional().default(""),
  completion_date: z.string().optional().default(""),
  categories_completed: z.array(z.string()).optional().default([]),
  findings: z.array(z.any()).optional().default([]),
  competitors: z.array(z.any()).optional().default([]),
  stats: z.record(z.string(), z.any()).optional().default({}),
  limitations: z.array(z.string()).optional().default([]),
  provider_metadata: z.record(z.string(), z.any()).optional().default({}),
  market_research: z
    .object({
      overview: z.string().default(""),
      market_size: z.string().default(""),
      growth: z.string().default(""),
      trends: z.array(z.string()).default([]),
      opportunities: z.array(z.string()).default([]),
      risks: z.array(z.string()).default([]),
    })
    .optional()
    .default({
      overview: "",
      market_size: "",
      growth: "",
      trends: [],
      opportunities: [],
      risks: [],
    }),
  competitor_research: z
    .array(
      z.object({
        name: z.string(),
        website: z.string().optional().default(""),
        products: z.string().optional().default(""),
        price_range: z.string().optional().default(""),
        positioning: z.string().optional().default(""),
        offers: z.string().optional().default(""),
        social_presence: z.string().optional().default(""),
        content_strategy: z.string().optional().default(""),
      })
    )
    .optional()
    .default([]),
  audience_research: z
    .object({
      demographics: z.array(z.string()).default([]),
      interests: z.array(z.string()).default([]),
      behaviors: z.array(z.string()).default([]),
      pain_points: z.array(z.string()).default([]),
      motivations: z.array(z.string()).default([]),
      buying_patterns: z.array(z.string()).default([]),
      platform_usage: z.array(z.string()).default([]),
    })
    .optional()
    .default({
      demographics: [],
      interests: [],
      behaviors: [],
      pain_points: [],
      motivations: [],
      buying_patterns: [],
      platform_usage: [],
    }),
  platform_research: z
    .array(
      z.object({
        platform: z.string(),
        suitability_score: z.string().optional().default("High"),
        recommended_content: z.string().optional().default(""),
        formats: z.array(z.string()).optional().default([]),
        best_practices: z.array(z.string()).optional().default([]),
      })
    )
    .optional()
    .default([]),
  pricing_research: z
    .object({
      market_price_range: z.string().default(""),
      competitor_prices: z.array(z.any()).default([]),
      common_offers: z.array(z.string()).default([]),
      discount_patterns: z.array(z.string()).default([]),
    })
    .optional()
    .default({
      market_price_range: "",
      competitor_prices: [],
      common_offers: [],
      discount_patterns: [],
    }),
  trends_and_opportunities: z
    .object({
      content_trends: z.array(z.string()).default([]),
      consumer_trends: z.array(z.string()).default([]),
      seasonal_trends: z.array(z.string()).default([]),
      opportunities: z.array(z.string()).default([]),
    })
    .optional()
    .default({
      content_trends: [],
      consumer_trends: [],
      seasonal_trends: [],
      opportunities: [],
    }),
  sources: z.array(z.any()).default([]),
});

// MASTER CAMPAIGN BRIEF SCHEMA (Section 12)
export const MasterCampaignBriefSchema = z.object({
  brief_id: z.string().default("brief_1"),
  status: z.enum(["draft", "confirmed"]).default("draft"),
  version: z.string().default("1.0"),
  campaign_summary: z.object({
    campaign_name: z.string().default(""),
    business: z.string().default(""),
    product_service: z.string().default(""),
    objective: z.string().default(""),
    desired_result: z.string().default(""),
  }),
  target_audience: z.object({
    client_stated: z.record(z.string(), z.any()).default({}),
    research_insights: z.record(z.string(), z.any()).default({}),
  }),
  market_insights: z.object({
    key_findings: z.array(z.string()).default([]),
    trends: z.array(z.string()).default([]),
    opportunities: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
  }),
  competitor_insights: z.object({
    key_competitors: z.array(z.any()).default([]),
    pricing_insights: z.array(z.string()).default([]),
    positioning_insights: z.array(z.string()).default([]),
    content_insights: z.array(z.string()).default([]),
  }),
  platform_insights: z.array(z.any()).default([]),
  offer_and_pricing: z.object({
    client_offer: z.string().default(""),
    market_price_range: z.string().default(""),
    recommended_offer_direction: z.string().default(""),
  }),
  brand_guidelines: z.object({
    tone: z.array(z.string()).default([]),
    language: z.array(z.string()).default([]),
    visual_preferences: z.array(z.string()).default([]),
    do: z.array(z.string()).default([]),
    dont: z.array(z.string()).default([]),
  }),
  budget: z.object({
    amount: z.number().nullable().default(null),
    currency: z.string().default("BDT"),
  }),
  timeline: z.object({
    start_date: z.string().default(""),
    end_date: z.string().default(""),
    duration: z.string().default(""),
  }),
  strategic_direction: z.object({
    key_message: z.string().default(""),
    content_direction: z.array(z.string()).default([]),
    campaign_direction: z.array(z.string()).default([]),
  }),
  sources: z.array(z.any()).default([]),
});

// CONVERSATION RESPONSE SCHEMA
export const ConversationTurnSchema = z.object({
  ai_message: z.string(),
  extracted_updates: z.record(z.string(), z.any()).optional().default({}),
  confidence_scores: z.record(z.string(), z.number()).optional().default({}),
  status: z.enum(["collecting", "ready_for_confirmation"]).default("collecting"),
  missing_fields: z.array(z.string()).optional().default([]),
  quick_replies: z.array(z.string()).optional().default([]),
  engine: z.enum(["gemini", "openai", "demo"]).optional(),
});

// CAMPAIGN DOCUMENTS SCHEMA (Phase 1 Deliverables)
export const CampaignDocumentsSchema = z.object({
  master_campaign_brief_md: z.string().default(""),
  campaign_execution_script_md: z.string().default(""),
  generated_at: z.string().default(""),
  version: z.string().default("1.0"),
});


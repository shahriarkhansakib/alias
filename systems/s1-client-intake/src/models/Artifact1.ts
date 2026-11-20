import mongoose, { Schema, Document } from "mongoose";

export type FieldSource = "client_stated" | "admin_provided" | "ai_inferred";
export type FieldVerificationStatus = "unverified" | "confirmed" | "needs_clarification";

export interface IProvenanceField<T = any> {
  value: T;
  source: FieldSource;
  confidence: number;
  verification_status: FieldVerificationStatus;
}

export type ArtifactStatus =
  | "draft"
  | "ready_for_review"
  | "needs_clarification"
  | "confirmed"
  | "DRAFT"
  | "READY_FOR_REVIEW"
  | "NEEDS_CLARIFICATION"
  | "CONFIRMED";

export interface IArtifact1Snapshot {
  version: number;
  status: string;
  sections: any;
  confirmedAt?: Date | null;
  confirmedBy?: string | null;
  updatedAt: Date;
  reason?: string;
}

export interface IArtifact1Sections {
  business_profile: {
    company_name: IProvenanceField<string>;
    industry: IProvenanceField<string>;
    website: IProvenanceField<string>;
    business_description: IProvenanceField<string>;
    business_location: IProvenanceField<string>;
  };
  product_offering: {
    name: IProvenanceField<string>;
    category: IProvenanceField<string>;
    description: IProvenanceField<string>;
    key_features: IProvenanceField<string[]>;
    usp: IProvenanceField<string>;
    pricing: IProvenanceField<number | string | null>;
    main_benefits: IProvenanceField<string[]>;
  };
  campaign_objectives: {
    primary_objective: IProvenanceField<string>;
    secondary_objectives: IProvenanceField<string[]>;
    desired_results: IProvenanceField<string>;
    kpis: IProvenanceField<string[]>;
  };
  target_audience: {
    age_range: IProvenanceField<string>;
    gender: IProvenanceField<string>;
    location: IProvenanceField<string>;
    description: IProvenanceField<string>;
    demographics: IProvenanceField<string>;
    pain_points: IProvenanceField<string[]>;
    needs: IProvenanceField<string[]>;
  };
  budget_allocation: {
    total_budget: IProvenanceField<number | null>;
    currency: IProvenanceField<string>;
    budget_type: IProvenanceField<"fixed" | "range" | "approximate" | "unknown" | "unspecified">;
    budget_flexibility: IProvenanceField<string>;
  };
  execution_timeline: {
    duration: IProvenanceField<string>;
    expected_launch_date: IProvenanceField<string>;
    launch_readiness: IProvenanceField<string>;
    deadlines: IProvenanceField<string>;
  };
  brand_identity: {
    brand_voice: IProvenanceField<string[]>;
    brand_personality: IProvenanceField<string>;
    brand_positioning: IProvenanceField<string>;
    brand_guidelines: IProvenanceField<string>;
  };
  marketing_preferences: {
    preferred_platforms: IProvenanceField<string[]>;
    content_types: IProvenanceField<string[]>;
    competitors: IProvenanceField<string[]>;
    previous_experience: IProvenanceField<string>;
    other_preferences: IProvenanceField<string>;
  };
}

export function createInitialSections(): IArtifact1Sections {
  return {
    business_profile: {
      company_name: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      industry: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      website: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      business_description: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      business_location: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    product_offering: {
      name: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      category: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      description: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      key_features: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      usp: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      pricing: { value: null, source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      main_benefits: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    campaign_objectives: {
      primary_objective: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      secondary_objectives: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      desired_results: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      kpis: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    target_audience: {
      age_range: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      gender: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      location: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      description: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      demographics: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      pain_points: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      needs: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    budget_allocation: {
      total_budget: { value: null, source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      currency: { value: "BDT", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      budget_type: { value: "unspecified", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      budget_flexibility: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    execution_timeline: {
      duration: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      expected_launch_date: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      launch_readiness: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      deadlines: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    brand_identity: {
      brand_voice: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      brand_personality: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      brand_positioning: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      brand_guidelines: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
    marketing_preferences: {
      preferred_platforms: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      content_types: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      competitors: { value: [], source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      previous_experience: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
      other_preferences: { value: "", source: "client_stated", confidence: 1.0, verification_status: "unverified" },
    },
  };
}

export interface IArtifact1Metadata {
  generatedAt: Date;
  lastUpdatedAt: Date;
  confirmedAt?: Date | null;
  confirmedBy?: string | null;
}

export interface IArtifact1 extends Document {
  campaignId: mongoose.Types.ObjectId;
  conversationId?: mongoose.Types.ObjectId;
  type: string;
  artifactType: string;
  version: number;
  status: ArtifactStatus;
  sections: IArtifact1Sections;
  metadata: IArtifact1Metadata;
  revisions: IArtifact1Snapshot[];
  confirmedSnapshot?: any;

  // Legacy field support for backward compatibility
  client: {
    name: string;
    company_name: string;
    industry: string;
    website: string;
    business_description: string;
    brand_personality?: string;
    competitor_references?: string[];
    usp?: string;
    operating_history?: string;
  };
  product_service: {
    name: string;
    type: string;
    description: string;
    price: number | null;
    price_range?: string;
    offer: string;
    pain_point_solved?: string;
  };
  campaign: {
    name: string;
    objective: string;
    campaign_type: string;
    desired_result: string;
    theme?: string;
    ad_structure?: string;
    channels?: {
      paid?: string[];
      organic?: string[];
    };
  };
  target_audience: {
    age_range: string;
    gender: string;
    location: string;
    description: string;
    pain_points?: string;
  };
  budget: {
    amount: number | null;
    currency: string;
    type: "exact" | "approximate" | "range" | "unknown" | "unspecified";
  };
  timeline: {
    start_date: string;
    end_date: string;
    duration: string;
  };
  brand_preferences: {
    tone: string[];
    language: string[];
    visual_preference: string;
    colors?: string[];
    do: string[];
    dont: string[];
  };
  assets: {
    logo: string[];
    images: string[];
    videos: string[];
    documents: string[];
    links: string[];
    readiness?: string;
  };
  offers?: {
    primary_offer: string;
    secondary_offer: string;
    status: string;
  };
  operations?: {
    response_time: string;
    team_size: string;
    auto_reply_needed: boolean;
    delivery_partner: string;
    cod_available: boolean;
    exchange_policy: string;
  };
  confirmed_facts?: Record<string, any>;
  ai_recommendations?: Record<string, any>;
  assumptions?: Record<string, any>;
  missing_information?: string[];

  createdAt: Date;
  updatedAt: Date;
}

const Artifact1Schema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
    type: { type: String, default: "client_facts" },
    artifactType: { type: String, default: "client_campaign_brief" },
    version: { type: Number, default: 1 },
    status: {
      type: String,
      enum: [
        "draft",
        "ready_for_review",
        "needs_clarification",
        "confirmed",
        "DRAFT",
        "READY_FOR_REVIEW",
        "NEEDS_CLARIFICATION",
        "CONFIRMED",
      ],
      default: "DRAFT",
      index: true,
    },
    sections: {
      type: Schema.Types.Mixed,
      default: () => createInitialSections(),
    },
    metadata: {
      generatedAt: { type: Date, default: Date.now },
      lastUpdatedAt: { type: Date, default: Date.now },
      confirmedAt: { type: Date, default: null },
      confirmedBy: { type: String, default: null },
    },
    revisions: [
      {
        version: { type: Number, required: true },
        status: { type: String, required: true },
        sections: { type: Schema.Types.Mixed },
        confirmedAt: { type: Date, default: null },
        confirmedBy: { type: String, default: null },
        updatedAt: { type: Date, default: Date.now },
        reason: { type: String, default: "" },
      },
    ],
    confirmedSnapshot: { type: Schema.Types.Mixed, default: null },

    // Legacy fields for backward compatibility
    client: {
      name: { type: String, default: "" },
      company_name: { type: String, default: "" },
      industry: { type: String, default: "" },
      website: { type: String, default: "" },
      business_description: { type: String, default: "" },
      brand_personality: { type: String, default: "" },
      competitor_references: [{ type: String }],
      usp: { type: String, default: "" },
      operating_history: { type: String, default: "" },
    },
    product_service: {
      name: { type: String, default: "" },
      type: { type: String, default: "" },
      description: { type: String, default: "" },
      price: { type: Number, default: null },
      price_range: { type: String, default: "" },
      offer: { type: String, default: "" },
      pain_point_solved: { type: String, default: "" },
    },
    campaign: {
      name: { type: String, default: "" },
      objective: { type: String, default: "" },
      campaign_type: { type: String, default: "" },
      desired_result: { type: String, default: "" },
      theme: { type: String, default: "" },
      ad_structure: { type: String, default: "" },
      channels: {
        paid: [{ type: String }],
        organic: [{ type: String }],
      },
    },
    target_audience: {
      age_range: { type: String, default: "" },
      gender: { type: String, default: "" },
      location: { type: String, default: "" },
      description: { type: String, default: "" },
      pain_points: { type: String, default: "" },
    },
    budget: {
      amount: { type: Number, default: null },
      currency: { type: String, default: "BDT" },
      type: { type: String, enum: ["exact", "approximate", "range", "unknown", "unspecified"], default: "unspecified" },
    },
    timeline: {
      start_date: { type: String, default: "" },
      end_date: { type: String, default: "" },
      duration: { type: String, default: "" },
    },
    brand_preferences: {
      tone: [{ type: String }],
      language: [{ type: String }],
      visual_preference: { type: String, default: "" },
      colors: [{ type: String }],
      do: [{ type: String }],
      dont: [{ type: String }],
    },
    assets: {
      logo: [{ type: String }],
      images: [{ type: String }],
      videos: [{ type: String }],
      documents: [{ type: String }],
      links: [{ type: String }],
      readiness: { type: String, default: "" },
    },
    offers: {
      primary_offer: { type: String, default: "" },
      secondary_offer: { type: String, default: "" },
      status: { type: String, default: "suggested" },
    },
    operations: {
      response_time: { type: String, default: "" },
      team_size: { type: String, default: "" },
      auto_reply_needed: { type: Boolean, default: true },
      delivery_partner: { type: String, default: "" },
      cod_available: { type: Boolean, default: true },
      exchange_policy: { type: String, default: "" },
    },
    confirmed_facts: { type: Schema.Types.Mixed, default: {} },
    ai_recommendations: { type: Schema.Types.Mixed, default: {} },
    assumptions: { type: Schema.Types.Mixed, default: {} },
    missing_information: [{ type: String }],
  },
  { timestamps: true, strict: false }
);

if (mongoose.models && mongoose.models.Artifact1) {
  delete (mongoose.models as any).Artifact1;
}

export default mongoose.model<IArtifact1>("Artifact1", Artifact1Schema);

import { CampaignResearchProfile, ResearchDepth } from "./types";

export interface AnalyzedCampaignContext {
  profile: CampaignResearchProfile;
  industry: string;
  businessName: string;
  productName: string;
  location: string;
  objective: string;
  campaignType: string;
  depth: ResearchDepth;
  categories: string[];
  searchQueries: string[];
}

export class CampaignContextAnalyzer {
  /**
   * Analyzes the full intake facts from Artifact 1 and produces a tailored,
   * industry-agnostic research profile with dynamic category selection and targeted queries.
   */
  static analyze(artifact1: any): AnalyzedCampaignContext {
    const client = artifact1.client || {};
    const product = artifact1.product_service || {};
    const campaign = artifact1.campaign || {};
    const audience = artifact1.target_audience || {};
    const budget = artifact1.budget || {};
    const timeline = artifact1.timeline || {};

    const businessName = client.company_name?.trim() || client.name?.trim() || "Client Business";
    const rawIndustry = client.industry?.trim() || "";
    const productName = product.name?.trim() || "Core Offering";
    const productType = product.type?.trim() || "";
    const productDesc = product.description?.trim() || client.business_description?.trim() || "";
    const location = audience.location?.trim() || "National / Regional";
    const audienceDesc = audience.description?.trim() || audience.age_range?.trim() || "Target Market";
    const objective = campaign.objective?.trim() || campaign.desired_result?.trim() || "Commercial Growth";
    const campaignType = campaign.campaign_type?.trim() || "General Campaign";

    // Detect industry or business context flexibly (not restricted to predefined silos)
    const combinedText = `${rawIndustry} ${businessName} ${productName} ${productType} ${productDesc} ${campaignType}`.toLowerCase();

    // Determine Classification Hint (used as semantic guide, not strict boundary)
    const modelHint = this.detectBusinessModelHint(combinedText);

    // Determine Research Depth based on budget, geography scope, and campaign objective
    const depth = this.determineResearchDepth(budget, timeline, location, objective);

    // Dynamically select relevant categories based on actual business facts
    const categories = this.selectDynamicCategories(combinedText, modelHint, rawIndustry, productName, objective);

    // Generate campaign-specific search queries tailored to this business
    const searchQueries = this.generateTargetedQueries(
      businessName,
      rawIndustry || modelHint,
      productName,
      location,
      objective,
      categories
    );

    const profile: CampaignResearchProfile = {
      business_name: businessName,
      industry: rawIndustry || (modelHint !== "GENERAL_UNKNOWN" ? modelHint : "Specialized Industry"),
      business_model_hint: modelHint,
      campaign_objective: objective,
      campaign_type: campaignType,
      geography: location,
      target_audience: audienceDesc,
      budget_level: budget.amount ? `${budget.amount} ${budget.currency || "BDT"}` : "Unspecified",
      duration: timeline.duration || "Standard",
      research_depth: depth,
      selected_categories: categories,
      generated_queries: searchQueries,
    };

    return {
      profile,
      industry: profile.industry,
      businessName,
      productName,
      location,
      objective,
      campaignType,
      depth,
      categories,
      searchQueries,
    };
  }

  /**
   * Identifies business archetype hints without bounding the system to strict silos.
   */
  private static detectBusinessModelHint(text: string): string {
    if (
      text.includes("saas") ||
      text.includes("software") ||
      text.includes("cloud") ||
      text.includes("app development") ||
      text.includes("b2b platform") ||
      text.includes("fintech") ||
      text.includes("crm") ||
      text.includes("devops")
    ) {
      return "B2B_SAAS_TECH";
    }

    if (
      text.includes("restaurant") ||
      text.includes("cafe") ||
      text.includes("dining") ||
      text.includes("food") ||
      text.includes("bistro") ||
      text.includes("bakery") ||
      text.includes("culinary") ||
      text.includes("kitchen")
    ) {
      return "LOCAL_HOSPITALITY_DINING";
    }

    if (
      text.includes("school") ||
      text.includes("education") ||
      text.includes("academy") ||
      text.includes("course") ||
      text.includes("coaching") ||
      text.includes("training") ||
      text.includes("edtech") ||
      text.includes("university")
    ) {
      return "EDUCATION_TRAINING";
    }

    if (
      text.includes("real estate") ||
      text.includes("property") ||
      text.includes("developer") ||
      text.includes("apartment") ||
      text.includes("housing") ||
      text.includes("commercial space")
    ) {
      return "REAL_ESTATE_PROPERTY";
    }

    if (
      text.includes("hospital") ||
      text.includes("clinic") ||
      text.includes("dental") ||
      text.includes("healthcare") ||
      text.includes("medical") ||
      text.includes("pharma") ||
      text.includes("wellness")
    ) {
      return "HEALTHCARE_WELLNESS";
    }

    if (
      text.includes("clothing") ||
      text.includes("apparel") ||
      text.includes("fashion") ||
      text.includes("streetwear") ||
      text.includes("d2c") ||
      text.includes("ecommerce") ||
      text.includes("footwear") ||
      text.includes("jewelry")
    ) {
      return "CONSUMER_RETAIL_D2C";
    }

    // Flexible fallback: Any custom, novel, or specialized business
    return "GENERAL_UNKNOWN";
  }

  /**
   * Adapts research depth according to budget, duration, geography, and campaign complexity.
   */
  private static determineResearchDepth(
    budget: any,
    timeline: any,
    location: string,
    objective: string
  ): ResearchDepth {
    const amount = Number(budget.amount) || 0;
    const isMultiCity =
      location.includes(",") ||
      location.toLowerCase().includes("nationwide") ||
      location.toLowerCase().includes("global") ||
      location.toLowerCase().includes("multiple");

    if (amount > 300000 || isMultiCity || objective.toLowerCase().includes("scale") || objective.toLowerCase().includes("enterprise")) {
      return "COMPREHENSIVE";
    }

    if (amount > 0 && amount < 40000) {
      return "LEAN";
    }

    return "STANDARD";
  }

  /**
   * Dynamically selects relevant research categories tailored to the campaign.
   * Irrelevant categories (e.g. shipping returns for SaaS or software licensing for restaurants) are strictly excluded.
   */
  private static selectDynamicCategories(
    text: string,
    hint: string,
    rawIndustry: string,
    productName: string,
    objective: string
  ): string[] {
    const categories: string[] = [];

    // 1. Foundation: Industry Overview adapted to sector
    categories.push("Industry Landscape & Market Dynamics");

    // 2. Archetype / Sector-specific dynamic categories
    switch (hint) {
      case "B2B_SAAS_TECH":
        categories.push("Customer Acquisition & Trial Conversion");
        categories.push("Competitive Landscape & Alternatives");
        categories.push("Subscription Pricing & Packaging Models");
        categories.push("Security, Integration & Technical Decision Factors");
        break;

      case "LOCAL_HOSPITALITY_DINING":
        categories.push("Dining Trends & Cuisine Preferences");
        categories.push("Local Competing Venues & Differentiation");
        categories.push("Menu Pricing & Promotional Offers");
        categories.push("Local Footfall, Booking & Discovery Channels");
        break;

      case "EDUCATION_TRAINING":
        categories.push("Enrollment Demand & Career Motivation");
        categories.push("Competing Institutions & Course Alternatives");
        categories.push("Tuition Pricing & Value Proposition");
        categories.push("Student Acquisition & Admissions Channels");
        break;

      case "REAL_ESTATE_PROPERTY":
        categories.push("Property Demand & Price Trends");
        categories.push("Buyer Demographics & Financial Decision Factors");
        categories.push("Competing Developments & Unit Comparisons");
        categories.push("High-Trust Lead Generation Channels");
        break;

      case "HEALTHCARE_WELLNESS":
        categories.push("Patient Trust & Appointment Friction");
        categories.push("Competing Practitioners & Specializations");
        categories.push("Treatment Pricing & Consultation Packages");
        categories.push("Local Healthcare Discovery & Ethical Outreach");
        break;

      case "CONSUMER_RETAIL_D2C":
        categories.push("Consumer Buying Behavior & Seasonal Trends");
        categories.push("Direct Merchant Competition & Catalog Pricing");
        categories.push("Payment Reliability & Risk Mitigation");
        categories.push("Social Commerce & Acquisition Channels");
        break;

      case "GENERAL_UNKNOWN":
      default:
        // Universal dynamic adaptation for any custom or novel business:
        // Synthesizes categories specifically referencing the actual product and objective
        categories.push(`Target Customer Needs & Pain Points`);
        categories.push(`Competitive Positioning & Market Alternatives`);
        categories.push(`Commercial Pricing & Offer Structures`);
        categories.push(`${objective} Marketing & Acquisition Channels`);
        break;
    }

    // Optional 6th category for comprehensive campaigns:
    if (text.includes("risk") || text.includes("compliance") || text.includes("regulation") || text.includes("logistics")) {
      categories.push("Operational & Market Risks");
    }

    return categories;
  }

  /**
   * Generates highly specific, targeted search queries for the client's actual campaign.
   * Maps queries directly to the dynamically selected categories to avoid irrelevant results.
   */
  private static generateTargetedQueries(
    businessName: string,
    industry: string,
    productName: string,
    location: string,
    objective: string,
    categories: string[]
  ): string[] {
    // Extract concise primary geography (e.g. "Dhaka & Major Cities, Bangladesh" -> "Bangladesh")
    let primaryGeo = "Bangladesh";
    const locLower = location.toLowerCase();
    if (locLower.includes("bangladesh")) {
      primaryGeo = "Bangladesh";
    } else if (locLower.includes("united states") || locLower.includes("usa") || locLower.includes("us")) {
      primaryGeo = "United States";
    } else if (locLower.includes("uk") || locLower.includes("united kingdom")) {
      primaryGeo = "UK";
    } else {
      primaryGeo = location.replace(/[^\w\s]/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
    }

    // Extract core industry keyword
    let coreInd = industry.replace(/[^\w\s]/g, " ").trim();
    if (coreInd.toLowerCase().includes("streetwear") || coreInd.toLowerCase().includes("apparel") || coreInd.toLowerCase().includes("fashion")) {
      coreInd = "streetwear apparel";
    } else if (coreInd.toLowerCase().includes("saas") || coreInd.toLowerCase().includes("software")) {
      coreInd = "B2B SaaS";
    } else if (coreInd.toLowerCase().includes("restaurant") || coreInd.toLowerCase().includes("dining") || coreInd.toLowerCase().includes("food")) {
      coreInd = "restaurant dining";
    } else {
      coreInd = coreInd.split(/\s+/).slice(0, 3).join(" ");
    }

    const queries: string[] = [];

    for (const cat of categories) {
      const cLower = cat.toLowerCase();
      if (cLower.includes("landscape") || cLower.includes("overview") || cLower.includes("dynamics")) {
        queries.push(`${primaryGeo} ${coreInd} market size growth report overview`);
      } else if (cLower.includes("consumer") || cLower.includes("buying behavior") || cLower.includes("trends")) {
        queries.push(`${primaryGeo} ${coreInd} consumer shopping buying behavior survey study`);
      } else if (cLower.includes("pricing") || cLower.includes("competitor") || cLower.includes("catalog")) {
        queries.push(`${primaryGeo} ${coreInd} competitor pricing catalog rates`);
      } else if (cLower.includes("payment") || cLower.includes("risk") || cLower.includes("reliability")) {
        queries.push(`${primaryGeo} ecommerce cash on delivery COD payment methods return rate courier`);
      } else if (cLower.includes("social") || cLower.includes("acquisition") || cLower.includes("channel")) {
        queries.push(`${primaryGeo} ${coreInd} social commerce digital marketing channels report`);
      } else if (cLower.includes("trial") || cLower.includes("conversion")) {
        queries.push(`${coreInd} customer acquisition trial conversion benchmarks`);
      } else if (cLower.includes("dining") || cLower.includes("cuisine")) {
        queries.push(`${primaryGeo} restaurant dining consumer food trends delivery report`);
      } else if (cLower.includes("enrollment") || cLower.includes("tuition")) {
        queries.push(`${primaryGeo} education training enrollment demand tuition trends`);
      } else if (cLower.includes("property") || cLower.includes("real estate")) {
        queries.push(`${primaryGeo} real estate property price trends buyer demand report`);
      } else {
        queries.push(`${primaryGeo} ${coreInd} ${cat} market data report`);
      }
    }

    // Include general high-authority baseline query if under 5 queries
    if (queries.length < 5) {
      queries.push(`${primaryGeo} ${coreInd} industry market dynamics`);
    }

    return Array.from(new Set(queries)).slice(0, 6);
  }
}

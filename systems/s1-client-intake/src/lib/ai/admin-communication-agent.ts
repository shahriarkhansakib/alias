import { GoogleGenAI } from "@google/genai";
import { CommunicationSafetyGuard, SafetyEvaluationResult } from "@/lib/communication/safety-guard";
import { ScriptService, ScriptMatchResult } from "@/lib/communication/script-service";

export interface GeneratedCommunicationSuggestions {
  suggestions: {
    professional: string;
    friendly: string;
    detailed: string;
  };
  recommendedTone: "professional" | "friendly" | "detailed";
  confidenceScore: number;
  isAmbiguous: boolean;
  containsCommitment: boolean;
  missingContext: boolean;
  safetyEvaluation: SafetyEvaluationResult;
  provider: "gemini" | "fallback";
  providerModel: string;
  relevantScriptIds?: string[];
  matchedScriptTitles?: string[];
  scriptVersion?: number;
  noRelevantScriptFound: boolean;
  requiresAdminReview: boolean;
  intentCategory?: string;
  strategicObjective?: string;
}

export type ClientMessageCategory =
  | "BUSINESS_INTRO"
  | "BRAND_PRODUCT_INFO"
  | "MARKETING_STRATEGY"
  | "SOCIAL_MEDIA"
  | "PAID_ADS"
  | "BUDGET_PRICING"
  | "CONVERSION_SALES"
  | "TARGET_AUDIENCE"
  | "BRAND_POSITIONING"
  | "CAMPAIGN_PERFORMANCE"
  | "COMPETITOR_MARKET"
  | "CLIENT_OBJECTIONS"
  | "COMPLAINTS_DISSATISFACTION"
  | "GENERAL_BUSINESS"
  | "FOLLOWUP_STATUS"
  | "CASUAL_GREETING"
  | "UNCLEAR_INCOMPLETE"
  | "UNSUPPORTED_OFFICE_INQUIRY";

export type BusinessSector =
  | "SPORTS_APPAREL"
  | "B2B_SAAS"
  | "RESTAURANT"
  | "ECOMMERCE"
  | "CLOTHING_BRAND"
  | "SOFTWARE"
  | "EDUCATION"
  | "HEALTHCARE"
  | "REAL_ESTATE"
  | "DIGITAL_AGENCY"
  | "GENERAL_COMMERCIAL";

export interface IndustryProfile {
  sector: BusinessSector;
  sectorLabel: string;
  offeringNoun: string;
  targetPersonaNoun: string;
  conversionGoal: string;
  funnelBottlenecks: string;
  creativeFormats: string;
  kpiBenchmark: string;
}

interface ClientIntentAnalysis {
  category: ClientMessageCategory;
  categoryLabel: string;
  extractedBrand: string;
  extractedProduct: string;
  extractedBudget: string;
  extractedAudience: string;
  isConsultingInquiry: boolean;
  requiresHoldingReply: boolean;
  industryProfile: IndustryProfile;
}

export class AdminCommunicationAgent {
  // Cooldown tracker: prevent hammering Gemini after 429 quota exhaustion (5-min cooldown)
  private static lastQuotaExhaustedTimestamp = 0;
  private static readonly QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

  private static isGeminiConfigured(): boolean {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim().length > 0);
  }

  /**
   * Intelligently infers the commercial sector and strategic parameters
   * across diverse industries (B2B SaaS, Restaurants, Healthcare, Education, Real Estate,
   * Digital Agencies, Sports Apparel, Fashion/Clothing, Software, E-Commerce, etc.)
   */
  public static inferIndustryProfile(
    rawText: string,
    businessName: string,
    artifact1?: any
  ): IndustryProfile {
    const combined = `${businessName || ""} ${rawText || ""} ${artifact1?.client?.industry || ""} ${artifact1?.product_service?.name || ""} ${artifact1?.product_service?.category || ""}`.toLowerCase();

    // 1. B2B SaaS
    if (
      combined.includes("saas") ||
      combined.includes("cloud platform") ||
      combined.includes("crm") ||
      combined.includes("erp") ||
      combined.includes("mrr") ||
      combined.includes("arr") ||
      (combined.includes("b2b") && combined.includes("software")) ||
      combined.includes("subscription platform") ||
      combined.includes("workflow automation")
    ) {
      return {
        sector: "B2B_SAAS",
        sectorLabel: "B2B SaaS & Cloud Software",
        offeringNoun: "B2B SaaS platform and workflow automation solutions",
        targetPersonaNoun: "department heads, technical executives, and business decision-makers",
        conversionGoal: "qualified product demo bookings, trial sign-ups, and sales pipeline velocity",
        funnelBottlenecks: "demo form friction, pricing transparency, or lack of social proof / case studies",
        creativeFormats: "product walkthrough videos, interactive feature carousels, and founder thought-leadership clips",
        kpiBenchmark: "Cost Per Qualified Lead (CPQL), Customer Acquisition Cost (CAC), and LTV:CAC ratio",
      };
    }

    // 2. Restaurant & Hospitality
    if (
      combined.includes("restaurant") ||
      combined.includes("cafe") ||
      combined.includes("café") ||
      combined.includes("bistro") ||
      combined.includes("dining") ||
      combined.includes("dine-in") ||
      combined.includes("culinary") ||
      combined.includes("bakery") ||
      combined.includes("cloud kitchen") ||
      (combined.includes("food") && (combined.includes("order") || combined.includes("menu") || combined.includes("chef") || combined.includes("table") || combined.includes("taste")))
    ) {
      return {
        sector: "RESTAURANT",
        sectorLabel: "Restaurant & Hospitality (F&B)",
        offeringNoun: "culinary menu and dining experience",
        targetPersonaNoun: "local diners, food enthusiasts, and families",
        conversionGoal: "table reservations, dine-in foot traffic, and direct takeaway orders",
        funnelBottlenecks: "location discoverability, menu pricing visibility, or delivery radius friction",
        creativeFormats: "high-definition food preparation Reels, dining ambience clips, and geotargeted local promotions",
        kpiBenchmark: "Cost Per Table Reservation, local footfall uplift, and direct delivery order volume",
      };
    }

    // 3. Healthcare Business
    if (
      combined.includes("health") ||
      combined.includes("clinic") ||
      combined.includes("dental") ||
      combined.includes("doctor") ||
      combined.includes("medical") ||
      combined.includes("hospital") ||
      combined.includes("patient") ||
      combined.includes("therapy") ||
      combined.includes("physio") ||
      combined.includes("pharma") ||
      combined.includes("diagnostic") ||
      combined.includes("skincare")
    ) {
      return {
        sector: "HEALTHCARE",
        sectorLabel: "Healthcare & Medical Services",
        offeringNoun: "clinical medical services and specialized healthcare treatments",
        targetPersonaNoun: "patients seeking verified medical care, families, and health-conscious individuals",
        conversionGoal: "verified patient consultations, specialist bookings, and clinic appointments",
        funnelBottlenecks: "specialist credibility verification, consultation booking friction, or location ease",
        creativeFormats: "doctor video explainers, clinic facility walkthroughs, and patient educational carousels",
        kpiBenchmark: "Cost Per Booked Appointment, patient inquiry response time, and consultation show-up rate",
      };
    }

    // 4. Educational Institute
    if (
      combined.includes("education") ||
      combined.includes("institute") ||
      combined.includes("school") ||
      combined.includes("college") ||
      combined.includes("university") ||
      combined.includes("academy") ||
      combined.includes("course") ||
      combined.includes("admission") ||
      combined.includes("tuition") ||
      combined.includes("student") ||
      combined.includes("coaching") ||
      combined.includes("training center") ||
      combined.includes("bootcamp")
    ) {
      return {
        sector: "EDUCATION",
        sectorLabel: "Education & Academic Training",
        offeringNoun: "academic curriculums, certified courses, and training programs",
        targetPersonaNoun: "prospective students, career switchers, and parents",
        conversionGoal: "qualified admission inquiries, campus tour registrations, and course enrollments",
        funnelBottlenecks: "tuition fee transparency, admission requirement clarity, or curriculum outcome trust",
        creativeFormats: "alumni success story videos, faculty introduction clips, and curriculum overview carousels",
        kpiBenchmark: "Cost Per Enrolled Student, lead-to-enrollment rate, and cost per qualified inquiry",
      };
    }

    // 5. Real Estate
    if (
      combined.includes("real estate") ||
      combined.includes("property") ||
      combined.includes("apartment") ||
      combined.includes("housing") ||
      combined.includes("developer") ||
      combined.includes("plots") ||
      combined.includes("villa") ||
      combined.includes("commercial space") ||
      combined.includes("condo") ||
      combined.includes("duplex")
    ) {
      return {
        sector: "REAL_ESTATE",
        sectorLabel: "Real Estate & Property Development",
        offeringNoun: "residential developments, commercial properties, and real estate investments",
        targetPersonaNoun: "high-net-worth investors, prospective homeowners, and commercial tenants",
        conversionGoal: "high-intent investor inquiries, site visit appointments, and project brochure downloads",
        funnelBottlenecks: "financial commitment hesitation, legal trust verification, or slow sales follow-up",
        creativeFormats: "cinematic property walkthrough videos, 3D architectural renders, and investor ROI carousels",
        kpiBenchmark: "Cost Per Qualified Site Visit, lead-to-visit conversion rate, and investor acquisition efficiency",
      };
    }

    // 6. Digital Service Agency
    if (
      combined.includes("digital agency") ||
      combined.includes("marketing agency") ||
      combined.includes("design agency") ||
      combined.includes("consulting firm") ||
      combined.includes("creative studio") ||
      combined.includes("advertising agency") ||
      combined.includes("service agency") ||
      combined.includes("ui/ux studio") ||
      (combined.includes("agency") && (combined.includes("client") || combined.includes("services") || combined.includes("retainer")))
    ) {
      return {
        sector: "DIGITAL_AGENCY",
        sectorLabel: "Digital Service Agency & Consulting",
        offeringNoun: "creative consulting, performance marketing, and digital agency services",
        targetPersonaNoun: "business founders, CMOs, and marketing directors",
        conversionGoal: "high-ticket client discovery calls, retainer proposals, and strategic partnerships",
        funnelBottlenecks: "service scope ambiguity, portfolio depth, or transparent ROI methodology",
        creativeFormats: "client campaign case study breakdowns, creative process clips, and strategic framework carousels",
        kpiBenchmark: "Cost Per Discovery Call, proposal acceptance rate, and monthly client retainer value",
      };
    }

    // 7. Software Company
    if (
      combined.includes("software company") ||
      combined.includes("software development") ||
      combined.includes("dev shop") ||
      combined.includes("custom software") ||
      combined.includes("mobile app development") ||
      combined.includes("tech company") ||
      combined.includes("it solutions") ||
      combined.includes("web development company")
    ) {
      return {
        sector: "SOFTWARE",
        sectorLabel: "Software Engineering & IT Solutions",
        offeringNoun: "custom software engineering and enterprise digital solutions",
        targetPersonaNoun: "CTOs, product managers, and enterprise buyers",
        conversionGoal: "discovery call bookings, project scope inquiries, and enterprise contracts",
        funnelBottlenecks: "technical credibility proof, portfolio case studies, or proposal turnaround speed",
        creativeFormats: "technical case study breakdowns, engineering culture clips, and client testimonial videos",
        kpiBenchmark: "Cost Per Discovery Call, qualified proposal rate, and contract deal size",
      };
    }

    // 8. Sports Apparel
    if (
      combined.includes("jersey") ||
      combined.includes("sportswear") ||
      combined.includes("activewear") ||
      combined.includes("athletic") ||
      (combined.includes("sport") && combined.includes("apparel")) ||
      combined.includes("gym wear") ||
      combined.includes("fitness wear")
    ) {
      return {
        sector: "SPORTS_APPAREL",
        sectorLabel: "Sports Apparel & Athletic Gear",
        offeringNoun: "performance sportswear and athletic gear",
        targetPersonaNoun: "sports enthusiasts, athletes, and fitness-conscious consumers",
        conversionGoal: "direct online sales, sizing confidence, and repeat brand loyalty",
        funnelBottlenecks: "landing page mobile speed, checkout friction, sizing clarity, or cash-on-delivery trust",
        creativeFormats: "high-energy athlete try-on Reels, lifestyle video hooks, and dynamic product catalog carousels",
        kpiBenchmark: "Blended ROAS, Cost Per Purchase (CPP), and Cart Abandonment Rate",
      };
    }

    // 9. Clothing Brand / Fashion
    if (
      combined.includes("clothing") ||
      combined.includes("fashion") ||
      combined.includes("saree") ||
      combined.includes("panjabi") ||
      combined.includes("denim") ||
      combined.includes("boutique") ||
      combined.includes("apparel") ||
      combined.includes("dress") ||
      combined.includes("collection") ||
      combined.includes("outfit")
    ) {
      return {
        sector: "CLOTHING_BRAND",
        sectorLabel: "Clothing & Fashion Apparel",
        offeringNoun: "seasonal fashion collections and designer apparel",
        targetPersonaNoun: "fashion-forward shoppers, young professionals, and style enthusiasts",
        conversionGoal: "collection sell-through rates, lookbook engagement, and repeat customer retention",
        funnelBottlenecks: "fabric details presentation, fit guidance, styling trust, or checkout options",
        creativeFormats: "aesthetic lifestyle lookbook Reels, creator styling videos, and seasonal collection carousels",
        kpiBenchmark: "Return On Ad Spend (ROAS), Cost Per Acquisition (CPA), and repeat purchase frequency",
      };
    }

    // 10. E-Commerce & Retail
    if (
      combined.includes("ecommerce") ||
      combined.includes("e-commerce") ||
      combined.includes("online shop") ||
      combined.includes("marketplace") ||
      combined.includes("online store") ||
      combined.includes("retail") ||
      combined.includes("cart") ||
      combined.includes("shopify")
    ) {
      return {
        sector: "ECOMMERCE",
        sectorLabel: "E-Commerce & Digital Retail",
        offeringNoun: "online retail catalog and product selections",
        targetPersonaNoun: "digital shoppers and impulse buyers across key regional hubs",
        conversionGoal: "e-commerce order volume, cart completion rates, and average order value (AOV)",
        funnelBottlenecks: "landing page load speed, checkout friction, shipping costs, or payment trust signals",
        creativeFormats: "dynamic product catalog carousels, user-generated unboxing videos, and limited-time offer banners",
        kpiBenchmark: "Return On Ad Spend (ROAS), Cost Per Purchase, and cart-to-checkout conversion rate",
      };
    }

    // Default: General Commercial
    return {
      sector: "GENERAL_COMMERCIAL",
      sectorLabel: "Commercial Business",
      offeringNoun: "commercial products and service offerings",
      targetPersonaNoun: "prospective clients and high-intent buyers",
      conversionGoal: "qualified customer acquisition, revenue growth, and brand equity",
      funnelBottlenecks: "value proposition clarity, user journey friction, or purchase trust signals",
      creativeFormats: "compelling video hooks, value-driven educational carousels, and high-intent conversion ads",
      kpiBenchmark: "Customer Acquisition Cost (CAC), Return On Ad Spend (ROAS), and conversion efficiency",
    };
  }

  /**
   * Intelligently classifies client messages into 17 distinct business & marketing categories
   * and extracts key commercial parameters.
   */
  private static classifyClientMessage(
    rawInquiry: string,
    businessName: string,
    artifact1?: any
  ): ClientIntentAnalysis {
    const text = rawInquiry.trim();
    const lower = text.toLowerCase();

    // Extract brand name from message or parameters
    let extractedBrand = "";
    if (businessName && businessName.trim() && !businessName.toLowerCase().includes("new marketing campaign")) {
      extractedBrand = businessName.trim();
    } else if (text.includes("(") && text.includes(")")) {
      const match = text.match(/^([^(]+)\(([^)]+)\)/);
      if (match) extractedBrand = match[1].trim();
    }
    if (!extractedBrand && artifact1?.client?.company_name) {
      extractedBrand = artifact1.client.company_name.trim();
    }

    // Extract product category
    let extractedProduct = artifact1?.product_service?.name?.trim() || "";
    if (!extractedProduct && text.includes("(") && text.includes(")")) {
      const match = text.match(/\(([^)]+)\)/);
      if (match) extractedProduct = match[1].trim();
    }

    // Extract budget
    let extractedBudget = "";
    const budgetMatch = text.match(/(\d+[\d,]*\s*(?:bdt|tk|taka|k))/i);
    if (budgetMatch) extractedBudget = budgetMatch[0].trim();

    // Extract audience / location
    let extractedAudience = "";
    if (lower.includes("dhaka") && lower.includes("chittagong")) {
      extractedAudience = "Dhaka and Chittagong metro regions";
    } else if (lower.includes("dhaka")) {
      extractedAudience = "Dhaka metro area";
    } else if (lower.includes("nationwide") || lower.includes("all over bangladesh")) {
      extractedAudience = "nationwide delivery across Bangladesh";
    }

    const industryProfile = this.inferIndustryProfile(text, businessName, artifact1);

    const buildResult = (
      category: ClientMessageCategory,
      categoryLabel: string,
      isConsultingInquiry = true,
      requiresHoldingReply = false
    ): ClientIntentAnalysis => ({
      category,
      categoryLabel,
      extractedBrand,
      extractedProduct,
      extractedBudget,
      extractedAudience,
      isConsultingInquiry,
      requiresHoldingReply,
      industryProfile,
    });

    // 1. Unsupported physical office / facility inquiry (Requires strict holding statement)
    if (
      lower.includes("office") ||
      lower.includes("branch") ||
      lower.includes("physical location") ||
      lower.includes("address") ||
      (lower.includes("located") && (lower.includes("where") || lower.includes("port")))
    ) {
      return buildResult("UNSUPPORTED_OFFICE_INQUIRY", "Physical Office / Facility Inquiry", false, true);
    }

    // 2. Complaints and Dissatisfaction
    if (
      lower.includes("unhappy") ||
      lower.includes("disappointed") ||
      lower.includes("taking too long") ||
      lower.includes("waste of time") ||
      lower.includes("complaint") ||
      lower.includes("bad service") ||
      lower.includes("poor communication")
    ) {
      return buildResult("COMPLAINTS_DISSATISFACTION", "Complaint & Dissatisfaction", true, false);
    }

    // 3. Client Objections
    if (
      lower.includes("didn't work") ||
      lower.includes("did not work") ||
      lower.includes("too expensive") ||
      lower.includes("waste of money") ||
      lower.includes("skeptical") ||
      lower.includes("too risky") ||
      lower.includes("not sure if ads") ||
      lower.includes("agency before") ||
      lower.includes("marketing agency") ||
      lower.includes("another agency") ||
      lower.includes("previous agency") ||
      lower.includes("irrelevant") ||
      lower.includes("low-quality leads") ||
      lower.includes("low quality leads")
    ) {
      return buildResult("CLIENT_OBJECTIONS", "Client Objection & Skepticism", true, false);
    }

    // 4. Sales & Conversion Problems
    if (
      ((lower.includes("click") || lower.includes("visitor") || lower.includes("traffic") || lower.includes("browse")) &&
        (
          lower.includes("no sale") ||
          lower.includes("no order") ||
          lower.includes("not buying") ||
          lower.includes("nobody is buying") ||
          lower.includes("no one is buying") ||
          lower.includes("no one is placing") ||
          lower.includes("not placing orders") ||
          lower.includes("not getting orders") ||
          lower.includes("not getting sales") ||
          lower.includes("sales are low") ||
          lower.includes("zero sales") ||
          lower.includes("no conversion") ||
          lower.includes("nobody buying")
        )) ||
      lower.includes("conversion rate") ||
      lower.includes("high bounce") ||
      lower.includes("cart abandonment") ||
      lower.includes("traffic but no") ||
      lower.includes("drop-off")
    ) {
      return buildResult("CONVERSION_SALES", "Conversion & Sales Funnel Optimization", true, false);
    }

    // 5. Follow-up and Status Requests
    if (
      lower.includes("when will") ||
      lower.includes("when can we launch") ||
      lower.includes("launch date") ||
      lower.includes("next step") ||
      lower.includes("status of") ||
      lower.includes("ready to start") ||
      lower.includes("how long will it take to launch")
    ) {
      return buildResult("FOLLOWUP_STATUS", "Launch Timeline & Next Steps", true, false);
    }

    // 6. Campaign Performance & Metrics
    if (
      lower.includes("roas") ||
      lower.includes("ctr") ||
      lower.includes("cpa") ||
      lower.includes("cost per acquisition") ||
      lower.includes("benchmark") ||
      lower.includes("kpi") ||
      lower.includes("how do we evaluate performance")
    ) {
      return buildResult("CAMPAIGN_PERFORMANCE", "Campaign Performance & KPIs", true, false);
    }

    // 7. Budget & Pricing Questions
    if (
      lower.includes("pricing") ||
      lower.includes("fee") ||
      lower.includes("package") ||
      lower.includes("how much do you charge") ||
      lower.includes("management cost") ||
      (lower.includes("how much") && (lower.includes("budget") || lower.includes("spend"))) ||
      lower.includes("bdt") ||
      lower.includes("taka")
    ) {
      return buildResult("BUDGET_PRICING", "Budgeting & Pricing Policy", true, false);
    }

    // 8. Advertising & Paid Campaigns (Meta, Google, Creative Formats)
    if (
      lower.includes("meta") ||
      lower.includes("facebook") ||
      lower.includes("google") ||
      lower.includes("ad banner") ||
      lower.includes("video ad") ||
      lower.includes("reels") ||
      lower.includes("pixel") ||
      lower.includes("paid ad") ||
      lower.includes("adset") ||
      lower.includes("campaign structure")
    ) {
      return buildResult("PAID_ADS", "Paid Advertising & Creative Strategy", true, false);
    }

    // 9. Social Media Marketing & Organic Growth
    if (
      lower.includes("social media") ||
      lower.includes("instagram") ||
      lower.includes("tiktok") ||
      lower.includes("organic") ||
      lower.includes("followers") ||
      lower.includes("content calendar") ||
      lower.includes("influencer")
    ) {
      return buildResult("SOCIAL_MEDIA", "Social Media & Content Strategy", true, false);
    }

    // 10. Target Audience & Market Segmentation
    if (
      lower.includes("dhaka") ||
      lower.includes("chittagong") ||
      lower.includes("nationwide") ||
      lower.includes("target audience") ||
      lower.includes("demographic") ||
      lower.includes("customer profile") ||
      lower.includes("persona") ||
      lower.includes("who should we target")
    ) {
      return buildResult("TARGET_AUDIENCE", "Target Audience & Segmentation", true, false);
    }

    // 11. Branding & Positioning
    if (
      lower.includes("positioning") ||
      lower.includes("premium") ||
      lower.includes("luxury") ||
      lower.includes("brand voice") ||
      lower.includes("usp") ||
      lower.includes("unique selling proposition") ||
      lower.includes("brand identity")
    ) {
      return buildResult("BRAND_POSITIONING", "Branding & Market Positioning", true, false);
    }

    // 12. Competitor & Market Questions
    if (
      lower.includes("competitor") ||
      lower.includes("competition") ||
      lower.includes("market share") ||
      lower.includes("other brands") ||
      lower.includes("market saturated")
    ) {
      return buildResult("COMPETITOR_MARKET", "Competitor & Market Dynamics", true, false);
    }

    // 13. Marketing Strategy Questions
    if (
      lower.includes("strategy") ||
      lower.includes("plan") ||
      lower.includes("approach") ||
      lower.includes("how should we") ||
      lower.includes("what do you recommend") ||
      lower.includes("consulting")
    ) {
      return buildResult("MARKETING_STRATEGY", "Marketing Strategy & Frameworks", true, false);
    }

    // 14. Casual Greetings
    if (
      lower === "hi" ||
      lower === "hello" ||
      lower === "hey" ||
      lower.startsWith("hi ") ||
      lower.startsWith("hello ") ||
      lower.includes("good morning") ||
      lower.includes("good afternoon") ||
      lower.includes("assalamu alaikum") ||
      lower.includes("সালাম") ||
      lower.includes("হ্যালো")
    ) {
      return buildResult("CASUAL_GREETING", "Client Greeting & Rapport", false, false);
    }

    // 15. Business Introduction
    if (
      (text.includes("(") && text.includes(")")) ||
      lower.includes("we are a") ||
      lower.includes("we are an") ||
      lower.includes("we are based") ||
      lower.includes("we are launching") ||
      lower.includes("we are starting") ||
      lower.includes("we operate") ||
      lower.includes("we provide") ||
      lower.includes("we run") ||
      lower.includes("my brand") ||
      lower.includes("our brand") ||
      lower.includes("our business") ||
      lower.includes("i run") ||
      lower.includes("we sell") ||
      Boolean(extractedBrand && !lower.includes("?") && text.split(" ").length <= 8)
    ) {
      return buildResult("BUSINESS_INTRO", "Business & Brand Intake", true, false);
    }

    // 16. General Business Questions (E-commerce operations, delivery, payment)
    if (
      lower.includes("delivery") ||
      lower.includes("cash on delivery") ||
      lower.includes("cod") ||
      lower.includes("courier") ||
      lower.includes("shipping") ||
      lower.includes("inventory") ||
      lower.includes("wholesale")
    ) {
      return buildResult("GENERAL_BUSINESS", "Commercial & Operations Advisory", true, false);
    }

    // 17. Unclear or Incomplete Requests
    if (text.split(" ").length <= 2 && !extractedBrand && !lower.includes("?")) {
      return buildResult("UNCLEAR_INCOMPLETE", "Clarification Needed", false, false);
    }

    // Default to general strategic inquiry
    return buildResult("MARKETING_STRATEGY", "Strategic Advisory", true, false);
  }

  /**
   * Generates 3 senior-consultant-grade suggested replies (Professional, Friendly, Detailed)
   * embodying 10+ years of digital marketing agency leadership and strategic expertise.
   */
  static async generateSuggestions(params: {
    clientMessage: string;
    clientName: string;
    businessName: string;
    recentMessages: { sender: string; content: string }[];
    artifact1?: any;
    artifact2?: any;
    masterBriefMarkdown?: string;
  }): Promise<GeneratedCommunicationSuggestions> {
    const {
      clientMessage,
      clientName,
      businessName,
      recentMessages,
      artifact1,
      artifact2,
      masterBriefMarkdown,
    } = params;

    const rawInquiry = (clientMessage || "").trim();
    const clientGreeting = clientName ? clientName.trim() : "there";

    // 1. Classify client intent across 17 categories and infer industry commercial profile
    const intent = this.classifyClientMessage(rawInquiry, businessName, artifact1);
    const profile = intent.industryProfile;
    const brandName = intent.extractedBrand || businessName || "your brand";
    const productName = intent.extractedProduct || artifact1?.product_service?.name?.trim() || "";
    const objectiveStr = artifact1?.campaign?.objective || "drive measurable revenue and brand equity";

    const hasRawBudget = Boolean(artifact1?.budget?.amount);
    const budgetAmountStr = hasRawBudget
      ? `${artifact1.budget.amount} ${artifact1.budget.currency || "BDT"}`
      : intent.extractedBudget || null;
    const budgetPhrase = budgetAmountStr ? `your ${budgetAmountStr} budget` : "your allocated advertising budget";

    const hasRawDuration = Boolean(artifact1?.timeline?.duration);
    const durationStr = hasRawDuration ? artifact1.timeline.duration : null;
    const durationPhrase = durationStr ? `the ${durationStr} timeframe` : "the planned campaign timeline";

    // 2. Script knowledge base lookup (for approved agency FAQs like pricing, packages, core services)
    const scriptMatch: ScriptMatchResult = await ScriptService.findRelevantScripts(
      rawInquiry,
      brandName,
      artifact1
    );

    let fallbackProfessional: string;
    let fallbackFriendly: string;
    let fallbackDetailed: string;
    let baseConfidence = scriptMatch.confidenceScore || 0.92;
    let noRelevantScriptFound = scriptMatch.noRelevantScriptFound;
    let requiresAdminReview = false;
    const isScriptMatch = !noRelevantScriptFound && Boolean(scriptMatch.bestMatch);

    // A. Unsupported Physical Office / Facility Inquiry (Strict safety compliance)
    if (intent.category === "UNSUPPORTED_OFFICE_INQUIRY") {
      noRelevantScriptFound = true;
      requiresAdminReview = true;
      baseConfidence = 0.5;
      const forBrandPhrase = brandName ? `for ${brandName}` : "for your brand";
      fallbackProfessional = `Hello ${clientGreeting}, thank you for reaching out regarding ${forBrandPhrase}. We have received your inquiry and our team is currently verifying the specific details to ensure complete operational accuracy. An account strategist will follow up with verified confirmation shortly.`;
      fallbackFriendly = `Hi ${clientGreeting}! Thanks for getting in touch! We want to make sure we give you the most accurate answer, so our team is double-checking the exact details for you right now. We'll be right back with an update! 😊`;
      fallbackDetailed = `Hello ${clientGreeting}, regarding your inquiry: our account team has logged this request for verification against our current operational guidelines. We do not provide unverified commitments, and an account representative will review and deliver a comprehensive response shortly.`;
    }
    // B. Strategic Consulting Inquiries & Client Engagement
    // Always handled by Senior Marketing Consultant Intent Engine (not raw static scripts)
    else if (
      intent.isConsultingInquiry ||
      intent.category === "BUSINESS_INTRO" ||
      intent.category === "CASUAL_GREETING" ||
      intent.category === "UNCLEAR_INCOMPLETE" ||
      intent.category === "FOLLOWUP_STATUS"
    ) {
      noRelevantScriptFound = false;
      requiresAdminReview = false;
      baseConfidence = 0.94;

      switch (intent.category) {
        case "BUSINESS_INTRO": {
          const productContext = intent.extractedProduct ? ` focused on ${intent.extractedProduct}` : "";
          fallbackProfessional = `Thank you for sharing your brand details, ${brandName}. For a high-impact digital campaign scaling your ${profile.offeringNoun}, our first priority is establishing strong product-market resonance. What is your primary commercial objective for this rollout: accelerating ${profile.conversionGoal} or rapid brand awareness?`;
          fallbackFriendly = `Welcome aboard, ${clientGreeting}! We're thrilled to partner with ${brandName}${productContext}. What are your standout ${profile.offeringNoun} that you'd love to highlight first for ${profile.targetPersonaNoun}?`;
          fallbackDetailed = `Received your brand introduction for ${brandName}${productContext}. For growth-stage brands, we deploy a full-funnel approach: Top of Funnel testing creative angles on Meta/Google targeting ${profile.targetPersonaNoun}, paired with Bottom of Funnel conversion retargeting to maximize ${profile.conversionGoal}. What are your core target demographics and existing channels across Bangladesh?`;
          break;
        }

        case "CONVERSION_SALES": {
          fallbackProfessional = `Analyzing conversion drop-offs requires evaluating the full customer journey. If ad clicks are healthy but completions lag for ${brandName}, the friction typically stems from ${profile.funnelBottlenecks}. Could you share your current bounce rate or primary traffic sources so we can audit the funnel?`;
          fallbackFriendly = `We completely understand the frustration when ad traffic isn't translating into results, ${clientGreeting}. Usually, the issue lies in ${profile.funnelBottlenecks} rather than the ads themselves. Are most visitors browsing on mobile, and do you offer frictionless payment or checkout options?`;
          fallbackDetailed = `Diagnosing a conversion bottleneck for ${brandName} involves a structured 3-point audit: 1) Value Proposition & Offer (pricing clarity and transparent terms), 2) Technical User Experience (mobile responsiveness and checkout steps), and 3) Audience-Creative Alignment (ensuring ad hooks match page messaging). To diagnose accurately, could you share your current conversion rate and main drop-off step?`;
          break;
        }

        case "PAID_ADS": {
          fallbackProfessional = `When structuring paid digital campaigns for ${brandName}, our framework separates creative testing from budget scaling. We allocate 20% of ad spend toward testing diverse formats—${profile.creativeFormats}—before scaling winning assets. What creative assets or product media do you currently have available?`;
          fallbackFriendly = `Great question on advertising formats! For ${brandName}, short-form video and Reels consistently drive the lowest cost-per-click and highest engagement on Meta, while carousels work wonders for highlighting ${profile.offeringNoun}. Do you already have video assets, or are we producing them fresh?`;
          fallbackDetailed = `Our performance advertising framework for ${brandName} deploys dynamic creative testing paired with server-side Conversion API (CAPI) tracking. Formats like ${profile.creativeFormats} excel at Top-of-Funnel prospecting, whereas dynamic retargeting carousels dominate Middle and Bottom-of-Funnel closing to drive ${profile.conversionGoal}. What is your current pixel tracking readiness and monthly ad spend allocation?`;
          break;
        }

        case "SOCIAL_MEDIA": {
          fallbackProfessional = `Organic social media and paid acquisition perform best as a synchronized flywheel. Organic content builds community credibility and social proof, while paid campaigns scale predictable customer acquisition for ${profile.targetPersonaNoun}. What is your current organic posting cadence, and which platform generates your most engaged audience?`;
          fallbackFriendly = `Social media growth is all about consistent storytelling and community engagement! For ${brandName}, focusing on relatable behind-the-scenes content and user-generated videos will build strong brand affinity. Which platform do you feel your ideal clients spend the most time on right now?`;
          fallbackDetailed = `To scale social media for ${brandName}, we recommend a 70/20/10 content framework: 70% value and educational content showcasing ${profile.offeringNoun}, 20% social proof and client testimonials, and 10% direct conversion offers driving ${profile.conversionGoal}. This builds a warm retargeting pool for paid ad sets. Would you like our team to provide a structured weekly content calendar?`;
          break;
        }

        case "BUDGET_PRICING": {
          fallbackProfessional = `Ad budget allocation should be calibrated directly against target Customer Acquisition Cost (CAC) and ${profile.kpiBenchmark}. For initial testing, we recommend allocating enough daily spend to generate 30–50 conversion events per week, enabling the algorithm to exit the learning phase efficiently. What is your estimated average customer value or order size?`;
          fallbackFriendly = `Budgeting is all about efficiency and testing smartly, ${clientGreeting}! We want every Taka to pull its weight. With a structured testing phase, we can validate winning audiences without risking unnecessary spend. What total monthly budget range feels comfortable for your brand?`;
          fallbackDetailed = `Our budget architecture operates in two phases: Phase 1 (Baseline Testing) allocates approximately 20–25% of ${budgetPhrase} across interest and lookalike ad sets to establish benchmark CPA. Phase 2 scales budget strictly into validated ad sets achieving target ROAS and ${profile.kpiBenchmark}. What is your target cost per acquisition or breakeven return on ad spend?`;
          break;
        }

        case "TARGET_AUDIENCE": {
          const audienceContext = intent.extractedAudience || "your key regions";
          fallbackProfessional = `Audience segmentation for ${brandName} should balance purchasing power with regional delivery logistics. Concentrating initial ad spend on high-density urban hubs (${audienceContext}) allows us to optimize fulfillment and repeat purchase rates before expanding nationwide. What age and interest profiles represent your highest-value customers?`;
          fallbackFriendly = `Targeting the right crowd is half the battle won, ${clientGreeting}! Focus in ${audienceContext} gives us a concentrated pool of high-intent buyers for your ${profile.offeringNoun}. Are your core buyers primarily young professionals, students, or families?`;
          fallbackDetailed = `Applying our Segmentation, Targeting, and Positioning (STP) model: we develop 3 core audience cohorts for ${brandName}: 1) High-Intent Direct Interests, 2) Broad Demographic with Algorithmic Advantage, and 3) Custom Engagement Lookalikes. Focusing first on ${audienceContext} minimizes logistics friction. Do you currently have existing customer phone or email lists for custom audience matching?`;
          break;
        }

        case "BRAND_POSITIONING": {
          fallbackProfessional = `Brand positioning in a competitive digital landscape requires carving out a defensible Unique Selling Proposition (USP). Rather than competing solely on price, we focus on establishing emotional resonance, service quality guarantees, and superior client trust for ${brandName}. What do your best customers praise most about your ${profile.offeringNoun}?`;
          fallbackFriendly = `Positioning is what turns one-time inquiries into lifelong brand advocates! For ${brandName}, we want your audience to recognize your unique voice instantly. What makes your offering genuinely stand out from other alternatives in the market?`;
          fallbackDetailed = `Strategic positioning dictates campaign creative direction and messaging architecture. We define a brand matrix across 4 pillars: Functional Benefit, Emotional Hook, Category Differentiation, and Reason to Believe. For ${brandName}, emphasizing these pillars in ad copy prevents commoditization and supports healthy profit margins. What is your primary brand promise to clients?`;
          break;
        }

        case "CAMPAIGN_PERFORMANCE": {
          fallbackProfessional = `Campaign performance metrics must be interpreted through a full-funnel lens. Click-Through Rate (CTR) and Cost Per Click (CPC) measure creative resonance, while Conversion Rate (CVR) and ${profile.kpiBenchmark} measure commercial viability. For digital acquisition in Bangladesh, a healthy link CTR benchmarks between 1.5% and 2.5%. How are your current metrics trending?`;
          fallbackFriendly = `Keeping a close eye on campaign metrics is crucial, ${clientGreeting}! We look beyond vanity metrics like impressions and focus squarely on ${profile.kpiBenchmark} and real revenue generated. What key metric matters most to your team this month?`;
          fallbackDetailed = `We evaluate campaign efficiency using a tiered KPI dashboard: Tier 1 (Commercial North Star: ${profile.kpiBenchmark}), Tier 2 (Funnel Health: Cost Per Lead/Booking and Landing Page Conversion Rate), and Tier 3 (Creative Engagement: Thumbstop Rate and Hook Retention). We conduct bi-weekly metric reviews to reallocate spend to top performers. What are your specific performance targets?`;
          break;
        }

        case "COMPETITOR_MARKET": {
          fallbackProfessional = `When navigating a crowded market or price-cutting competitors, engaging in a price war is rarely sustainable. Our strategic counsel for ${brandName} is to focus on value stacking—curated packages, verified credibility guarantees, faster turnaround, and superior creative storytelling. What are your competitors doing that you feel we should counter?`;
          fallbackFriendly = `Competition is actually proof of healthy market demand, ${clientGreeting}! While competitors focus on aggressive discounts, we can win on brand trust, relatable creator content, and seamless client experience for ${brandName}. How would you like to differentiate your brand narrative?`;
          fallbackDetailed = `Our competitive strategy framework involves identifying market whitespace in creative messaging and audience targeting. Where competitors rely on static generic banners, we deploy authentic client transformation stories and social proof to capture higher customer lifetime value (LTV). What specific competitor tactics are you observing in your sector?`;
          break;
        }

        case "CLIENT_OBJECTIONS": {
          fallbackProfessional = `We understand your past reservations regarding digital advertising. In over a decade of marketing strategy, we've found that failed campaigns almost always trace back to three fixable flaws: lack of disciplined creative testing, inaccurate pixel tracking, or prematurely scaling unvalidated ad sets. Our phased methodology is specifically designed to de-risk your investment before scaling spend.`;
          fallbackFriendly = `Your concerns make complete sense, ${clientGreeting}. It's frustrating to invest in ads without seeing a return. That's exactly why we don't gamble with your budget—we test small, validate what converts, and only scale when the numbers prove profitable. What was the biggest issue you faced with past campaigns?`;
          fallbackDetailed = `To address past marketing inefficiencies, we enforce strict risk-mitigation guardrails for ${brandName}: Phase 1 caps risk by using small testing budgets to validate offer resonance for ${profile.offeringNoun}. If an ad set fails to achieve target cost-per-lead within 72 hours, it is paused automatically. Would you like to review our risk-controlled testing protocol?`;
          break;
        }

        case "COMPLAINTS_DISSATISFACTION": {
          fallbackProfessional = `We take your feedback seriously and sincerely appreciate your candor, ${clientGreeting}. Ensuring a smooth, transparent consulting partnership for ${brandName} is our top priority. Let us immediately address your concern and realign on the exact next steps to keep your project moving forward without delay.`;
          fallbackFriendly = `Thank you for being open with us, ${clientGreeting}. We're genuinely sorry that this hasn't met your expectations, and we want to make it right immediately. Let's resolve this together right now—what is the most critical item you'd like us to address first?`;
          fallbackDetailed = `We appreciate your direct feedback regarding our process. As your strategic agency partners, accountability is paramount. I am reviewing the current timeline and milestones for ${brandName} right now to eliminate any bottlenecks and ensure you receive clear, actionable progress updates. Let's schedule a brief sync to finalize your immediate priorities.`;
          break;
        }

        case "FOLLOWUP_STATUS": {
          fallbackProfessional = `Hello ${clientGreeting}, regarding the launch timeline for ${brandName}: our technical team is finalizing audience segmentation and creative assets for ${profile.offeringNoun}. Once tracking pixels and event triggers are verified, we will proceed with the phased rollout according to your approved schedule. What launch date is your team working toward?`;
          fallbackFriendly = `Hi ${clientGreeting}! Thanks for following up on ${brandName}! We're making great progress on your campaign setup and want to ensure everything is dialed in for maximum impact. What specific milestone would you like an update on today?`;
          fallbackDetailed = `Hello ${clientGreeting}, here is your current status update for ${brandName}: Audience parameter mapping and creative testing setups are progressing on track to drive ${profile.conversionGoal}. Before turning on live traffic, we run a pre-flight QA checklist to ensure event tracking and conversion funnels are 100% operational. Are you available for a brief sign-off call prior to launch?`;
          break;
        }

        case "CASUAL_GREETING": {
          fallbackProfessional = `Hello ${clientGreeting}, thank you for connecting with ALIAS Marketing. We are ready to assist you in planning and scaling your marketing initiatives for ${brandName}. What strategic area would you like to focus on today?`;
          fallbackFriendly = `Hi ${clientGreeting}! Great to hear from you today! We're excited to collaborate with ${brandName}. How can our marketing team help you take the next step forward? 😊`;
          fallbackDetailed = `Hello ${clientGreeting}, welcome to ALIAS Marketing. As your strategic digital agency, we are aligned to help ${brandName} achieve sustainable revenue growth through targeted Meta and Google campaigns driving ${profile.conversionGoal}. To get started, tell us about your primary marketing goal for this quarter.`;
          break;
        }

        case "UNCLEAR_INCOMPLETE": {
          fallbackProfessional = `Thank you for reaching out, ${clientGreeting}. To ensure our marketing team provides the most relevant strategic guidance for ${brandName}, could you provide a bit more context regarding your specific question or campaign objective?`;
          fallbackFriendly = `Hi ${clientGreeting}! We'd love to help, but could you tell us a little more about what you have in mind for ${brandName}? We're ready to dive in!`;
          fallbackDetailed = `Hello ${clientGreeting}, to give you accurate marketing recommendations tailored to ${brandName}, could you clarify what specific channel, budget, or campaign question you would like our consulting team to analyze?`;
          break;
        }

        default: {
          fallbackProfessional = `Thank you for your inquiry, ${clientGreeting}. Regarding your marketing campaign for ${brandName}: our priority is ensuring every marketing dollar translates into measurable ${profile.conversionGoal}. Could you clarify your primary goal for this initiative?`;
          fallbackFriendly = `Thanks for reaching out! We're here to help make ${brandName}'s marketing campaign a genuine success for your ${profile.offeringNoun}. What specific questions or goals can we focus on first?`;
          fallbackDetailed = `Thank you for reaching out regarding ${brandName}. In our campaign intake framework, we ensure full alignment on creative assets, target demographics, and conversion tracking before launching live traffic to maximize ${profile.conversionGoal}. What aspect of the campaign would you like to explore next?`;
          break;
        }
      }
    }
    // C. Approved Agency Operational FAQ Match (Pricing policy, official legal terms, packages list)
    else if (!noRelevantScriptFound && scriptMatch.bestMatch) {
      const approvedText = scriptMatch.bestMatch.content;
      fallbackProfessional = `Hello ${clientGreeting}, regarding your inquiry for ${brandName}: ${approvedText}`;
      fallbackFriendly = `Hi ${clientGreeting}! Thanks for reaching out about ${brandName}! ${approvedText} 😊`;
      fallbackDetailed = `Hello ${clientGreeting}, in response to your question regarding ${productName || brandName}: ${approvedText} Our account team remains aligned with your objective to ${objectiveStr} within ${budgetPhrase} over ${durationPhrase}.`;
      baseConfidence = 0.95;
      noRelevantScriptFound = false;
    } else {
      fallbackProfessional = `Thank you for reaching out, ${clientGreeting}. Regarding ${brandName}: how can our marketing consulting team best support your campaign objectives today?`;
      fallbackFriendly = `Hi ${clientGreeting}! We're thrilled to assist ${brandName}. What can we help you achieve with your marketing today?`;
      fallbackDetailed = `Hello ${clientGreeting}, our marketing team is standing by to assist ${brandName}. Could you share your primary business objective or campaign target so we can provide actionable recommendations?`;
      baseConfidence = 0.88;
    }

    const relevantScriptIds = scriptMatch.matchedScripts.map((s) => s._id.toString());
    const matchedScriptTitles = scriptMatch.matchedScripts.map((s) => s.title);
    const scriptVersion = scriptMatch.bestMatch?.version || 1;

    const fallbackResponse: GeneratedCommunicationSuggestions = {
      suggestions: {
        professional: fallbackProfessional,
        friendly: fallbackFriendly,
        detailed: fallbackDetailed,
      },
      recommendedTone: "professional",
      confidenceScore: baseConfidence,
      isAmbiguous: false,
      containsCommitment: false,
      missingContext: false,
      safetyEvaluation: { passed: true, flags: [], reasons: [] },
      provider: "fallback",
      providerModel: "senior-consultant-engine",
      relevantScriptIds,
      matchedScriptTitles,
      scriptVersion,
      noRelevantScriptFound,
      requiresAdminReview,
      intentCategory: intent.categoryLabel,
    };

    // If Gemini is not configured, return senior-consultant fallback immediately
    if (!this.isGeminiConfigured()) {
      const safety = CommunicationSafetyGuard.evaluate(fallbackResponse.suggestions.professional, {
        confidenceScore: fallbackResponse.confidenceScore,
      });
      return { ...fallbackResponse, safetyEvaluation: safety };
    }

    // Check rate-limit cooldown
    const now = Date.now();
    if (now - this.lastQuotaExhaustedTimestamp < this.QUOTA_COOLDOWN_MS) {
      const safety = CommunicationSafetyGuard.evaluate(fallbackResponse.suggestions.professional, {
        confidenceScore: fallbackResponse.confidenceScore,
      });
      return { ...fallbackResponse, safetyEvaluation: safety };
    }

    const apiKey = process.env.GEMINI_API_KEY!.trim();
    const ai = new GoogleGenAI({ apiKey });

    // Active candidate models in preference order
    const candidateModels: string[] = [
      process.env.GEMINI_MODEL || "gemini-2.5-flash",
      process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-1.5-pro",
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    const approvedScriptsSummary = scriptMatch.matchedScripts.map((s) => ({
      title: s.title,
      category: s.category,
      approvedContent: s.content,
    }));

    const systemPrompt = `You are an elite Senior Marketing Consultant and Strategy Director at ALIAS, an autonomous AI Marketing Agency, with 10+ years of hands-on experience in business consulting, digital acquisition, and client relationship management.

YOUR IDENTITY & VOICE:
- You communicate with deep commercial awareness, strategic rigor, analytical thinking, and genuine client empathy.
- You NEVER sound like a generic chatbot, junior support rep, or scripted salesperson.
- You directly address the client's actual message with concise, high-value consulting insights.
- You match your response length to the complexity of the client's inquiry—never give a 4-paragraph lecture for a simple question.
- You ask intelligent, high-leverage follow-up questions to uncover the client's true business objectives.

CROSS-INDUSTRY STRATEGIC AGILITY:
You serve diverse clients across industries including B2B SaaS, Restaurants & Hospitality, Healthcare & Medical, Educational Institutes, Real Estate, Digital Service Agencies, Sports Apparel, Fashion/Clothing, Custom Software, and E-Commerce Retail.
Always tailor your advice, metrics, conversion goals, and terminology to the client's specific sector and business model. Never assume every business is an e-commerce clothing store.

INTENT ANALYSIS & EXPERTISE:
Analyze the client message across the relevant category:
[Business Intro, Product Info, Marketing Strategy, Social Media, Paid Ads, Budget/Pricing, Conversion/Sales, Target Audience, Brand Positioning, Campaign Performance, Competitor Dynamics, Objections, Complaints, General Business/Ops, Follow-up/Status, Casual Greeting, Clarification].
Apply proven marketing principles (STP, Funnel optimization, ROAS/CPA/CAC, Creative testing) only when they genuinely add value.

STRICT BUSINESS SAFETY & INTEGRITY:
- NEVER invent agency services that do not exist, unverified prices, or unauthorized discounts.
- NEVER guarantee sales growth, ROAS figures, lead counts, or campaign outcomes.
- NEVER claim that something has been verified, completed, approved, or logged unless there is verified evidence.
- If information is unavailable or unconfirmed, communicate honestly and seek the necessary scope.

OUTPUT FORMAT:
Generate valid JSON containing THREE distinct, consultant-grade suggested replies for the Human Admin:
1. "professional": Senior consultant's concise, strategic, executive business response.
2. "friendly": Approachable, warm, encouraging response maintaining senior expertise.
3. "detailed": Comprehensive consulting response including strategic analysis, practical recommendations, and an intelligent next step.`;

    const promptContext = {
      client: {
        name: clientGreeting,
        business: brandName,
        industrySector: profile.sectorLabel,
        commercialOffering: profile.offeringNoun,
        targetPersona: profile.targetPersonaNoun,
        primaryConversionGoal: profile.conversionGoal,
        recommendedBenchmarks: profile.kpiBenchmark,
      },
      detectedIntent: {
        category: intent.category,
        label: intent.categoryLabel,
      },
      confirmedFacts: {
        product: productName || undefined,
        objective: objectiveStr || undefined,
        budget: budgetAmountStr || undefined,
        timeline: durationStr || undefined,
        targetAudience: intent.extractedAudience || undefined,
      },
      approvedKnowledgeBaseScripts: approvedScriptsSummary,
      recentThreadHistory: recentMessages.slice(-8).map((m) => `${m.sender.toUpperCase()}: ${m.content}`),
      incomingInquiryToReplyTo: rawInquiry,
    };

    const userContent = `Analyze the client message in the context of the conversation history, confirmed campaign facts, and approved scripts. Return valid JSON:
{
  "suggestions": {
    "professional": "string",
    "friendly": "string",
    "detailed": "string"
  },
  "recommendedTone": "professional" | "friendly" | "detailed",
  "confidenceScore": number (0.0 to 1.0),
  "isAmbiguous": boolean,
  "containsCommitment": boolean,
  "missingContext": boolean,
  "requiresAdminReview": boolean,
  "reasoning": "brief explanation"
}

CONTEXT:
${JSON.stringify(promptContext, null, 2)}`;

    for (const model of candidateModels) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after 12s on model ${model}`)), 12000)
        );

        const genPromise = ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            temperature: 0.3,
          },
        });

        const response: any = await Promise.race([genPromise, timeoutPromise]);
        const responseText = response.text || "{}";
        const parsed = JSON.parse(responseText);

        if (parsed.suggestions?.professional && parsed.suggestions?.friendly && parsed.suggestions?.detailed) {
          const suggestions = {
            professional: parsed.suggestions.professional,
            friendly: parsed.suggestions.friendly,
            detailed: parsed.suggestions.detailed,
          };

          const recommendedTone = (["professional", "friendly", "detailed"].includes(parsed.recommendedTone)
            ? parsed.recommendedTone
            : "professional") as "professional" | "friendly" | "detailed";

          const confidenceScore =
            typeof parsed.confidenceScore === "number"
              ? parsed.confidenceScore
              : 0.94;

          const isAmbiguous = Boolean(parsed.isAmbiguous);
          const containsCommitment = Boolean(parsed.containsCommitment);
          const missingContext = Boolean(parsed.missingContext);

          const chosenText = suggestions[recommendedTone];
          const safetyEvaluation = CommunicationSafetyGuard.evaluate(chosenText, {
            confidenceScore,
            isAmbiguous,
            containsCommitment,
            missingContext,
          });

          return {
            suggestions,
            recommendedTone,
            confidenceScore,
            isAmbiguous,
            containsCommitment,
            missingContext,
            safetyEvaluation,
            provider: "gemini",
            providerModel: model,
            relevantScriptIds,
            matchedScriptTitles,
            scriptVersion,
            noRelevantScriptFound: isScriptMatch ? false : Boolean(parsed.noRelevantScriptFound),
            requiresAdminReview: parsed.requiresAdminReview ?? requiresAdminReview,
            intentCategory: intent.categoryLabel,
          };
        }
      } catch (err: any) {
        const errMsg = String(err.message || err);

        if (
          errMsg.includes("429") ||
          errMsg.includes("RESOURCE_EXHAUSTED") ||
          errMsg.includes("quota") ||
          errMsg.includes("Rate limit")
        ) {
          AdminCommunicationAgent.lastQuotaExhaustedTimestamp = Date.now();
          break;
        }
      }
    }

    // Return senior-consultant-grade fallback
    const safety = CommunicationSafetyGuard.evaluate(fallbackResponse.suggestions.professional, {
      confidenceScore: fallbackResponse.confidenceScore,
    });
    return {
      ...fallbackResponse,
      safetyEvaluation: safety,
      provider: "fallback",
      providerModel: "senior-consultant-engine",
    };
  }

  /**
   * Generates proactive senior-consultant follow-up suggestions for the Human Admin
   * when the admin has already replied and the conversation is awaiting client response.
   */
  static generateFollowUpSuggestions(params: {
    clientName?: string;
    businessName?: string;
    lastAdminReply?: string;
  }): { professional: string; friendly: string; detailed: string } {
    const clientGreeting = params.clientName ? params.clientName.trim() : "there";
    const brand =
      params.businessName &&
      params.businessName.trim() &&
      !params.businessName.toLowerCase().includes("new marketing campaign")
        ? params.businessName.trim()
        : "your campaign";

    return {
      professional: `Hello ${clientGreeting}, just following up on our previous note regarding ${brand}. When you have a moment, please let us know your thoughts so our strategy team can finalize your campaign rollout schedule.`,
      friendly: `Hi ${clientGreeting}! Checking in to see how everything is going with ${brand}. Whenever you're ready, let us know and we'll dive right into the next milestone! 😊`,
      detailed: `Hello ${clientGreeting}, following up on our last discussion regarding your campaign strategy for ${brand}. To keep your target launch timeline on schedule, please share any feedback on the proposed parameters so our team can finalize your audience sets and ad creative assets.`,
    };
  }
}

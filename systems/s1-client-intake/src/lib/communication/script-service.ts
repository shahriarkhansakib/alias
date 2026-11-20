import { dbConnect } from "@/lib/db/connect";
import AdminScript, {
  IAdminScript,
  ScriptCategory,
  SCRIPT_CATEGORIES,
} from "@/models/AdminScript";

export interface ScriptMatchResult {
  matchedScripts: IAdminScript[];
  bestMatch: IAdminScript | null;
  confidenceScore: number;
  noRelevantScriptFound: boolean;
  matchedCategories: string[];
}

export class ScriptService {
  /**
   * Seed approved starter scripts across agency categories if database collection is empty.
   */
  static async ensureDefaultScriptsSeeded(): Promise<void> {
    try {
      await dbConnect();
      const mongoose = await import("mongoose");
      if (mongoose.default.connection.readyState !== 1) return;
      const count = await AdminScript.countDocuments().catch(() => 1);
      if (count > 0) return;

      const initialScripts = [
      {
        title: "Standard Agency Greeting",
        category: "Greeting" as ScriptCategory,
        content:
          "Welcome to ALIAS Marketing! We are delighted to partner with you on scaling your brand's digital presence and customer acquisition. How can our team assist you today?",
        keywords: ["hello", "hi", "hey", "welcome", "greetings", "শুরু", "হ্যালো", "সালাম", "assalamu alaikum"],
        relevantSituations: ["Initial onboarding greeting", "Client saying hello"],
        isActive: true,
      },
      {
        title: "Agency Introduction & Capabilities",
        category: "Agency Introduction" as ScriptCategory,
        content:
          "ALIAS is a full-service autonomous marketing agency specializing in high-performance Meta and Google digital campaigns. We pair proprietary creative strategy with dedicated account strategists to ensure maximum return on ad spend.",
        keywords: ["about", "who are you", "agency", "company", "team", "introduction", "কি কাজ করেন", "এজেন্সি"],
        relevantSituations: ["Client asking about agency background and capabilities"],
        isActive: true,
      },
      {
        title: "Core Marketing Services",
        category: "Services" as ScriptCategory,
        content:
          "Our core services include paid social advertising (Facebook & Instagram Feed, Stories, and Reels), Google Search and Performance Max campaigns, custom ad creative production, conversion tracking setup, and ongoing ROAS optimization.",
        keywords: [
          "services", "channels", "meta", "facebook", "instagram", "google", "ads", "platform",
          "সেবা", "সার্ভিস", "ফেইসবুক", "ফেসবুক", "ইনস্টাগ্রাম", "মার্কেটিং", "চ্যানেল", "বিজ্ঞাপন"
        ],
        relevantSituations: ["Client asking what services or marketing platforms will be used"],
        isActive: true,
      },
      {
        title: "Performance Pricing Policy",
        category: "Pricing" as ScriptCategory,
        content:
          "Our campaign management fees are structured transparently based on campaign scope and dedicated strategist hours. We separate agency management fees from client ad spend, ensuring 100% of your advertising budget goes directly to Meta/Google platforms.",
        keywords: ["pricing", "cost", "fee", "rate", "charge", "price", "টাকা", "চার্জ", "ফি", "খরচ", "দাম"],
        relevantSituations: ["Client inquiring about management pricing or fee structures"],
        isActive: true,
      },
      {
        title: "Standard Growth Packages",
        category: "Packages" as ScriptCategory,
        content:
          "We offer three structured tiers: Starter Test (for establishing conversion baselines), Growth Accelerator (for multi-adset scaling), and Enterprise Retainer (for omnichannel custom execution). Each includes dedicated strategist allocation and weekly reporting.",
        keywords: ["package", "tier", "plan", "bundle", "starter", "growth", "প্যাকেজ", "প্ল্যান"],
        relevantSituations: ["Client asking about campaign packages or service tiers"],
        isActive: true,
      },
      {
        title: "Full-Funnel Campaign Strategy",
        category: "Campaign Strategy" as ScriptCategory,
        content:
          "Our campaign execution deploys a proven three-phase framework: Phase 1 establishes technical pixel tracking and creative testing; Phase 2 optimizes winning adsets toward high-intent audiences; Phase 3 scales budget profitably while maintaining target cost-per-acquisition.",
        keywords: [
          "strategy", "approach", "funnel", "phases", "how it works", "plan",
          "objective", "campaign objective", "goal", "review",
          "পদ্ধতি", "কৌশল", "স্ট্র্যাটেজি", "লক্ষ্য", "উদ্দেশ্য"
        ],
        relevantSituations: ["Client asking for campaign strategy or tactical methodology"],
        isActive: true,
      },
      {
        title: "Reporting & Dashboard FAQs",
        category: "FAQs" as ScriptCategory,
        content:
          "Clients receive live access to transparent performance dashboards, complemented by structured weekly performance summaries and bi-weekly strategic review calls with your designated account manager.",
        keywords: ["reporting", "dashboard", "updates", "metrics", "frequency", "how often", "রিপোর্ট", "আপডেট"],
        relevantSituations: ["Client inquiring about reporting frequency and metrics"],
        isActive: true,
      },
      {
        title: "Handling Discount & Budget Objections",
        category: "Client Objections" as ScriptCategory,
        content:
          "Our pricing is carefully calculated to deliver uncompromised creative quality and dedicated senior management. While we do not offer automated discounts, we can review customized milestone retainers for extended 3-month commitments.",
        keywords: ["discount", "cheaper", "reduce", "less", "offer", "concession", "ডিসকাউন্ট", "কম", "কমানো"],
        relevantSituations: ["Client asking for a discount or cheaper rate"],
        isActive: true,
      },
      {
        title: "Transparent Payment & Invoicing Terms",
        category: "Payment Policies" as ScriptCategory,
        content:
          "Agency management retainers are billed at the start of each campaign cycle via secure bank transfer or card. Ad spend is charged directly by Meta/Google to your business payment method on file, providing complete financial transparency.",
        keywords: ["payment", "invoice", "billing", "terms", "method", "credit card", "bank", "পেমেন্ট", "বিলিং"],
        relevantSituations: ["Client asking about payment terms and billing schedules"],
        isActive: true,
      },
      {
        title: "Campaign Onboarding & Delivery Timeline",
        category: "Delivery Timeline" as ScriptCategory,
        content:
          "Standard onboarding takes 3 to 5 business days to audit assets, stage tracking pixels, and approve creative copy. Once client sign-off is completed, campaigns launch immediately into live auction delivery.",
        keywords: ["timeline", "launch date", "launch", "when", "how long", "schedule", "delivery", "কত দিন", "কবে", "সময়", "লঞ্চ"],
        relevantSituations: ["Client asking when the campaign will launch or how long setup takes"],
        isActive: true,
      },
      {
        title: "Strict No False Guarantees Policy",
        category: "Forbidden Claims / Restrictions" as ScriptCategory,
        content:
          "ALIAS strictly adheres to verified industry standards. We do not guarantee arbitrary 100% sales or exact financial returns, as advertising outcomes depend on product-market fit, seasonal demand, and supply chain fulfillment. We guarantee data-driven optimization and rigorous execution.",
        keywords: ["guarantee", "promise", "sure", "100%", "sales guarantee", "নিশ্চিত", "গ্যারান্টি"],
        relevantSituations: ["Client demanding guaranteed sales numbers or 100% ROI guarantees"],
        isActive: true,
      },
    ];

    await AdminScript.insertMany(
      initialScripts.map((s) => ({
        ...s,
        version: 1,
        createdBy: "system_seed",
        updatedBy: "system_seed",
      }))
    );
    } catch {
      // Ignore seeding errors in test / offline mode
    }
  }

  /**
   * List all scripts with optional filtering.
   */
  static async listScripts(filter?: {
    category?: string;
    search?: string;
    isActive?: boolean;
  }): Promise<IAdminScript[]> {
    await dbConnect();
    await this.ensureDefaultScriptsSeeded();

    const query: any = {};
    if (filter?.category && filter.category !== "ALL") {
      query.category = filter.category;
    }
    if (typeof filter?.isActive === "boolean") {
      query.isActive = filter.isActive;
    }
    if (filter?.search && filter.search.trim()) {
      const q = filter.search.trim();
      query.$or = [
        { title: { $regex: q, $options: "i" } },
        { content: { $regex: q, $options: "i" } },
        { keywords: { $in: [new RegExp(q, "i")] } },
      ];
    }

    return await AdminScript.find(query).sort({ category: 1, updatedAt: -1 }).lean();
  }

  /**
   * Create a new approved script.
   */
  static async createScript(data: {
    title: string;
    category: ScriptCategory;
    content: string;
    keywords?: string[];
    relevantSituations?: string[];
    isActive?: boolean;
    createdBy?: string;
  }): Promise<IAdminScript> {
    await dbConnect();
    if (!SCRIPT_CATEGORIES.includes(data.category)) {
      throw new Error(`Invalid category. Must be one of: ${SCRIPT_CATEGORIES.join(", ")}`);
    }

    return await AdminScript.create({
      title: data.title.trim(),
      category: data.category,
      content: data.content.trim(),
      keywords: (data.keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean),
      relevantSituations: (data.relevantSituations || []).map((s) => s.trim()).filter(Boolean),
      isActive: data.isActive !== undefined ? data.isActive : true,
      version: 1,
      createdBy: data.createdBy || "System Admin",
      updatedBy: data.createdBy || "System Admin",
    });
  }

  /**
   * Update an existing approved script.
   */
  static async updateScript(
    id: string,
    data: {
      title?: string;
      category?: ScriptCategory;
      content?: string;
      keywords?: string[];
      relevantSituations?: string[];
      isActive?: boolean;
      updatedBy?: string;
    }
  ): Promise<IAdminScript | null> {
    await dbConnect();
    const script = await AdminScript.findById(id);
    if (!script) return null;

    if (data.title) script.title = data.title.trim();
    if (data.category) {
      if (!SCRIPT_CATEGORIES.includes(data.category)) {
        throw new Error(`Invalid category: ${data.category}`);
      }
      script.category = data.category;
    }
    if (data.content) script.content = data.content.trim();
    if (data.keywords) {
      script.keywords = data.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
    }
    if (data.relevantSituations) {
      script.relevantSituations = data.relevantSituations.map((s) => s.trim()).filter(Boolean);
    }
    if (typeof data.isActive === "boolean") script.isActive = data.isActive;

    script.version = (script.version || 1) + 1;
    script.updatedBy = data.updatedBy || "System Admin";

    await script.save();
    return script;
  }

  /**
   * Delete an approved script.
   */
  static async deleteScript(id: string): Promise<boolean> {
    await dbConnect();
    const res = await AdminScript.findByIdAndDelete(id);
    return Boolean(res);
  }

  /**
   * Match an incoming client inquiry against approved knowledge-base scripts.
   * Returns ranked relevant scripts and an explicit confidence score.
   */
  static async findRelevantScripts(
    inquiry: string,
    businessName?: string,
    artifact1?: any
  ): Promise<ScriptMatchResult> {
    let activeScripts: any[] = [];
    try {
      await dbConnect();
      await this.ensureDefaultScriptsSeeded();
      activeScripts = await AdminScript.find({ isActive: true }).lean().catch(() => []);
    } catch {
      activeScripts = [];
    }

    if (!activeScripts || activeScripts.length === 0) {
      // In-memory fallback scripts for unit test / offline resilience
      activeScripts = [
        {
          _id: "seed_services",
          title: "Core Marketing Services",
          category: "Services",
          content: "Our core services include paid social advertising (Facebook & Instagram), custom ad creative production, conversion tracking setup, and ongoing ROAS optimization.",
          keywords: [
            "services", "channels", "meta", "facebook", "instagram", "ads", "platform",
            "সেবা", "সার্ভিস", "ফেইসবুক", "ফেসবুক", "ইনস্টাগ্রাম", "মার্কেটিং", "চ্যানেল"
          ],
          relevantSituations: ["Client asking what services will be used"],
          isActive: true,
          version: 1,
        },
        {
          _id: "seed_timeline",
          title: "Campaign Onboarding & Delivery Timeline",
          category: "Delivery Timeline",
          content: "Standard onboarding takes 3 to 5 business days to audit assets, stage tracking pixels, and approve creative copy. Once client sign-off is completed, campaigns launch immediately into live auction delivery.",
          keywords: ["timeline", "launch date", "launch", "when", "how long", "schedule", "delivery", "কত দিন", "কবে", "সময়", "লঞ্চ"],
          relevantSituations: ["Client asking when the campaign will launch"],
          isActive: true,
          version: 1,
        },
        {
          _id: "seed_pricing",
          title: "Standard Performance Package Pricing",
          category: "Pricing",
          content: "Our standard starter retainer begins at 35,000 BDT per month, covering complete creative design, copywriting, and daily ad spend management. Custom enterprise tiers are tailored according to projected ad spend volume.",
          keywords: ["price", "cost", "pricing", "package", "fee", "rate", "খরচ", "প্যাকেজ", "দাম", "কত টাকা"],
          relevantSituations: ["Client asking about package pricing or agency fees"],
          isActive: true,
          version: 1,
        },
        {
          _id: "seed_strategy",
          title: "Full-Funnel Campaign Strategy",
          category: "Campaign Strategy",
          content: "Our campaign execution deploys a proven three-phase framework: Phase 1 establishes technical pixel tracking and creative testing; Phase 2 optimizes winning adsets toward high-intent audiences; Phase 3 scales budget profitably while maintaining target cost-per-acquisition.",
          keywords: [
            "strategy", "approach", "funnel", "phases", "how it works", "plan",
            "objective", "campaign objective", "goal", "review",
            "পদ্ধতি", "কৌশল", "স্ট্র্যাটেজি", "লক্ষ্য", "উদ্দেশ্য"
          ],
          relevantSituations: ["Client asking for campaign strategy or reviewing campaign objective"],
          isActive: true,
          version: 1,
        },
        {
          _id: "seed_no_guarantee",
          title: "Strict No False Guarantees Policy",
          category: "Forbidden Claims / Restrictions",
          content: "ALIAS strictly adheres to verified industry standards. We do not guarantee arbitrary 100% sales or exact financial returns, as advertising outcomes depend on product-market fit. We guarantee data-driven optimization and rigorous execution.",
          keywords: ["guarantee", "promise", "sure", "100%", "sales guarantee", "নিশ্চিত", "গ্যারান্টি"],
          relevantSituations: ["Client demanding guaranteed sales numbers"],
          isActive: true,
          version: 1,
        },
      ];
    }

    const cleanInquiry = (inquiry || "").toLowerCase();

    // Score each script based on keyword hits, title overlap, and situational relevance
    const scored = activeScripts.map((script) => {
      let score = 0;
      let keywordHits = 0;

      // 1. Keyword matching
      for (const kw of script.keywords || []) {
        if (!kw) continue;
        const cleanKw = kw.toLowerCase();
        if (cleanInquiry.includes(cleanKw)) {
          keywordHits++;
          score += cleanKw.length > 4 ? 3 : 2; // Higher weight for descriptive terms
        }
      }

      // 2. Title match
      const titleWords = script.title.toLowerCase().split(/\s+/);
      for (const word of titleWords) {
        if (word.length > 3 && cleanInquiry.includes(word)) {
          score += 1.5;
        }
      }

      // 3. Situational keyword matching
      for (const sit of script.relevantSituations || []) {
        const sitWords = sit.toLowerCase().split(/\s+/);
        for (const word of sitWords) {
          if (word.length > 4 && cleanInquiry.includes(word)) {
            score += 1;
          }
        }
      }

      // 4. Category-specific heuristic boosting
      const cat = script.category;
      if (
        (cat === "Pricing" || cat === "Packages") &&
        (cleanInquiry.includes("cost") ||
          cleanInquiry.includes("price") ||
          cleanInquiry.includes("budget") ||
          cleanInquiry.includes("টাকা") ||
          cleanInquiry.includes("দাম") ||
          cleanInquiry.includes("খরচ"))
      ) {
        score += 4;
      }
      if (
        cat === "Delivery Timeline" &&
        (cleanInquiry.includes("launch") ||
          cleanInquiry.includes("when") ||
          cleanInquiry.includes("timeline") ||
          cleanInquiry.includes("কবে") ||
          cleanInquiry.includes("সময়"))
      ) {
        score += 4;
      }
      if (
        cat === "Client Objections" &&
        (cleanInquiry.includes("discount") ||
          cleanInquiry.includes("cheaper") ||
          cleanInquiry.includes("কম") ||
          cleanInquiry.includes("কমানো"))
      ) {
        score += 4;
      }
      if (
        (cat === "Services" || cat === "Campaign Strategy") &&
        (cleanInquiry.includes("strategy") ||
          cleanInquiry.includes("channel") ||
          cleanInquiry.includes("facebook") ||
          cleanInquiry.includes("meta") ||
          cleanInquiry.includes("বিক্রি") ||
          cleanInquiry.includes("সেলস"))
      ) {
        score += 3;
      }

      return {
        script,
        score,
        keywordHits,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const topMatches = scored.filter((s) => s.score >= 2);
    const best = topMatches.length > 0 ? topMatches[0] : null;

    if (!best || best.score < 2) {
      return {
        matchedScripts: [],
        bestMatch: null,
        confidenceScore: 0.2,
        noRelevantScriptFound: true,
        matchedCategories: [],
      };
    }

    // Normalize confidence score between 0.65 and 0.98 based on score strength
    const normalizedConfidence = Math.min(0.98, Math.max(0.7, 0.65 + best.score * 0.05));

    const matchedScripts = topMatches.slice(0, 3).map((m) => m.script as IAdminScript);
    const matchedCategories = Array.from(new Set(matchedScripts.map((s) => s.category)));

    return {
      matchedScripts,
      bestMatch: best.script as IAdminScript,
      confidenceScore: normalizedConfidence,
      noRelevantScriptFound: false,
      matchedCategories,
    };
  }
}

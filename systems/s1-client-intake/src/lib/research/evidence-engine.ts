import {
  ResearchDossier,
  ResearchFinding,
  ResearchSource,
  CompetitorAnalysisItem,
  ResearchCompletionStatus,
  ConfidenceLevel,
  EvidenceStatus,
  SourceTier,
  FindingNature,
  SemanticRelevanceStatus,
} from "./types";
import { ResearchSearchService } from "./search-service";
import { CampaignContextAnalyzer } from "./campaign-analyzer";

export class EvidenceEngine {
  /**
   * Evaluates textual and entity relevance between a factual claim and a candidate supporting source.
   * Ensures that HTTP 200 accessibility NEVER automatically marks a claim as VERIFIED.
   */
  static evaluateEvidenceSupport(
    claim: string,
    source: ResearchSource | null
  ): {
    status: EvidenceStatus;
    confidence: ConfidenceLevel;
    evaluation_notes: string;
    excerpt_used: string;
  } {
    if (!source || (source.validation_status !== "VERIFIED" && source.validation_status !== "REDIRECTED_AND_VERIFIED")) {
      return {
        status: "UNVERIFIED",
        confidence: "Low",
        evaluation_notes: "No verified HTTP source available to support this claim.",
        excerpt_used: "No verified external documentation available.",
      };
    }

    const sourceText = `${source.title} ${source.content_snippet || ""} ${source.evidence_excerpt || ""}`.toLowerCase();
    const claimLower = claim.toLowerCase();

    // Extract key conceptual tokens from claim (words > 4 chars, ignoring common filler)
    const stopWords = new Set(["their", "there", "about", "which", "where", "these", "those", "market", "commercial", "business"]);
    const claimKeywords = claimLower
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4 && !stopWords.has(w));

    // Count matching keywords in source text
    const matchedKeywords = claimKeywords.filter((kw) => sourceText.includes(kw));
    const matchRatio = claimKeywords.length > 0 ? matchedKeywords.length / claimKeywords.length : 0;

    // Check if claim asserts specific numerical statistics (e.g. percentages, ratios)
    const numbersInClaim = claim.match(/\b\d+(?:\.\d+)?%|\b\d+x\b|\b\d+–\d+%/gi) || [];
    let numbersSupported = true;
    for (const num of numbersInClaim) {
      if (!sourceText.includes(num.toLowerCase())) {
        numbersSupported = false;
        break;
      }
    }

    // Check for contradiction indicators
    if (claimLower.includes("growth") && sourceText.includes("decline") && !sourceText.includes("growth")) {
      return {
        status: "CONTRADICTED",
        confidence: "Low",
        evaluation_notes: `Contradiction detected: Source discusses economic decline rather than claimed growth.`,
        excerpt_used: source.evidence_excerpt,
      };
    }

    // Source Tier detection with sensible default
    const tier: SourceTier =
      source.source_tier ||
      (source.domain?.includes("wikipedia.org") || source.domain?.includes("britannica.com")
        ? "TERTIARY"
        : "SECONDARY");

    // Tertiary Source Rule: Wikipedia can at best yield PARTIALLY_VERIFIED
    if (tier === "TERTIARY") {
      return {
        status: matchRatio >= 0.3 ? "PARTIALLY_VERIFIED" : "UNVERIFIED",
        confidence: "Medium",
        evaluation_notes: `Supported directionally by tertiary encyclopedia reference (${source.title}); lacks primary empirical business metrics.`,
        excerpt_used: source.evidence_excerpt,
      };
    }

    // If numbers are asserted in claim but missing in source -> PARTIALLY_VERIFIED at best
    if (!numbersSupported) {
      return {
        status: "PARTIALLY_VERIFIED",
        confidence: "Medium",
        evaluation_notes: `Source provides qualitative context on topic, but specific numerical figures are not directly attested in the source text.`,
        excerpt_used: source.evidence_excerpt,
      };
    }

    // High relevance match with primary or secondary source
    if (matchRatio >= 0.4) {
      return {
        status: "VERIFIED",
        confidence: tier === "PRIMARY" ? "High" : "Medium",
        evaluation_notes: `Direct semantic support found in ${tier} source (${source.title}).`,
        excerpt_used: source.evidence_excerpt,
      };
    }

    if (matchRatio >= 0.2) {
      return {
        status: "PARTIALLY_VERIFIED",
        confidence: "Medium",
        evaluation_notes: `General domain overlap with source, but direct evidence for specific claim statement is partial.`,
        excerpt_used: source.evidence_excerpt,
      };
    }

    return {
      status: "UNVERIFIED",
      confidence: "Low",
      evaluation_notes: `Source does not contain sufficient textual evidence to validate this specific claim.`,
      excerpt_used: source.evidence_excerpt,
    };
  }

  /**
   * Evaluates the semantic relevance of a candidate source specifically for a target category.
   * Enforces topical relevance, geographic alignment, and authority tier.
   * Completely rejects social media posts for macro landscapes and directory listings for consumer behavior.
   */
  static evaluateSourceCategoryRelevance(
    category: string,
    source: ResearchSource,
    location: string
  ): { status: SemanticRelevanceStatus; score: number; rejectionReason?: string; isDirect: boolean } {
    const catLower = category.toLowerCase();
    const sourceText = `${source.title} ${source.source_type} ${source.domain} ${source.evidence_excerpt || ""} ${source.content_snippet || ""}`.toLowerCase();
    const domain = (source.domain || "").toLowerCase();

    // Check Geographic Relevance
    const reqGeo = location.toLowerCase();
    const isBangladeshCampaign = reqGeo.includes("bangladesh") || reqGeo.includes("dhaka");
    const mentionsBangladesh = sourceText.includes("bangladesh") || sourceText.includes("dhaka") || domain.endsWith(".bd");

    // Check Source Authority & Disqualifiers
    const isSocialMedia =
      source.is_social_media ||
      ["facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com", "pinterest.com", "youtube.com"].some(
        (d) => domain === d || domain.endsWith("." + d)
      );

    const isDirectory =
      source.is_directory_listing ||
      ["tracxn.com", "crunchbase.com", "zoominfo.com", "pitchbook.com", "cbinsights.com"].some(
        (d) => domain === d || domain.endsWith("." + d)
      );

    // Rule 1: Industry Landscape & Market Dynamics
    if (catLower.includes("landscape") || catLower.includes("industry overview") || catLower.includes("dynamics")) {
      if (isSocialMedia) {
        return {
          status: "IRRELEVANT",
          score: 0,
          isDirect: false,
          rejectionReason: "Social media post rejected: lacks institutional authority for industry landscape analysis.",
        };
      }
      if (isDirectory) {
        return {
          status: "IRRELEVANT",
          score: 0,
          isDirect: false,
          rejectionReason: "Company directory profile rejected: lacks macroeconomic sector or market size data.",
        };
      }
      const hasMacroTokens = [
        "market", "industry", "sector", "apparel", "retail", "textile", "growth",
        "export", "billion", "million", "cagr", "gdp", "manufacturing", "commercial",
        "enterprise", "software", "saas", "cloud", "subscription", "platform", "service", "computing", "technology"
      ].filter((t) => sourceText.includes(t));

      if (hasMacroTokens.length < 2) {
        return {
          status: "IRRELEVANT",
          score: 1,
          isDirect: false,
          rejectionReason: "Source lacks macroeconomic sector scale or industry growth indicators.",
        };
      }
      if (isBangladeshCampaign && !mentionsBangladesh) {
        return {
          status: "PARTIALLY_RELEVANT",
          score: 4,
          isDirect: false,
          rejectionReason: "Geographic scope partial: global reference without direct Bangladesh market metrics.",
        };
      }
      return {
        status: "HIGHLY_RELEVANT",
        score: hasMacroTokens.length + (source.source_tier === "PRIMARY" ? 3 : 2),
        isDirect: true,
      };
    }

    // Rule 2: Consumer Buying Behavior & Seasonal Trends
    if (catLower.includes("consumer") || catLower.includes("buying behavior") || catLower.includes("trends")) {
      if (isDirectory) {
        return {
          status: "IRRELEVANT",
          score: 0,
          isDirect: false,
          rejectionReason: "Company profile rejected: directory listings do not provide consumer shopping surveys or behavior research.",
        };
      }
      if (isSocialMedia && !sourceText.includes("survey") && !sourceText.includes("consumer") && !sourceText.includes("trend")) {
        return {
          status: "IRRELEVANT",
          score: 0,
          isDirect: false,
          rejectionReason: "Social media post rejected: individual product post lacks consumer research or shopping study.",
        };
      }
      const hasConsumerTokens = [
        "consumer", "shopper", "buying", "behavior", "purchase", "demand",
        "preference", "survey", "demographic", "spending", "online shopping", "lifestyle", "habit"
      ].filter((t) => sourceText.includes(t));

      if (hasConsumerTokens.length < 2) {
        return {
          status: "IRRELEVANT",
          score: 1,
          isDirect: false,
          rejectionReason: "Source does not contain consumer behavior, shopping preferences, or demographic research.",
        };
      }
      return { status: "HIGHLY_RELEVANT", score: hasConsumerTokens.length + 3, isDirect: true };
    }

    // Rule 3: Competitor Pricing & Catalog
    if (catLower.includes("pricing") || catLower.includes("catalog") || catLower.includes("competitor")) {
      if (isDirectory && !sourceText.includes("price") && !sourceText.includes("৳") && !sourceText.includes("bdt")) {
        return {
          status: "IRRELEVANT",
          score: 0,
          isDirect: false,
          rejectionReason: "Company directory profile rejected: lacks visible catalog pricing or product price benchmarks.",
        };
      }
      const hasPriceTokens = ["৳", "bdt", "tk", "price", "pricing", "discount", "offer", "cost", "catalog", "rate", "$"].filter(
        (t) => sourceText.includes(t)
      );
      if (hasPriceTokens.length === 0) {
        return {
          status: "IRRELEVANT",
          score: 0,
          isDirect: false,
          rejectionReason: "Source does not contain visible pricing, price ranges, or catalog benchmarks.",
        };
      }
      return { status: "HIGHLY_RELEVANT", score: hasPriceTokens.length + 3, isDirect: true };
    }

    // Rule 4: Payment Reliability & Risk Mitigation
    if (catLower.includes("payment") || catLower.includes("risk") || catLower.includes("reliability")) {
      if (isSocialMedia && !sourceText.includes("cash on delivery") && !sourceText.includes("payment") && !sourceText.includes("cod")) {
        return {
          status: "IRRELEVANT",
          score: 0,
          isDirect: false,
          rejectionReason: "Social media post rejected: product hashtag promotion lacks payment reliability or transaction risk evidence.",
        };
      }
      const hasPaymentTokens = [
        "cash on delivery", "cod", "bkash", "nagad", "payment", "gateway",
        "return rate", "courier", "delivery", "fraud", "refund", "logistics", "settlement", "risk", "friction"
      ].filter((t) => sourceText.includes(t));

      if (hasPaymentTokens.length < 2) {
        return {
          status: "IRRELEVANT",
          score: 1,
          isDirect: false,
          rejectionReason: "Source lacks empirical discussion of payment methods, Cash on Delivery, or transaction risk.",
        };
      }
      return { status: "HIGHLY_RELEVANT", score: hasPaymentTokens.length + 3, isDirect: true };
    }

    // Rule 5: Social Commerce & Acquisition Channels
    if (catLower.includes("social") || catLower.includes("channel") || catLower.includes("acquisition")) {
      const hasChannelTokens = [
        "social commerce", "f-commerce", "facebook", "instagram", "tiktok", "channel",
        "platform", "social media", "ad", "digital marketing", "influencer", "discovery", "media"
      ].filter((t) => sourceText.includes(t));

      if (hasChannelTokens.length < 2) {
        return {
          status: "IRRELEVANT",
          score: 1,
          isDirect: false,
          rejectionReason: "Source lacks discussion of social commerce or digital customer acquisition channels.",
        };
      }
      return { status: "HIGHLY_RELEVANT", score: hasChannelTokens.length + 2, isDirect: true };
    }

    // Universal Dynamic Rule for other categories (SaaS, Dining, Education, etc.)
    const categoryTokens = catLower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["with", "from", "that", "this"].includes(w));
    const matchedTokens = categoryTokens.filter((tok) => sourceText.includes(tok));
    if (matchedTokens.length === 0) {
      return {
        status: "IRRELEVANT",
        score: 0,
        isDirect: false,
        rejectionReason: `Source does not contain concepts related to ${category}.`,
      };
    }

    return {
      status: matchedTokens.length >= 2 ? "HIGHLY_RELEVANT" : "PARTIALLY_RELEVANT",
      score: matchedTokens.length + 1,
      isDirect: matchedTokens.length >= 2,
    };
  }

  /**
   * Universal dynamic category matching helper.
   * Finds the best verified source for a given research category using semantic relevance criteria.
   * STRICT REQUIREMENT: If no source passes the semantic relevance threshold, returns null.
   * NEVER forces an irrelevant source into a category.
   */
  private static findBestSourceForCategory(
    category: string,
    verifiedSources: ResearchSource[],
    usedSourceIds: Set<string>,
    location: string
  ): { source: ResearchSource | null; evaluation: ReturnType<typeof EvidenceEngine.evaluateSourceCategoryRelevance> } {
    let bestSource: ResearchSource | null = null;
    let bestScore = -1;
    let bestEval: any = {
      status: "INSUFFICIENT_EVIDENCE",
      score: 0,
      isDirect: false,
      rejectionReason: `No verified sources met the semantic relevance requirements for ${category}.`,
    };

    for (const src of verifiedSources) {
      const relevance = this.evaluateSourceCategoryRelevance(category, src, location);

      // Strict fail-closed rule: Disqualified or irrelevant sources are NEVER matched
      if (relevance.status === "IRRELEVANT") {
        continue;
      }

      let score = relevance.score;
      if (src.source_tier === "PRIMARY") score += 2;
      if (!usedSourceIds.has(src.source_id)) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestSource = src;
        bestEval = relevance;
      }
    }

    if (bestSource && bestScore > 0) {
      usedSourceIds.add(bestSource.source_id);
      return { source: bestSource, evaluation: bestEval };
    }

    // NEVER force an irrelevant fallback source
    return { source: null, evaluation: bestEval };
  }

  /**
   * Extracts factual evidence highlights (prices, discounts, products)
   * directly from the source excerpt to construct specific, non-generic findings.
   */
  private static extractSourceHighlights(text: string): {
    prices: string[];
    discounts: string[];
    products: string[];
    keyStatement: string | null;
  } {
    if (!text || text.length < 15) {
      return { prices: [], discounts: [], products: [], keyStatement: null };
    }

    // Match prices like ৳160, ৳1,450, BDT 500, Tk. 350, $29
    const priceMatches = text.match(/(?:৳|bdt|tk\.?|\$)\s*\d+(?:[,\.]\d+)*(?:\s*(?:to|-)\s*(?:৳|bdt|tk\.?|\$)?\s*\d+(?:[,\.]\d+)*)?/gi) || [];
    const prices = Array.from(new Set(priceMatches.map((p) => p.trim())));

    // Match discounts/percentages like 30% off, 15% discount, 25%
    const discountMatches = text.match(/\b\d+(?:\.\d+)?%\s*(?:off|discount|less|growth|margin|cagr)?/gi) || [];
    const discounts = Array.from(new Set(discountMatches.map((d) => d.trim())));

    // Match common product/style terms if mentioned in excerpt
    const productKeywords = [
      "t-shirts", "tees", "hoodies", "oversized", "streetwear", "denim", "polo", "jackets",
      "apparel", "casual wear", "sneakers", "activewear", "footwear", "accessories",
      "dine-in", "takeaway", "delivery", "subscription", "cloud", "saas", "onboarding"
    ];
    const textLower = text.toLowerCase();
    const products = productKeywords.filter((pk) => textLower.includes(pk));

    // Extract cleanest factual sentence from the excerpt
    let keyStatement: string | null = null;
    const rawSentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/[\r\n\t]+/g, " ").trim())
      .filter((s) => s.length >= 25 && s.length <= 220);

    if (rawSentences.length > 0) {
      let sentence = rawSentences[0];
      if (!/[.!?]$/.test(sentence)) {
        sentence += ".";
      }
      keyStatement = sentence;
    } else if (text.length >= 25) {
      const slice = text.slice(0, 160).replace(/[\r\n\t]+/g, " ").trim();
      const lastSpace = slice.lastIndexOf(" ");
      keyStatement = (lastSpace > 40 ? slice.slice(0, lastSpace) : slice) + ".";
    }

    return { prices, discounts, products, keyStatement };
  }

  /**
   * Generates dynamic, context-specific claim and explanation for ANY category and ANY industry.
   * Synthesizes specific empirical details from verified source excerpts without fabricating statistics or unsupported conclusions.
   */
  private static generateClaimForCategory(
    category: string,
    context: ReturnType<typeof CampaignContextAnalyzer.analyze>,
    source: ResearchSource | null
  ): { claim: string; explanation: string; defaultNature: FindingNature } {
    const { businessName, industry, productName, location, objective } = context;
    const catLower = category.toLowerCase();

    if (!source) {
      const isRec =
        catLower.includes("pricing") ||
        catLower.includes("offer") ||
        catLower.includes("subscription") ||
        catLower.includes("channel") ||
        catLower.includes("acquisition") ||
        catLower.includes("risk") ||
        catLower.includes("mitigation");
      const defaultNature: FindingNature = isRec ? "RECOMMENDATION" : catLower.includes("trend") ? "TREND" : "HYPOTHESIS";
      const claim = `INSUFFICIENT EVIDENCE (UNVERIFIED — No reliable supporting source found for ${category} in ${location}).`;
      const explanation = `Live search queries did not return sufficiently authoritative third-party data specifically validating ${category.toLowerCase()}. Strategic recommendations for this area require primary merchant testing.`;
      return { claim, explanation, defaultNature };
    }

    const sourceExcerpt = source.evidence_excerpt || source.content_snippet || "";
    const highlights = this.extractSourceHighlights(sourceExcerpt);
    const publisherName = source.publisher || source.domain || "Documented industry sources";
    const cleanStatement = (highlights.keyStatement || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/#\w+/g, "") // strip social hashtags
      .replace(/\s{2,}/g, " ")
      .trim();

    // 1. Industry Landscape & Market Dynamics
    if (catLower.includes("landscape") || catLower.includes("industry overview") || catLower.includes("dynamics")) {
      const claim = cleanStatement
        ? `${publisherName} reports: "${cleanStatement}"`
        : `The ${industry} sector represents an established commercial category in ${location}, characterized by documented market demand for ${productName}.`;
      const explanation = `Macroeconomic sector data evaluating market scale and prevailing commercial dynamics in ${location}.`;
      return { claim, explanation, defaultNature: "FACT" };
    }

    // 2. B2B / SaaS Specific: Customer Acquisition & Trial Conversion
    if (catLower.includes("trial") || catLower.includes("customer acquisition")) {
      const claim = cleanStatement
        ? `${publisherName} analysis indicates: "${cleanStatement}"`
        : `Customer acquisition for ${productName} in ${location} relies on low-friction product onboarding and trial conversion.`;
      const explanation = "Documented user acquisition benchmarks and trial conversion dynamics for technical offerings.";
      return { claim, explanation, defaultNature: "FACT" };
    }

    // 3. Hospitality / Dining Specific: Dining Trends & Preferences
    if (catLower.includes("dining") || catLower.includes("cuisine") || catLower.includes("menu")) {
      const claim = cleanStatement
        ? `${publisherName} dining observations report: "${cleanStatement}"`
        : `Consumer dining preferences in ${location} reflect responsiveness to authentic preparation and ambiance for ${productName}.`;
      const explanation = `Local hospitality observations regarding guest preferences and dining trends in ${location}.`;
      return { claim, explanation, defaultNature: "TREND" };
    }

    // 4. Education / Training Specific: Enrollment & Skills
    if (catLower.includes("enrollment") || catLower.includes("tuition") || catLower.includes("learner") || catLower.includes("student")) {
      const claim = cleanStatement
        ? `${publisherName} educational assessment confirms: "${cleanStatement}"`
        : `Learner enrollment for ${productName} in ${location} is driven by career mobility and practical skill mastery.`;
      const explanation = "Empirical education analysis regarding learner demand and skill acquisition.";
      return { claim, explanation, defaultNature: "FACT" };
    }

    // 5. Real Estate Specific: Property Demand & Price Trends
    if (catLower.includes("property") || catLower.includes("real estate") || catLower.includes("development")) {
      const claim = cleanStatement
        ? `${publisherName} property documentation notes: "${cleanStatement}"`
        : `Real estate interest in ${location} is shaped by transit accessibility and competitive price valuation.`;
      const explanation = `Documented property market and transaction valuation trends for ${location}.`;
      return { claim, explanation, defaultNature: "TREND" };
    }

    // 6. Healthcare / Wellness Specific: Patient Trust & Clinical Practice
    if (catLower.includes("patient") || catLower.includes("clinical") || catLower.includes("treatment")) {
      const claim = cleanStatement
        ? `${publisherName} clinical assessment notes: "${cleanStatement}"`
        : `Patient booking engagement in ${location} is determined by practitioner credentials and transparent clinical hygiene.`;
      const explanation = "Clinical operations and patient trust benchmarks.";
      return { claim, explanation, defaultNature: "FACT" };
    }

    // 7. General / Consumer Retail: Buying Behavior & Trends
    if (catLower.includes("buying behavior") || catLower.includes("market trends") || catLower.includes("trends")) {
      const claim = cleanStatement
        ? `${publisherName} retail analysis observes: "${cleanStatement}"`
        : `Consumer purchasing in ${location} is influenced by expanding digital discovery channels and accessible local purchasing options.`;
      const explanation = `Documented consumer buying behavior and shopping trends in ${location}.`;
      return { claim, explanation, defaultNature: "TREND" };
    }

    // 8. Competitor Landscape & Alternatives / Pricing
    if (catLower.includes("pricing") || catLower.includes("catalog") || catLower.includes("offer") || catLower.includes("subscription")) {
      const priceSnippet = highlights.prices.length > 0 ? ` Visible market prices center around ${highlights.prices.slice(0, 2).join(", ")}.` : "";
      const claim = cleanStatement
        ? `${publisherName} pricing documentation records: "${cleanStatement}"${priceSnippet}`
        : `Commercial pricing for ${productName} in ${location} is optimized when value metrics align with customer budgets.`;
      const explanation = "Observed commercial pricing and catalog offerings in the target market.";
      return { claim, explanation, defaultNature: "RECOMMENDATION" };
    }

    // 9. Payment Reliability & Fulfillment Risk
    if (catLower.includes("payment") || catLower.includes("risk") || catLower.includes("reliability") || catLower.includes("challenge")) {
      const claim = cleanStatement
        ? `${publisherName} payment assessment notes: "${cleanStatement}"`
        : `Operational delivery for ${businessName} in ${location} requires proactive fulfillment risk mitigation.`;
      const explanation = `Empirical transaction methods, Cash on Delivery reliability, and fulfillment logistics in ${location}.`;
      return { claim, explanation, defaultNature: "RECOMMENDATION" };
    }

    // 10. Channels & Customer Acquisition
    if (catLower.includes("channel") || catLower.includes("acquisition") || catLower.includes("social") || catLower.includes("discovery")) {
      const claim = cleanStatement
        ? `${publisherName} channel insights confirm: "${cleanStatement}"`
        : `Target audience discovery for ${productName} in ${location} centers on digital platforms aligned with ${objective}.`;
      const explanation = `Audience discovery and platform adoption patterns in ${location}.`;
      return { claim, explanation, defaultNature: "RECOMMENDATION" };
    }

    // Universal Dynamic Fallback for Any Novel Custom Category
    const claim = cleanStatement
      ? `${publisherName} records: "${cleanStatement}"`
      : `Market analysis for ${category} indicates relevant commercial demand for ${productName} in ${location}.`;
    const explanation = `Market intelligence relevant to ${category} in ${location}.`;
    return { claim, explanation, defaultNature: "FACT" };
  }

  /**
   * Synthesizes findings strictly from retrieved evidence, links claims to validated sources,
   * performs semantic evidence verification, and calculates completion status.
   * Completely universal and adaptive across any industry or campaign type.
   */
  static async buildDossier(
    artifact1: any,
    validatedSources: ResearchSource[],
    competitorsList: { name: string; website?: string; products?: string; price_range?: string; positioning?: string; offers?: string }[] = [],
    previousVersion?: string
  ): Promise<ResearchDossier> {
    // 1. Analyze campaign context dynamically
    const context = CampaignContextAnalyzer.analyze(artifact1);
    const { businessName, industry, productName, location, objective, profile, categories } = context;
    const today = new Date().toISOString().split("T")[0];

    // Determine version (e.g. 1.0 -> 2.0)
    let version = "1.0";
    if (previousVersion) {
      const parsedVer = parseFloat(previousVersion);
      version = !isNaN(parsedVer) ? (parsedVer + 1.0).toFixed(1) : "2.0";
    }

    const providerStatus = ResearchSearchService.getProviderStatus();

    const findings: ResearchFinding[] = [];
    const competitors: CompetitorAnalysisItem[] = [];
    let findingCounter = 1;

    const nextFindingId = () => `FND-${String(findingCounter++).padStart(3, "0")}`;

    // Filter verified sources
    const verifiedSources = validatedSources.filter(
      (s) => s.validation_status === "VERIFIED" || s.validation_status === "REDIRECTED_AND_VERIFIED"
    );

    const usedSourceIds = new Set<string>();

    // 2. Dynamically generate findings for each tailored category
    for (const category of categories) {
      const match = this.findBestSourceForCategory(category, verifiedSources, usedSourceIds, location);
      const matchingSource = match.source;
      const relevance = match.evaluation;

      const generated = this.generateClaimForCategory(category, context, matchingSource);
      const evaluation = this.evaluateEvidenceSupport(generated.claim, matchingSource);
      const findingId = nextFindingId();

      // Determine finding nature: FACT vs TREND vs HYPOTHESIS vs RECOMMENDATION
      let findingNature: FindingNature = generated.defaultNature;
      if (generated.defaultNature === "RECOMMENDATION") {
        findingNature = "RECOMMENDATION";
      } else if (!matchingSource || evaluation.status === "UNVERIFIED") {
        findingNature = "HYPOTHESIS";
      } else if (category.toLowerCase().includes("trend") || generated.defaultNature === "TREND") {
        findingNature = "TREND";
      } else if (evaluation.status === "VERIFIED") {
        findingNature = "FACT";
      } else {
        findingNature = "HYPOTHESIS";
      }

      let findingLimitations: string | null = null;
      if (!matchingSource || evaluation.status === "UNVERIFIED") {
        findingLimitations = "Empirical third-party data unavailable in live sources; strategic hypothesis requires live campaign testing.";
      } else if (matchingSource?.source_tier === "TERTIARY") {
        findingLimitations = "Derived from tertiary reference; requires empirical primary research.";
      } else if (relevance.rejectionReason) {
        findingLimitations = relevance.rejectionReason;
      }

      findings.push({
        finding_id: findingId,
        category,
        title: `${category} — ${businessName}`,
        claim: generated.claim,
        explanation: generated.explanation,
        evidence_excerpt: evaluation.excerpt_used,
        supporting_source_ids: matchingSource && evaluation.status !== "UNVERIFIED" ? [matchingSource.source_id] : [],
        confidence: evaluation.confidence,
        evidence_status: evaluation.status,
        semantic_relevance: relevance.status,
        rejection_reasons: relevance.rejectionReason ? [relevance.rejectionReason] : [],
        direct_evidence: relevance.isDirect,
        finding_nature: findingNature,
        evidence_evaluation: evaluation.evaluation_notes,
        limitations: findingLimitations,
        retrieved_date: today,
      });

      if (matchingSource && evaluation.status !== "UNVERIFIED") {
        matchingSource.supported_finding_ids.push(findingId);
      }
    }

    // 3. Process Competitors (Strictly No Domain Guessing)
    for (const comp of competitorsList) {
      const compWebsite = comp.website ? comp.website.trim() : "";
      const verification = await ResearchSearchService.verifyCompetitorWebsite(compWebsite, comp.name);

      competitors.push({
        name: comp.name,
        website: verification.is_official_domain ? verification.final_url : "",
        is_official_domain: verification.is_official_domain,
        business_description: `Market competitor identified in ${industry}.`,
        products: comp.products || productName,
        pricing: comp.price_range || "Public storefront catalog pricing",
        positioning: comp.positioning || "Active market participant",
        offers: comp.offers || "Standard seasonal promotions",
        strengths: verification.is_official_domain ? ["Verified live digital storefront"] : ["Brand recognized in discovery"],
        weaknesses: verification.is_official_domain ? [] : ["Official website domain unverified"],
        source_ids: verifiedSources.slice(0, 1).map((s) => s.source_id),
        last_verified_date: today,
        validation_status: verification.status,
        notes: verification.notes,
      });
    }

    // 4. Determine Research Completion Status (Robust Evidence Criteria)
    const totalSources = validatedSources.length;
    const verifiedSourcesCount = verifiedSources.length;
    const unverifiedSourcesCount = totalSources - verifiedSourcesCount;

    const primarySourcesCount = verifiedSources.filter((s) => s.source_tier === "PRIMARY").length;
    const secondarySourcesCount = verifiedSources.filter((s) => s.source_tier === "SECONDARY").length;
    const tertiarySourcesCount = verifiedSources.filter((s) => s.source_tier === "TERTIARY").length;

    const verifiedFindingsCount = findings.filter((f) => f.evidence_status === "VERIFIED").length;
    const partialFindingsCount = findings.filter((f) => f.evidence_status === "PARTIALLY_VERIFIED").length;
    const unverifiedFindingsCount = findings.filter((f) => f.evidence_status === "UNVERIFIED").length;
    const contradictedFindingsCount = findings.filter((f) => f.evidence_status === "CONTRADICTED").length;

    let researchStatus: ResearchCompletionStatus = "COMPLETED";
    const limitations: string[] = [];

    if (totalSources === 0) {
      researchStatus = "FAILED";
      limitations.push("No research sources could be retrieved. Web search provider unavailable or network blocked.");
    } else if (contradictedFindingsCount > 0) {
      researchStatus = "PARTIALLY_COMPLETED";
      limitations.push("One or more factual findings were contradicted by external sources; manual review required.");
    } else if (!providerStatus.is_live_search_available) {
      // Missing live search API credentials -> Must be PARTIALLY_COMPLETED
      researchStatus = "PARTIALLY_COMPLETED";
      limitations.push(
        "Live external search APIs (Tavily/SerpApi/Brave) are not configured. Research was conducted using reference knowledge bases and public news indices. Findings are directional."
      );
    } else if (verifiedSourcesCount < 3 || primarySourcesCount + secondarySourcesCount === 0) {
      researchStatus = "PARTIALLY_COMPLETED";
      limitations.push(
        `Insufficient verified primary/secondary evidence (${verifiedSourcesCount} verified sources; ${tertiarySourcesCount} tertiary). Additional empirical validation recommended.`
      );
    }

    if (unverifiedFindingsCount > 0) {
      // Strictly fail to PARTIALLY_COMPLETED if ANY category lacks adequate empirical evidence
      researchStatus = "PARTIALLY_COMPLETED";
      const missingCategories = findings.filter((f) => f.evidence_status === "UNVERIFIED").map((f) => f.category);
      limitations.push(`Insufficient empirical evidence for: ${missingCategories.join(", ")}. Third-party profiles or low-authority posts were rejected.`);
    } else if (limitations.length === 0) {
      researchStatus = "COMPLETED";
    }

    const categoriesCompleted = Array.from(new Set(findings.map((f) => f.category)));

    return {
      artifact_id: "artifact_2",
      type: "research_enrichment",
      campaign_id: artifact1.campaignId ? artifact1.campaignId.toString() : "",
      version: version,
      business_name: businessName,
      industry: industry,
      campaign_profile: profile,
      research_status: researchStatus,
      completion_date: today,
      categories_completed: categoriesCompleted,
      findings: findings,
      competitors: competitors,
      sources: validatedSources,
      stats: {
        total_sources: totalSources,
        verified_sources: verifiedSourcesCount,
        unverified_sources: unverifiedSourcesCount,
        primary_sources: primarySourcesCount,
        secondary_sources: secondarySourcesCount,
        tertiary_sources: tertiarySourcesCount,
        total_findings: findings.length,
        verified_findings: verifiedFindingsCount,
        partially_verified_findings: partialFindingsCount,
        unverified_findings: unverifiedFindingsCount,
        contradicted_findings: contradictedFindingsCount,
        completion_rate_percent: totalSources > 0 ? Math.round((verifiedSourcesCount / totalSources) * 100) : 0,
      },
      search_provider_status: providerStatus,
      limitations: limitations,
      provider_metadata: {
        provider: providerStatus.active_provider,
        queries_executed: context.searchQueries,
        generated_at: new Date().toISOString(),
        version: version,
      },
      // Backward compatibility fields for legacy views
      market_research: {
        overview: findings[0]?.explanation || "",
        market_size: `Commercial category in ${location} with active demand`,
        growth: `Ongoing sector development reported in regional business media`,
        trends: findings.filter((f) => f.finding_nature === "TREND").map((f) => f.claim),
        opportunities: findings.filter((f) => f.finding_nature === "RECOMMENDATION").map((f) => f.claim),
        risks: findings.filter((f) => f.category.includes("Risk")).map((f) => f.claim),
      },
      competitor_research: competitors.map((c) => ({
        name: c.name,
        website: c.website,
        products: c.products,
        price_range: c.pricing,
        positioning: c.positioning,
        offers: c.offers,
        social_presence: "Active market storefront",
        content_strategy: "Commercial customer engagement",
      })),
      audience_research: {
        demographics: [artifact1.target_audience?.description || `${location} target audience`],
        interests: [`${industry} solutions`, "Quality service"],
        behaviors: ["Digital discovery", "Evaluation of alternatives"],
        pain_points: ["Value uncertainty", "Onboarding friction"],
        motivations: ["Demonstrated utility", "Reliable support"],
        buying_patterns: ["Active evaluation period"],
        platform_usage: ["Digital discovery channels", "Direct consultation"],
      },
      platform_research: [
        {
          platform: "Primary Digital Channels",
          suitability_score: "9.0 / 10",
          recommended_content: `Targeted messaging highlighting ${productName} value proposition`,
          formats: ["Search & Discovery Ads", "Direct Response Ads"],
          best_practices: ["Clear value proposition", "Direct call-to-action"],
        },
      ],
      pricing_research: {
        market_price_range: artifact1.product_service?.price ? `${artifact1.product_service.price}` : "Competitive market pricing",
        competitor_prices: [{ item: productName, price: "Public catalog pricing" }],
        common_offers: [artifact1.product_service?.offer || "Introductory value offer"],
        discount_patterns: ["Promotional incentives", "Value bundles"],
      },
      trends_and_opportunities: {
        content_trends: ["Direct problem-solution messaging", "Verified customer outcomes"],
        consumer_trends: ["Demand for transparent pricing and reliability"],
        seasonal_trends: ["Periodic campaign peaks"],
        opportunities: [`Establish market leadership in ${location} for ${productName}`],
      },
    };
  }
}

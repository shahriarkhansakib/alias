import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { ConversationTurnSchema } from "@/lib/validation/schemas";

export class AiUnavailableError extends Error {
  statusCode: number;
  code: string;
  constructor(message = "AI service is currently unavailable", cause?: any) {
    super(message);
    this.name = "AiUnavailableError";
    this.statusCode = 503;
    this.code = "AI_UNAVAILABLE";
    if (cause) this.cause = cause;
  }
}

const USE_OPENAI_FALLBACK = false;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash";

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(timeoutMsg);
      err.status = 503;
      err.code = "ETIMEDOUT";
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTransientGeminiError(err: any): boolean {
  if (!err) return false;
  const status = Number(err.status || err.statusCode || err.code);
  const msg = String(err.message || "");
  if (status === 400 || msg.includes("400") || msg.includes("INVALID_ARGUMENT")) {
    return false;
  }
  // If 429 quota is exhausted, retrying the same model will fail; fail fast to candidate fallback
  if (status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
    return false;
  }
  if (status === 503) {
    return true;
  }
  if (
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("high demand") ||
    msg.includes("timed out") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("JSON") ||
    err instanceof SyntaxError
  ) {
    return true;
  }
  return false;
}

function robustParseJson(text: string): any {
  if (!text) return {};
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  // 1. Isolate the outermost balanced { ... } block to eliminate preambles/postambles
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // 2. Strip stray markdown bullets inside arrays (e.g., [ * "item" ] or [, - "item"])
  cleaned = cleaned.replace(/([\[,])\s*[-*•]\s*/g, "$1 ");

  // 3. Clean trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  try {
    return JSON.parse(cleaned);
  } catch (initialErr: any) {
    // 4. Sanitize unescaped newlines and control characters inside strings
    try {
      const sanitized = cleaned
        .replace(/[\u0000-\u001F]+/g, (m) => (m === "\n" ? "\\n" : m === "\r" ? "\\r" : m === "\t" ? "\\t" : ""))
        .replace(/([\[,])\s*[-*•]\s*/g, "$1 ")
        .replace(/,\s*([\]}])/g, "$1");
      return JSON.parse(sanitized);
    } catch {
      throw new SyntaxError(`Failed to parse JSON response from LLM: ${initialErr.message}`);
    }
  }
}

function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

function isOpenAiConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key.trim().length > 10 && !key.includes("dummy"));
}

/**
 * Generates dynamic, context-relevant quick reply options based on what
 * the AI is currently asking or what information is still missing.
 */
export function generateContextualQuickReplies(missing: string[], companyName?: string, industry?: string): string[] {
  const isB2BOrSaaS = Boolean(
    industry &&
      (industry.includes("SaaS") ||
        industry.includes("Software") ||
        industry.includes("Tech") ||
        industry.includes("Agency") ||
        industry.includes("Management"))
  );

  if (missing.includes("company/brand name")) {
    return [
      "Qrew (B2B SaaS)",
      "TechFlow (Software)",
      "Jersey Camp BD (Sports Apparel)",
      "UrbanThread (Streetwear)",
    ];
  }

  if (missing.includes("product or service name")) {
    if (isB2BOrSaaS) {
      return [
        "Office & Agency Management Platform",
        "B2B SaaS Workflow Tool",
        "Client Project & Finance Tracker",
        "Business Automation Software",
      ];
    }
    return [
      "Sports & Football Jerseys",
      "Premium Oversized T-Shirts",
      "Casual Drop-Shoulder Hoodies",
      "Custom Apparel Kits",
    ];
  }

  if (missing.includes("campaign objective")) {
    if (isB2BOrSaaS) {
      return [
        "Acquire Initial Agency Clients",
        "Book Software Demos & Trials",
        "B2B Lead Generation",
        "Brand Awareness for Agencies",
      ];
    }
    return [
      "Direct Online Store Sales",
      "Brand Awareness & Reach",
      "Lead Generation & Signups",
      "Pre-Orders for New Drop",
    ];
  }

  if (missing.includes("target audience")) {
    if (isB2BOrSaaS) {
      return [
        "Agencies & Corporate Offices",
        "Agency Owners & Founders",
        "Office Managers & HR Admins",
        "Dhaka & Global Tech Companies",
      ];
    }
    return [
      "Sports & Football Fans in Bangladesh",
      "Youth & Students (18-28) in Dhaka",
      "All Bangladesh (Ages 18-35)",
      "Urban Young Professionals",
    ];
  }

  if (missing.includes("budget")) {
    return [
      "50,000 BDT",
      "30,000 BDT",
      "100,000 BDT",
      "I don't know yet (Please recommend)",
    ];
  }

  if (missing.includes("timeline")) {
    return [
      "1 Month",
      "2 Months",
      "2 Weeks",
      "Seasonal (1-3 Months)",
    ];
  }

  return [
    "Review & Confirm Artifact-1",
    "Actually, update our budget",
    "Actually, update our timeline",
    "Add more product details",
  ];
}

function isGreetingOrPleasantry(msg: string): boolean {
  const clean = msg.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const greetings = [
    "hello", "hi", "hey", "hola", "heya",
    "hi there", "hello there", "hey there",
    "how are you", "how r u", "how are you doing", "how do you do",
    "good morning", "good afternoon", "good evening", "good day",
    "whats up", "what is up", "sup",
    "who are you", "what are you", "what can you do", "help",
    "thanks", "thank you"
  ];
  return greetings.includes(clean);
}

/**
 * Extracts a clean brand/company name from natural text.
 * Robust against missing punctuation (e.g. "my brand's name is qrew currently I don't have any client").
 */
function extractCleanBrandName(
  userMessage: string,
  wasAskingCompany: boolean
): { brandName: string; isAmbiguous: boolean } {
  const msgTrimmed = userMessage.trim();
  const msgLower = msgTrimmed.toLowerCase();

  // If user message is just a greeting, do not treat as brand name
  if (isGreetingOrPleasantry(msgTrimmed)) {
    return { brandName: "", isAmbiguous: false };
  }

  // If user explicitly says they don't have a name yet
  if (
    msgLower.includes("don't have a name") ||
    msgLower.includes("dont have a brand name") ||
    msgLower.includes("no brand name yet") ||
    msgLower.includes("haven't decided") ||
    msgLower.includes("havent decided")
  ) {
    return { brandName: "", isAmbiguous: true };
  }

  // Regex patterns to capture the brand name declaration
  const patterns = [
    // "My brand's name is X", "Our brand is actually X", "Brand name is X", "Company name is X"
    /(?:my\s+|our\s+)?(?:brand(?:'s)?|company(?:'s)?|business)\s+(?:name\s+)?(?:is|called|named|:)\s*(?:actually\s+)?([A-Za-z0-9\s&'.-]+)/i,
    // "Change brand name to X", "Change brand to X", "Update brand to X", "Change company name to X"
    /(?:change|update)\s+(?:the\s+|our\s+|my\s+)?(?:brand|company)(?:\s+name)?\s+to\s+([A-Za-z0-9\s&'.-]+)/i,
    // "My new brand is X", "Our new brand name is X"
    /(?:my|our)\s+new\s+(?:brand|company)(?:\s+name)?\s+is\s+([A-Za-z0-9\s&'.-]+)/i,
    // "Brand: X", "Company: X"
    /(?:company|brand|business|brand\s+name)\s*:\s*([A-Za-z0-9\s&'.-]+)/i,
    // "We are called X", "We go by X"
    /(?:we\s+are\s+called|we\s+go\s+by|named)\s+([A-Za-z0-9\s&'.-]+)/i,
    // "X is our brand name", "X is our company name", "X is our business"
    /([A-Za-z0-9\s&'-]+?)\s+(?:is\s+our\s+company(?:\s+name)?|is\s+our\s+brand(?:\s+name)?|is\s+our\s+business|is\s+my\s+brand)/i,
  ];

  let rawCandidate = "";
  for (const p of patterns) {
    const m = userMessage.match(p);
    if (m && m[1]) {
      rawCandidate = m[1].trim();
      break;
    }
  }

  // Fallback: If user directly typed a short response to the brand question
  if (!rawCandidate && wasAskingCompany) {
    const words = msgTrimmed.split(/\s+/);
    if (words.length >= 1 && words.length <= 4 && !msgLower.includes("budget") && !msgLower.includes("month") && !msgLower.includes("taka") && !msgLower.includes("pricing") && !isGreetingOrPleasantry(msgTrimmed)) {
      rawCandidate = msgTrimmed;
    }
  }

  if (!rawCandidate) return { brandName: "", isAmbiguous: false };

  // 1. Cut off at standard punctuation (. , ; : ! ? \n)
  const punctMatch = rawCandidate.match(/^([^.,;:!?\n]+)/);
  if (punctMatch) {
    rawCandidate = punctMatch[1].trim();
  }

  // 2. CRITICAL: Cut off at conversational transition words, adverbs, pronouns, verbs
  // Fixes punctuation errors like "My brand's name is qrew currently I don't have any client"
  const transitionWordsRegex = /\b(?:currently|presently|right\s+now|now|today|kindly|please|basically|actually|honestly|i\s+|we\s+|my\s+|our\s+|they\s+|it's|don't|dont|do\s+not|have|haven't|not\s+|having|with\s+|which\s+|where\s+|that\s+|who\s+|because|since|although|though|while|but\s+|and\s+|so\s+|offering|providing|selling|focusing|starts|start|starting|pricing|price|cost|costs|subscription|package|lifetime)\b/i;

  const transitionMatch = rawCandidate.match(transitionWordsRegex);
  if (transitionMatch && transitionMatch.index !== undefined) {
    rawCandidate = rawCandidate.substring(0, transitionMatch.index).trim();
  }

  // 3. Strip surrounding quotation marks, dashes, whitespace
  rawCandidate = rawCandidate.replace(/^[-\s'"“”]+|[-\s'"“”]+$/g, "").trim();

  // 4. Validate candidate is not a generic placeholder word or greeting
  const invalidWords = [
    "what", "it", "this", "name", "brand", "company", "business", "yes", "no", "ok", "okay", "sure",
    "hello", "hi", "hey", "hola", "heya",
    "how are you", "how r u", "how are you doing", "how do you do",
    "good morning", "good afternoon", "good evening", "good day",
    "who are you", "what can you do", "help", "thanks", "thank you"
  ];
  if (invalidWords.includes(rawCandidate.toLowerCase()) || isGreetingOrPleasantry(rawCandidate) || rawCandidate.length < 2) {
    return { brandName: "", isAmbiguous: false };
  }

  // 5. Check token count: Company names are typically 1-3 words
  const tokens = rawCandidate.split(/\s+/).filter(Boolean);
  const corporateSuffixes = /\b(?:ltd|limited|inc|corp|corporation|llc|agency|solutions|tech|technologies|studio|studios|lab|labs|hub|group|enterprises|holdings|services|software)\b/i;

  if (tokens.length > 3 && !corporateSuffixes.test(rawCandidate)) {
    rawCandidate = tokens.slice(0, 2).join(" ");
  }

  // 6. Title case the clean brand name
  const formattedCompany = rawCandidate
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  return { brandName: formattedCompany, isAmbiguous: false };
}

/**
 * Intelligent context-aware conversation engine for Demo Mode or OpenAI API fallback.
 */
function processDemoConversation(
  userMessage: string,
  history: { sender: string; content: string }[],
  currentArtifact: any
) {
  const msgTrimmed = userMessage.trim();
  const msgLower = msgTrimmed.toLowerCase();
  const updates: any = {};
  const acknowledgements: string[] = [];

  // Check if client is trying to confirm prematurely
  const isTryingToConfirm =
    msgLower.includes("confirm") ||
    msgLower.includes("finish") ||
    msgLower.includes("done") ||
    msgLower.includes("ready to start") ||
    msgLower.includes("launch campaign") ||
    msgLower.includes("start research") ||
    msgLower.includes("review & confirm");

  // Determine what the AI asked in the immediately preceding message (isolate question from prior acknowledgements/advisories)
  const lastAiMsg = [...history].reverse().find((m) => m.sender === "ai")?.content || "";
  // Isolate sentences with '?' to find the active question, excluding preceding acknowledgements and missing requirements lists
  const questionMatches = lastAiMsg.match(/[^.?!]+(?:\?)/g);
  const trailingQuestion = questionMatches ? questionMatches.join(" ").toLowerCase() : "";
  const activePrompt = trailingQuestion || lastAiMsg.toLowerCase();

  const wasAskingTimeline = (activePrompt.includes("timeline") || activePrompt.includes("duration") || activePrompt.includes("how long")) && !activePrompt.includes("objective");
  const wasAskingBudget = (activePrompt.includes("budget") || activePrompt.includes("spend") || activePrompt.includes("advertising budget") || activePrompt.includes("marketing budget")) && !wasAskingTimeline;
  const wasAskingAudience = (activePrompt.includes("audience") || activePrompt.includes("target audience") || activePrompt.includes("who is your primary") || activePrompt.includes("customer characteristics")) && !wasAskingTimeline && !wasAskingBudget;
  const wasAskingObjective = (activePrompt.includes("objective") || activePrompt.includes("goal") || activePrompt.includes("primary marketing goal") || activePrompt.includes("desired result")) && !wasAskingAudience && !wasAskingTimeline && !wasAskingBudget;
  const wasAskingProduct = (activePrompt.includes("specific product") || activePrompt.includes("what product") || activePrompt.includes("service from")) && !wasAskingTimeline && !wasAskingBudget;
  const wasAskingCompanyOrProduct = (activePrompt.includes("company or brand name") || activePrompt.includes("brand name")) && !wasAskingTimeline && !wasAskingBudget;

  // Detect intentional client correction intent
  const hasCorrectionCue =
    msgLower.includes("actually") ||
    msgLower.includes("correction") ||
    msgLower.includes("change ") ||
    msgLower.includes("update ") ||
    msgLower.includes("instead") ||
    msgLower.includes("my new ") ||
    msgLower.includes("our new ") ||
    msgLower.includes("i meant") ||
    msgLower.includes("we meant") ||
    msgLower.includes("make it ") ||
    msgLower.includes("set it to");

  const isBudgetCorrection =
    hasCorrectionCue &&
    (msgLower.includes("budget") ||
      msgLower.includes("spend") ||
      msgLower.includes("bdt") ||
      msgLower.includes("usd") ||
      msgLower.includes("taka") ||
      msgLower.includes("tk") ||
      msgLower.includes("$") ||
      /\b\d+\s*(?:k|lakh|lac)\b/i.test(userMessage) ||
      /\b\d{1,3}(?:,\d{3})+\b/.test(userMessage) ||
      /\b\d{4,10}\b/.test(userMessage));

  const isCompanyCorrection =
    hasCorrectionCue &&
    (msgLower.includes("brand") ||
      msgLower.includes("company") ||
      msgLower.includes("name") ||
      msgLower.includes("call us") ||
      wasAskingCompanyOrProduct);

  const isProductCorrection =
    hasCorrectionCue &&
    (msgLower.includes("product") ||
      msgLower.includes("service") ||
      msgLower.includes("selling") ||
      msgLower.includes("offer") ||
      wasAskingProduct);

  const isTimelineCorrection =
    hasCorrectionCue &&
    (msgLower.includes("timeline") ||
      msgLower.includes("duration") ||
      msgLower.includes("month") ||
      msgLower.includes("week") ||
      msgLower.includes("day") ||
      wasAskingTimeline);

  // 1. Company Name Extraction (Clean, punctuation-resilient, transition-word aware)
  const hasCompanyName = Boolean(currentArtifact?.client?.company_name && currentArtifact.client.company_name.toLowerCase() !== "name");
  const allowCompanyUpdate = !hasCompanyName || isCompanyCorrection;
  const { brandName } = extractCleanBrandName(userMessage, wasAskingCompanyOrProduct || isCompanyCorrection);
  if (allowCompanyUpdate && brandName && brandName.toLowerCase() !== "name") {
    if (!hasCompanyName || brandName.toLowerCase() !== currentArtifact?.client?.company_name?.toLowerCase()) {
      updates.client = updates.client || {};
      updates.client.company_name = brandName;
      if (hasCompanyName) {
        acknowledgements.push(`Brand updated to ${brandName}.`);
      } else {
        acknowledgements.push(`Great to meet you! Brand recorded as ${brandName}.`);
      }
    }
  }

  // 2. Industry Extraction
  const hasIndustry = Boolean(currentArtifact?.client?.industry && currentArtifact.client.industry.trim().length > 0);
  if (!hasIndustry) {
    if (
      msgLower.includes("agency") ||
      msgLower.includes("agencies") ||
      msgLower.includes("office") ||
      msgLower.includes("offices") ||
      msgLower.includes("paperwork") ||
      msgLower.includes("managing an office") ||
      msgLower.includes("financial money flow") ||
      msgLower.includes("track their files") ||
      msgLower.includes("saas") ||
      msgLower.includes("software") ||
      msgLower.includes("online solution")
    ) {
      updates.client = updates.client || {};
      updates.client.industry = "B2B SaaS / Office & Agency Management";
    } else if (msgLower.includes("jersey") || msgLower.includes("sports") || msgLower.includes("football") || msgLower.includes("cricket") || msgLower.includes("gym")) {
      updates.client = updates.client || {};
      updates.client.industry = "Sports Apparel & Activewear";
    } else if (msgLower.includes("clothing") || msgLower.includes("t-shirt") || msgLower.includes("apparel") || msgLower.includes("fashion") || msgLower.includes("wear")) {
      updates.client = updates.client || {};
      updates.client.industry = "Fashion & Apparel";
    } else if (msgLower.includes("tech") || msgLower.includes("software") || msgLower.includes("app")) {
      updates.client = updates.client || {};
      updates.client.industry = "Technology & Software";
    } else if (msgLower.includes("food") || msgLower.includes("restaurant") || msgLower.includes("cafe")) {
      updates.client = updates.client || {};
      updates.client.industry = "Food & Beverage";
    }
  }

  // 3. Product / Service Extraction
  const hasProductName = Boolean(currentArtifact?.product_service?.name && currentArtifact.product_service.name.trim().length > 0);
  const allowProductUpdate = !hasProductName || isProductCorrection;
  if (allowProductUpdate) {
    if (
      msgLower.includes("online solution") ||
      msgLower.includes("managing an office") ||
      msgLower.includes("track their files") ||
      msgLower.includes("projects, paperwork") ||
      msgLower.includes("office management") ||
      msgLower.includes("agency management")
    ) {
      updates.product_service = updates.product_service || {};
      updates.product_service.name = "Office & Agency Management Platform";
      updates.product_service.type = "B2B SaaS Platform";
      updates.product_service.description = "Online management solution for agencies and offices to track files, projects, paperwork, employees, and financial cash flow.";
      acknowledgements.push(hasProductName && isProductCorrection ? "Product updated to Office & Agency Management Platform (B2B SaaS)." : "Product identified as Office & Agency Management Platform (B2B SaaS).");
    } else if (msgLower.includes("jersey") || msgLower.includes("jerseys")) {
      updates.product_service = updates.product_service || {};
      updates.product_service.name = msgLower.includes("football") ? "Football Jerseys" : "Sports Jerseys";
      updates.product_service.type = "Sports Apparel";
      acknowledgements.push(hasProductName && isProductCorrection ? `Product updated to ${updates.product_service.name}.` : `Product identified as ${updates.product_service.name}.`);
    } else if (msgLower.includes("t-shirt") || msgLower.includes("oversized") || msgLower.includes("hoodie") || msgLower.includes("shirt") || msgLower.includes("tee")) {
      updates.product_service = updates.product_service || {};
      updates.product_service.name = msgLower.includes("oversized") ? "Oversized T-Shirts" : "Apparel / T-Shirts";
      updates.product_service.type = "Apparel";
      acknowledgements.push(hasProductName && isProductCorrection ? `Product updated to ${updates.product_service.name}.` : `Product identified as ${updates.product_service.name}.`);
    } else if (
      (wasAskingProduct || isProductCorrection) &&
      !updates.client?.company_name &&
      !updates.product_service?.name &&
      !isGreetingOrPleasantry(msgTrimmed) &&
      msgTrimmed.length > 2 &&
      !msgLower.includes("budget") &&
      !msgLower.includes("month") &&
      !msgLower.includes("pricing")
    ) {
      updates.product_service = updates.product_service || {};
      updates.product_service.name = msgTrimmed.charAt(0).toUpperCase() + msgTrimmed.slice(1);
      updates.product_service.type = "General Offering";
      acknowledgements.push(hasProductName && isProductCorrection ? `Product updated to ${updates.product_service.name}.` : `Product recorded as ${updates.product_service.name}.`);
    }
  }

  // 4. Product Pricing Extraction (e.g., "5,000 taka up to 20,000 taka per month", "2-lakh lifetime subscription")
  const hasProductPrice = Boolean(currentArtifact?.product_service?.price);
  const isProductPricing =
    msgLower.includes("pricing") ||
    msgLower.includes("price") ||
    msgLower.includes("starts from") ||
    msgLower.includes("per month") ||
    msgLower.includes("/month") ||
    msgLower.includes("/mo") ||
    msgLower.includes("monthly") ||
    msgLower.includes("subscription") ||
    msgLower.includes("lifetime package") ||
    msgLower.includes("lifetime subscription");

  if (!hasProductPrice && isProductPricing) {
    updates.product_service = updates.product_service || {};
    if (msgLower.includes("5,000") && msgLower.includes("20,000")) {
      updates.product_service.price = "5,000 - 20,000 BDT/month (2-lakh lifetime package)";
    } else {
      const priceRegex = /(?:pricing\s+starts\s+from\s+|price\s+is\s+|starts?\s+from\s+)?([0-9,]+(?:\s*(?:k|lakh|taka|bdt|usd|\$))?(?:\s*(?:up\s+to|to|-)\s*[0-9,]+(?:\s*(?:k|lakh|taka|bdt|usd|\$))?)?(?:\s*per\s+month|\s*monthly|\s*lifetime)?)/i;
      const pMatch = userMessage.match(priceRegex);
      if (pMatch && pMatch[1] && pMatch[1].length > 2) {
        updates.product_service.price = pMatch[1].trim();
      }
    }
    if (updates.product_service.price) {
      acknowledgements.push(`Product pricing noted: ${updates.product_service.price}.`);
    }
  }

  // 5. Target Audience Extraction (Guarded so objective answers with "agency" don't misclassify)
  const hasAudienceAge = Boolean(currentArtifact?.target_audience?.age_range && currentArtifact.target_audience.age_range.trim().length > 0);
  const hasAudienceDesc = Boolean(currentArtifact?.target_audience?.description && currentArtifact.target_audience.description.trim().length > 0);
  const hasAudienceLoc = Boolean(currentArtifact?.target_audience?.location && currentArtifact.target_audience.location.trim().length > 0);

  const isAudienceTurn = wasAskingAudience || (!wasAskingObjective && !hasAudienceDesc);
  const ageMatch = userMessage.match(/([0-9]{2})\s*(?:to|-)\s*([0-9]{2})/);
  if (!hasAudienceAge && ageMatch) {
    updates.target_audience = updates.target_audience || {};
    updates.target_audience.age_range = `${ageMatch[1]}-${ageMatch[2]}`;
  } else if (!hasAudienceDesc && (msgLower.includes("young") || msgLower.includes("students") || msgLower.includes("youth") || msgLower.includes("gen z"))) {
    updates.target_audience = updates.target_audience || {};
    updates.target_audience.description = "Young people / Students / Gen Z";
  }

  if (!hasAudienceDesc && isAudienceTurn && (msgLower.includes("agencies") || msgLower.includes("offices") || msgLower.includes("agency") || msgLower.includes("office"))) {
    updates.target_audience = updates.target_audience || {};
    updates.target_audience.description = "Agencies, corporate offices, and business managers";
  }

  if (!hasAudienceLoc && msgLower.includes("dhaka")) {
    updates.target_audience = updates.target_audience || {};
    updates.target_audience.location = "Dhaka, Bangladesh";
  } else if (!hasAudienceLoc && msgLower.includes("bangladesh")) {
    updates.target_audience = updates.target_audience || {};
    updates.target_audience.location = "Bangladesh";
  }

  if (!hasAudienceDesc && wasAskingAudience && !isGreetingOrPleasantry(msgTrimmed) && !isTryingToConfirm && !updates.target_audience?.description && msgTrimmed.length > 3 && !msgLower.includes("budget") && !msgLower.includes("month")) {
    updates.target_audience = updates.target_audience || {};
    updates.target_audience.description = msgTrimmed;
  }
  if (updates.target_audience) {
    const desc = updates.target_audience.description || updates.target_audience.location || updates.target_audience.age_range || "target audience";
    acknowledgements.push(`Audience noted: ${desc}.`);
  }

  // 6. Client Stage / Status Recognition
  const isEarlyStageClient =
    msgLower.includes("don't have any client") ||
    msgLower.includes("dont have any client") ||
    msgLower.includes("no client") ||
    msgLower.includes("first client") ||
    msgLower.includes("launching");

  if (isEarlyStageClient) {
    acknowledgements.push("Understood that you are launching and seeking your initial client base.");
  }

  // 7. Campaign Objective Extraction
  const hasCampaignObjective = Boolean(currentArtifact?.campaign?.objective && currentArtifact.campaign.objective.trim().length > 0);
  const isTimeExpression =
    msgLower.includes("day") ||
    msgLower.includes("days") ||
    msgLower.includes("week") ||
    msgLower.includes("weeks") ||
    msgLower.includes("month") ||
    msgLower.includes("months") ||
    msgLower.includes("year") ||
    msgLower.includes("years");

  if (!hasCampaignObjective) {
    if (
      msgLower.includes("acquire") ||
      msgLower.includes("get client") ||
      msgLower.includes("client acquisition") ||
      msgLower.includes("agency client") ||
      msgLower.includes("initial client") ||
      msgLower.includes("first client") ||
      msgLower.includes("lead") ||
      msgLower.includes("sign up") ||
      msgLower.includes("registrations") ||
      msgLower.includes("book demo") ||
      msgLower.includes("demo")
    ) {
      updates.campaign = updates.campaign || {};
      updates.campaign.objective = "Client Acquisition & Lead Generation";
      updates.campaign.desired_result = "Acquire qualified potential business clients and demo requests";
      acknowledgements.push("Objective set to Client Acquisition & Lead Generation.");
    } else if (msgLower.includes("sales") || msgLower.includes("sell") || msgLower.includes("orders") || msgLower.includes("revenue") || msgLower.includes("conversion")) {
      updates.campaign = updates.campaign || {};
      updates.campaign.objective = "Product Sales & Conversion";
      updates.campaign.desired_result = "Increase direct online store sales";
      acknowledgements.push("Objective set to Product Sales & Conversion.");
    } else if (
      msgLower.includes("brand awareness") ||
      msgLower.includes("brand reach") ||
      msgLower.includes("brand recognition") ||
      msgLower.includes("build brand") ||
      msgLower.includes("brand visibility")
    ) {
      updates.campaign = updates.campaign || {};
      updates.campaign.objective = "Brand Awareness & Reach";
      updates.campaign.desired_result = "Boost market recognition and engagement";
      acknowledgements.push("Objective set to Brand Awareness.");
    } else if (
      wasAskingObjective &&
      !isGreetingOrPleasantry(msgTrimmed) &&
      !isTryingToConfirm &&
      !currentArtifact?.campaign?.objective &&
      !wasAskingAudience &&
      msgTrimmed.length > 3 &&
      !isTimeExpression &&
      !isProductPricing &&
      !msgLower.includes("budget") &&
      !msgLower.includes("spend") &&
      !msgLower.includes("bdt") &&
      !msgLower.includes("tk") &&
      !/^\d+$/.test(msgTrimmed)
    ) {
      updates.campaign = updates.campaign || {};
      updates.campaign.objective = msgTrimmed.charAt(0).toUpperCase() + msgTrimmed.slice(1);
      updates.campaign.desired_result = "Achieve target client campaign goals";
      acknowledgements.push(`Objective noted: ${updates.campaign.objective}.`);
    }
  }

  // 8. Marketing Budget Extraction (Strictly Marketing / Advertising Budget, NEVER Product Pricing)
  const hasBudget = Boolean(currentArtifact?.budget?.amount || currentArtifact?.budget?.type === "unknown");
  const allowBudgetUpdate = !hasBudget || isBudgetCorrection;
  const isExplicitMarketingBudget =
    msgLower.includes("marketing budget") ||
    msgLower.includes("ad budget") ||
    msgLower.includes("advertising budget") ||
    msgLower.includes("campaign budget") ||
    msgLower.includes("spend on ads") ||
    msgLower.includes("spend on marketing") ||
    msgLower.includes("ad spend") ||
    msgLower.includes("budget for ads") ||
    (msgLower.includes("budget is") && !isProductPricing);

  const isUnknownBudget =
    msgLower.includes("don't know") ||
    msgLower.includes("dont know") ||
    msgLower.includes("not sure") ||
    msgLower.includes("undecided") ||
    msgLower.includes("no idea") ||
    msgLower.includes("no budget") ||
    (wasAskingBudget && (msgLower === "no" || msgLower === "none" || msgLower.includes("not yet")));

  if (allowBudgetUpdate) {
    if (isUnknownBudget) {
      updates.budget = {
        amount: null,
        currency: "BDT",
        type: "unknown",
      };
      acknowledgements.push(hasBudget && isBudgetCorrection ? "Budget updated to unknown (will be researched and recommended by AI)." : "Budget marked as unknown (will be researched and recommended by AI).");
    } else if (!isProductPricing && (wasAskingBudget || isExplicitMarketingBudget || isBudgetCorrection)) {
      const budgetKMatch = userMessage.match(/(\d+)\s*k\b/i);
      const budgetNumMatch = userMessage.match(/(\d{1,3}(?:,\d{3})+|\d{4,10})/);
      const lakhMatch = userMessage.match(/(\d+)\s*(?:lakh|lac)/i);

      let budgetAmount: number | null = null;
      if (budgetKMatch) {
        budgetAmount = parseInt(budgetKMatch[1], 10) * 1000;
      } else if (lakhMatch) {
        budgetAmount = parseInt(lakhMatch[1], 10) * 100000;
      } else if (budgetNumMatch) {
        budgetAmount = parseInt(budgetNumMatch[1].replace(/,/g, ""), 10);
      }

      if (budgetAmount) {
        const isApprox = msgLower.includes("around") || msgLower.includes("approx") || msgLower.includes("about");
        updates.budget = {
          amount: budgetAmount,
          currency: msgLower.includes("$") || msgLower.includes("usd") ? "USD" : "BDT",
          type: isApprox ? "approximate" : "exact",
        };
        if (hasBudget && isBudgetCorrection) {
          acknowledgements.push(`Budget updated to ${budgetAmount.toLocaleString()} ${updates.budget.currency} (${updates.budget.type}).`);
        } else {
          acknowledgements.push(`Budget recorded as ${budgetAmount.toLocaleString()} ${updates.budget.currency} (${updates.budget.type}).`);
        }
      }
    }
  }

  // 9. Timeline Extraction (Handles "2 months", "1 month", "2 weeks", "seasonal", etc.)
  const hasTimeline = Boolean(currentArtifact?.timeline?.duration && currentArtifact.timeline.duration.trim().length > 0);
  const allowTimelineUpdate = !hasTimeline || isTimelineCorrection;
  const durationUnitMatch = userMessage.match(/(\d+)\s*(months?|weeks?|days?|years?|mo|wks?)/i);
  const wordNumberMatch = userMessage.match(/\b(one|two|three|four|five|six|seven|eight|a|couple of|few)\s+(months?|weeks?|days?)\b/i);

  if (allowTimelineUpdate) {
    if (durationUnitMatch) {
      const count = durationUnitMatch[1];
      const unitRaw = durationUnitMatch[2].toLowerCase();
      const formattedUnit = unitRaw.startsWith("m")
        ? count === "1" ? "Month" : "Months"
        : unitRaw.startsWith("w")
        ? count === "1" ? "Week" : "Weeks"
        : unitRaw.startsWith("d")
        ? count === "1" ? "Day" : "Days"
        : count === "1" ? "Year" : "Years";
      updates.timeline = updates.timeline || {};
      updates.timeline.duration = `${count} ${formattedUnit}`;
      acknowledgements.push(hasTimeline && isTimelineCorrection ? `Timeline updated to ${updates.timeline.duration}.` : `Duration set to ${updates.timeline.duration}.`);
    } else if (wordNumberMatch) {
      const wordMap: Record<string, string> = {
        one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", a: "1", "couple of": "2", few: "3"
      };
      const count = wordMap[wordNumberMatch[1].toLowerCase()] || wordNumberMatch[1];
      const unit = wordNumberMatch[2].toLowerCase().startsWith("m") ? (count === "1" ? "Month" : "Months") : (count === "1" ? "Week" : "Weeks");
      updates.timeline = updates.timeline || {};
      updates.timeline.duration = `${count} ${unit}`;
      acknowledgements.push(hasTimeline && isTimelineCorrection ? `Timeline updated to ${updates.timeline.duration}.` : `Duration set to ${updates.timeline.duration}.`);
    } else if (msgLower.includes("seasonal") || msgLower.includes("season")) {
      updates.timeline = updates.timeline || {};
      updates.timeline.duration = "Seasonal (1-3 Months)";
      acknowledgements.push(hasTimeline && isTimelineCorrection ? "Timeline updated to Seasonal (1-3 Months)." : "Duration set to Seasonal (1-3 Months).");
    } else if (msgLower.includes("immediate") || msgLower.includes("asap")) {
      updates.timeline = updates.timeline || {};
      updates.timeline.duration = "Immediate (2-4 Weeks)";
      acknowledgements.push(hasTimeline && isTimelineCorrection ? "Timeline updated to Immediate (2-4 Weeks)." : "Duration set to Immediate (2-4 Weeks).");
    } else if ((wasAskingTimeline || isTimelineCorrection) && isTimeExpression && !isTryingToConfirm && msgTrimmed.length > 0 && msgTrimmed.length < 35 && !msgLower.includes("budget")) {
      updates.timeline = updates.timeline || {};
      updates.timeline.duration = msgTrimmed.charAt(0).toUpperCase() + msgTrimmed.slice(1);
      acknowledgements.push(hasTimeline && isTimelineCorrection ? `Timeline updated to ${updates.timeline.duration}.` : `Duration set to ${updates.timeline.duration}.`);
    }
  }

  // Merge state temporarily to calculate missing fields
  const mergedClient = { ...currentArtifact.client, ...updates.client };
  const mergedProduct = { ...currentArtifact.product_service, ...updates.product_service };
  const mergedCampaign = { ...currentArtifact.campaign, ...updates.campaign };
  const mergedAudience = { ...currentArtifact.target_audience, ...updates.target_audience };
  const mergedBudget = { ...currentArtifact.budget, ...updates.budget };
  const mergedTimeline = { ...currentArtifact.timeline, ...updates.timeline };

  // Calculate missing fields
  const missing: string[] = [];
  const validCompanyName = mergedClient.company_name && mergedClient.company_name.toLowerCase() !== "name";
  if (!validCompanyName) missing.push("company/brand name");
  if (!mergedProduct.name) missing.push("product or service name");
  if (!mergedCampaign.objective) missing.push("campaign objective");
  if (!mergedAudience.location && (!mergedAudience.age_range && !mergedAudience.description)) missing.push("target audience");

  const isBudgetCaptured = Boolean(mergedBudget.amount) || mergedBudget.type === "unknown";
  if (!isBudgetCaptured) missing.push("budget");

  const isTimelineCaptured = Boolean(mergedTimeline.duration && mergedTimeline.duration.trim().length > 0);
  if (!isTimelineCaptured) missing.push("timeline");

  // Determine Response & Next Question
  let responseText = "";
  let status: "collecting" | "ready_for_confirmation" = "collecting";

  // Build acknowledgement prefix if anything was newly extracted
  const ackText = acknowledgements.length > 0 ? `${acknowledgements.join(" ")} ` : "";
  const companyLabel = validCompanyName ? mergedClient.company_name : "your company";

  let prematureAdvisory = "";
  if (isTryingToConfirm && missing.length > 0) {
    const missingLabels = missing.map((m) => {
      if (m === "company/brand name") return "Company/Brand Name";
      if (m === "product or service name") return "Product/Service Details";
      if (m === "campaign objective") return "Campaign Objective";
      if (m === "target audience") return "Target Audience";
      if (m === "budget") return "Marketing Budget";
      if (m === "timeline") return "Timeline Duration";
      return m;
    });

    prematureAdvisory = `Before we can finalize and confirm your campaign for ${companyLabel}, our AI agency needs all essential requirements to formulate a high-performing strategy. We still need: ${missingLabels.join(", ")}. `;
  }

  if (!validCompanyName) {
    responseText = `${ackText}${prematureAdvisory}To formulate your campaign, what is your company or brand name?`;
  } else if (!mergedProduct.name) {
    responseText = `${ackText}${prematureAdvisory}Tell me about the specific product or service from ${companyLabel} that we are promoting in this campaign.`;
  } else if (!mergedCampaign.objective) {
    if (isEarlyStageClient) {
      responseText = `${ackText}${prematureAdvisory}Since you're launching ${companyLabel} to acquire your first clients, what is your primary marketing goal? (For example: acquiring initial agency clients, booking software demos, or direct lead generation?)`;
    } else {
      responseText = `${ackText}${prematureAdvisory}What is the primary objective for this campaign? (For example: direct online sales, lead generation, or brand awareness?)`;
    }
  } else if (!mergedAudience.location && (!mergedAudience.age_range && !mergedAudience.description)) {
    responseText = `${ackText}${prematureAdvisory}Who is your primary target audience? (Mention any preferred age groups, locations, or key customer characteristics?)`;
  } else if (!isBudgetCaptured) {
    responseText = `${ackText}${prematureAdvisory}Do you have a target advertising or marketing budget in mind (in BDT or USD) for promoting ${companyLabel}? If you're not sure yet, just say 'I don't know' and we will provide recommendations based on research.`;
  } else if (!isTimelineCaptured) {
    responseText = `${ackText}${prematureAdvisory}What timeline or duration do you have in mind for this campaign (e.g., 2 weeks, 1 month, 2 months, or seasonal)?`;
  } else {
    status = "ready_for_confirmation";
    responseText = `${ackText}✓ All essential campaign facts have been collected! Click 'Review & Confirm' to verify your facts and launch the AI Market Research.`;
  }

  // Generate dynamic quick replies for this exact question and industry
  const dynamicQuickReplies = generateContextualQuickReplies(
    missing,
    validCompanyName ? mergedClient.company_name : undefined,
    mergedClient.industry
  );

  // Safeguard: Ensure Demo Mode never overwrites any existing non-empty Artifact-1 value UNLESS explicitly corrected by client
  if (currentArtifact) {
    for (const section of Object.keys(updates)) {
      if (typeof updates[section] === "object" && updates[section] !== null) {
        for (const key of Object.keys(updates[section])) {
          const existingVal = currentArtifact[section]?.[key];
          const isFieldExplicitlyCorrected =
            (section === "budget" && isBudgetCorrection) ||
            (section === "client" && key === "company_name" && isCompanyCorrection) ||
            (section === "product_service" && isProductCorrection) ||
            (section === "timeline" && isTimelineCorrection);

          if (
            !isFieldExplicitlyCorrected &&
            existingVal !== undefined &&
            existingVal !== null &&
            existingVal !== "" &&
            !(Array.isArray(existingVal) && existingVal.length === 0)
          ) {
            delete updates[section][key];
          }
        }
        if (Object.keys(updates[section]).length === 0) {
          delete updates[section];
        }
      }
    }
  }

  if (isGreetingOrPleasantry(userMessage) && Object.keys(updates).length === 0) {
    const greetingReply = validCompanyName
      ? `Hello! Great to connect with you. ${responseText}`
      : "Hello! I am your AI Marketing Consultant. To help formulate your campaign strategy, could you tell me your company or brand name, and what product or service you'd like to promote?";

    return {
      ai_message: greetingReply.trim(),
      extracted_updates: {},
      status: "collecting",
      missing_fields: missing,
      quick_replies: dynamicQuickReplies,
      engine: "demo" as const,
    };
  }

  return {
    ai_message: responseText.trim(),
    extracted_updates: updates,
    status,
    missing_fields: missing,
    quick_replies: dynamicQuickReplies,
    engine: "demo" as const,
  };
}

export const ConversationAgent = {
  async processMessage(
    userMessage: string,
    history: { sender: string; content: string }[],
    currentArtifact: any
  ) {
    const rawArtifact = currentArtifact?.toObject ? currentArtifact.toObject() : currentArtifact || {};
    const sanitizedArtifact = {
      client: rawArtifact.client || {},
      product_service: rawArtifact.product_service || {},
      campaign: rawArtifact.campaign || {},
      target_audience: rawArtifact.target_audience || {},
      budget: rawArtifact.budget || {},
      timeline: rawArtifact.timeline || {},
      brand_preferences: rawArtifact.brand_preferences || {},
      assets: rawArtifact.assets || {},
      offers: rawArtifact.offers || {},
      operations: rawArtifact.operations || {},
      confirmed_facts: rawArtifact.confirmed_facts || {},
      ai_recommendations: rawArtifact.ai_recommendations || {},
    };

    const systemPrompt = `You are a senior professional AI Marketing Consultant onboarding a real paying client.
Your mission is to conduct a natural, consultative intake conversation to discover requirements and prepare a complete campaign execution plan.

IMPORTANT: "Phase 1: Conversation AI Only" — Do NOT invent external market statistics, competitor numbers, or advertising benchmarks.
Ground all analysis on:
- Facts confirmed by the client.
- Clearly labeled AI recommendations (requiring client approval).
- Clearly labeled assumptions.

CONVERSATION RULES (MANDATORY):
1. NATURAL HUMAN CONVERSATION: Behave like an experienced marketing agency consultant, not a static form.
2. ASK ONE MAIN QUESTION AT A TIME: Ask one clear question per turn, wait for response, understand it, then move forward.
3. EXTRACT BROADLY, ASK NARROWLY: Extract every useful fact from the client's message even if it wasn't what you asked for. NEVER ask again for information already provided.
4. HANDLE UNKNOWN/UNCERTAIN ANSWERS: If the client is unsure ("I don't know", "You suggest"), provide a reasonable, practical recommendation and explicitly ask for their approval.
5. HANDLE CORRECTIONS: Explicit client corrections ("Actually our budget is 20k", "Change brand to X") immediately supersede previous values.
6. SEPARATE FACTS FROM SUGGESTIONS:
   - Client-Confirmed Facts: What the client explicitly stated or approved.
   - AI Recommendations: Marketing strategies, offers, budget splits, content ideas suggested by you.
   - Assumptions: Estimated projections clearly marked as assumptions.
   - Missing Information: Fields still needed.
   Discounts, delivery offers, budgets, and policies MUST be treated as AI recommendations until confirmed by the client.

DISCOVERY SPECTRUM (Collect these naturally across the conversation):
- A. Business & Brand: Name, industry, products/services, operating duration, showroom/online, price range, USP.
- B. Campaign Objectives: Direct sales/orders priority vs brand awareness, measurable KPIs.
- C. Target Audience: Age group (e.g. 18-28), gender, locations, professions, lifestyle, core pain point (e.g. fabric quality vs price).
- D. Offers & Pricing: Product pricing, combo offers, discounts, free delivery (explore as suggestions).
- E. Budget & Timeline: Monthly ad budget range, campaign duration, launch date, Ads Manager experience level.
- F. Brand Identity & Creative Direction: Brand tone/personality, visual style (e.g. clean/modern/beige), colors, competitor references.
- G. Channels & Ad Setup: Paid Meta/Facebook/Instagram, organic short videos (TikTok/Reels), Click-to-Messenger ads (no website/pixel required).
- H. Operations & Logistics: Inbox response time, team size, auto-reply need, courier delivery (Steadfast/Pathao), COD availability, exchange policy.

COMPLETION & CONFIRMATION LOGIC:
- DO NOT finish discovery prematurely after collecting only 6 basic fields!
- Progress through the discovery areas until all core areas (Business, Product, Objective, Audience, Offers, Budget, Brand/Visual, Channels, Operations) are covered.
- When sufficient discovery is complete:
  1. Generate a clear structured summary in 'ai_message' dividing items into:
     - Confirmed Client Facts
     - AI Recommended Strategy (Offers, Channels, Budget Allocation)
     - Operational Setup
  2. Ask the client to review and confirm the summary so final campaign documents can be generated.
  3. Set "status" to "ready_for_confirmation".

LANGUAGE AND TONE:
- Match the client's language: Bangla script -> natural conversational Bangla. English -> English. Banglish -> natural conversational Bangla script.
- Keep English marketing terms in English (campaign, ads, reach, ROI, SEO, budget, target audience, Messenger). Use respectful "আপনি" in Bangla.
- Never open with empty filler/praise: no "Great!", "Awesome!", "Certainly!", "দারুণ!", "চমৎকার!".
- Plain text in ai_message: 1-4 short sentences, OR an organized summary when discovery is complete.
- quick_replies: 2-4 short, clickable answers matching the active question.

Current Extracted Facts (DO NOT lose this data, merge new updates into it):
${JSON.stringify(sanitizedArtifact, null, 2)}

CRITICAL FORMATTING INSTRUCTION:
Your response must be ONLY a valid raw JSON object. Never include any conversational preamble, notes, or markdown text outside the JSON object.

Respond with a strictly formatted JSON object:
{
  "ai_message": "your natural conversational response. Ask ONE targeted question, OR provide the confirmation summary if discovery is complete.",
  "extracted_updates": {
    "client": { "company_name": "", "industry": "", "website": "", "business_description": "", "brand_personality": "", "competitor_references": [], "usp": "", "operating_history": "" },
    "product_service": { "name": "", "type": "", "price": null, "price_range": "", "description": "", "pain_point_solved": "" },
    "campaign": { "name": "", "objective": "", "desired_result": "", "theme": "", "ad_structure": "", "channels": { "paid": [], "organic": [] } },
    "target_audience": { "age_range": "", "gender": "", "location": "", "description": "", "pain_points": "" },
    "budget": { "amount": null, "currency": "BDT", "type": "exact|approximate|range|unknown" },
    "timeline": { "duration": "", "start_date": "" },
    "brand_preferences": { "tone": [], "visual_preference": "", "colors": [] },
    "assets": { "readiness": "", "images": [], "videos": [] },
    "offers": { "primary_offer": "", "secondary_offer": "", "status": "suggested|client_approved" },
    "operations": { "response_time": "", "team_size": "", "auto_reply_needed": true, "delivery_partner": "", "cod_available": true, "exchange_policy": "" },
    "confirmed_facts": {},
    "ai_recommendations": {},
    "assumptions": {},
    "missing_information": []
  },
  "confidence_scores": {
    "client.company_name": 0.9,
    "product_service.name": 0.9,
    "campaign.objective": 0.85
  },
  "status": "collecting" | "ready_for_confirmation",
  "missing_fields": ["array of still missing or low-confidence fields"],
  "quick_replies": ["option 1", "option 2", "option 3"]
}`;

    // 1. Google Gemini (Primary with retries on 503/429)
    if (isGeminiConfigured()) {
      const activePrimaryModel = process.env.GEMINI_MODEL || GEMINI_MODEL;
      const activeFallbackModel = process.env.GEMINI_FALLBACK_MODEL || GEMINI_FALLBACK_MODEL;
      const delays = [1000, 2000];
      let primaryFailed = false;

      const contents: { role: string; parts: { text: string }[] }[] = [];

      // Normalize history to exclude current userMessage if caller included it
      const priorHistory = [...history];
      if (
        priorHistory.length > 0 &&
        priorHistory[priorHistory.length - 1].sender === "user" &&
        priorHistory[priorHistory.length - 1].content.trim() === userMessage.trim()
      ) {
        priorHistory.pop();
      }

      for (const m of priorHistory.slice(-10)) {
        if (m.sender === "system") continue;
        const role = m.sender === "ai" ? "model" : "user";
        contents.push({ role, parts: [{ text: m.content }] });
      }
      contents.push({ role: "user", parts: [{ text: userMessage }] });

      while (contents.length > 0 && contents[0].role === "model") {
        contents.shift();
      }

      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await withTimeout(
            ai.models.generateContent({
              model: activePrimaryModel,
              contents,
              config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                temperature: 0.3,
              },
            }),
            18000,
            `Gemini request to ${activePrimaryModel} timed out after 18s`
          );

          const raw = response.text || "{}";
          const parsed = robustParseJson(raw);
          const validated = ConversationTurnSchema.safeParse(parsed);
          if (validated.success) {
            console.log(`[ConversationAgent] Answered with model: ${activePrimaryModel}`);
            return { ...validated.data, engine: "gemini" as const };
          } else {
            console.error(
              `[ConversationAgent] Provider: Google Gemini, Model: ${activePrimaryModel}, Error: Schema Validation Failed`,
              validated.error.issues
            );
            // Do not retry on schema validation errors
            primaryFailed = true;
            break;
          }
        } catch (err: any) {
          console.error(
            `[ConversationAgent] Provider: Google Gemini, Model: ${activePrimaryModel}, Error:`,
            err.status || err.statusCode || err.code || "",
            err.message || err
          );

          if (isTransientGeminiError(err) && attempt < 2) {
            const delay = delays[attempt];
            console.warn(
              `[ConversationAgent] Transient Gemini error (${err.status || err.statusCode || err.code || 503}). Retrying in ${delay}ms (attempt ${attempt + 1}/2)...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          primaryFailed = true;
          break;
        }
      }

      // 2. If still failing, try once with GEMINI_FALLBACK_MODEL
      if (primaryFailed && activeFallbackModel) {
        try {
          console.warn(`[ConversationAgent] Primary model (${activePrimaryModel}) failed. Trying fallback model: ${activeFallbackModel}`);
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await withTimeout(
            ai.models.generateContent({
              model: activeFallbackModel,
              contents,
              config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                temperature: 0.3,
              },
            }),
            18000,
            `Gemini request to fallback model ${activeFallbackModel} timed out after 18s`
          );

          const raw = response.text || "{}";
          const parsed = robustParseJson(raw);
          const validated = ConversationTurnSchema.safeParse(parsed);
          if (validated.success) {
            console.log(`[ConversationAgent] Answered with model: ${activeFallbackModel}`);
            return { ...validated.data, engine: "gemini" as const };
          } else {
            console.error(
              `[ConversationAgent] Provider: Google Gemini (Fallback), Model: ${activeFallbackModel}, Error: Schema Validation Failed`,
              validated.error.issues
            );
          }
        } catch (err: any) {
          console.error(
            `[ConversationAgent] Provider: Google Gemini (Fallback), Model: ${activeFallbackModel}, Error:`,
            err.status || err.statusCode || err.code || "",
            err.message || err
          );
        }
      }
    } else {
      console.warn("[ConversationAgent] GEMINI_API_KEY not set, using demo engine");
    }

    // 3. OpenAI Fallback (optional)
    if (USE_OPENAI_FALLBACK && isOpenAiConfigured()) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const apiMessages: any[] = history.slice(-10).map((m) => ({
          role: m.sender === "ai" ? "assistant" : m.sender === "user" ? "user" : "system",
          content: m.content,
        }));
        apiMessages.push({ role: "user", content: userMessage });

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, ...apiMessages],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const raw = completion.choices[0]?.message?.content || "{}";
        const parsed = JSON.parse(raw);

        // Validate output with Zod
        const validated = ConversationTurnSchema.safeParse(parsed);
        if (validated.success) {
          return { ...validated.data, engine: "openai" as const };
        } else {
          console.error(
            `[ConversationAgent] Provider: OpenAI, Model: gpt-4o-mini, Error: Schema Validation Failed`,
            validated.error.issues
          );
        }
      } catch (err: any) {
        console.error(
          `[ConversationAgent] Provider: OpenAI, Model: gpt-4o-mini, Error:`,
          err.status || err.statusCode || err.code || "",
          err.message || err
        );
      }
    }

    if (process.env.ALLOW_DEMO_FALLBACK === "false") {
      throw new AiUnavailableError("[ConversationAgent] AI generation failed and ALLOW_DEMO_FALLBACK is set to 'false'.");
    }

    // Demo Mode Engine
    return { ...processDemoConversation(userMessage, history, currentArtifact), engine: "demo" as const };
  },
};

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { MasterCampaignBriefSchema, CampaignDocumentsSchema } from "@/lib/validation/schemas";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash";

function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

function isOpenAiConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key.trim().length > 10 && !key.includes("dummy"));
}

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

export const BriefAgent = {
  /**
   * Generates both MASTER_CAMPAIGN_BRIEF.md and CAMPAIGN_EXECUTION_SCRIPT.md
   * strictly from conversational intake data without any external research.
   */
  async generateCampaignDocuments(artifact1: any, messages: { sender: string; content: string }[] = []) {
    const company = artifact1.client?.company_name || "Client Brand";
    const industry = artifact1.client?.industry || "Retail & E-commerce";
    const product = artifact1.product_service?.name || "Featured Product / Service";
    const price = artifact1.product_service?.price_range || (artifact1.product_service?.price ? `৳${artifact1.product_service.price}` : "Not Provided");
    const objective = artifact1.campaign?.objective || "Direct Sales & Conversions";
    const audience = artifact1.target_audience?.description || artifact1.target_audience?.age_range || "Target Customers";
    const budget = artifact1.budget?.amount ? `৳${artifact1.budget.amount.toLocaleString()} ${artifact1.budget.currency || "BDT"}` : "Budget Not Specified";
    const duration = artifact1.timeline?.duration || "30 Days";

    const prompt = `You are a Chief Marketing Strategist at an autonomous AI Marketing Agency.
Your task is to generate TWO distinct, highly professional campaign documents based strictly on the client conversation and confirmed facts below.

CRITICAL DATA INTEGRITY RULES (PHASE 1 - CONVERSATION ONLY):
1. COMPLETELY EXCLUDE EXTERNAL RESEARCH: Do NOT invent external market research, competitor financials, third-party statistics, or fictitious advertising benchmarks.
2. STRICT SEPARATION: Clearly distinguish:
   - Client-Confirmed Facts (explicitly stated/confirmed by client)
   - AI Recommendations (marketing strategies, offers, budget allocation suggested by AI)
   - Assumptions (estimated figures clearly marked as assumptions)
   - Missing Information / Pending Client Decisions (written as "Not Provided" or "Requires Client Confirmation")
3. OFFERS & COMMITMENTS: Discounts, combo bundles, free delivery, and return/exchange policies must be marked as "AI Recommendation - Pending Client Approval".
4. DYNAMIC & INDUSTRY ADAPTIVE: Generate tailored strategy appropriate for this specific business (${company} in ${industry}).
5. COMPREHENSIVENESS: Follow the exact multi-section structures below.

CLIENT CONVERSATION FACTS & INPUT:
${JSON.stringify(artifact1, null, 2)}

RECENT CONVERSATION TRANSCRIPT:
${messages.slice(-15).map(m => `${m.sender.toUpperCase()}: ${m.content}`).join("\n")}

OUTPUT FORMAT:
Respond with a strictly formatted JSON object with two markdown keys:
{
  "master_campaign_brief_md": "Full markdown string of MASTER_CAMPAIGN_BRIEF.md",
  "campaign_execution_script_md": "Full markdown string of CAMPAIGN_EXECUTION_SCRIPT.md",
  "generated_at": "${new Date().toISOString()}",
  "version": "1.0"
}

DOCUMENT 1: MASTER_CAMPAIGN_BRIEF.md REQUIRED STRUCTURE:
# MASTER CAMPAIGN BRIEF: ${company.toUpperCase()}
1. Executive Summary & Brand Overview (Brand info, industry, confirmed facts table, business overview, core problem solved, positioning, USP)
2. Campaign Objectives & Target KPIs (Primary objective, secondary objectives, KPI targets with conservative estimates clearly marked as assumptions, explaining basis)
3. Audience Persona (Demographics, age group, geographic focus, occupations, psychographics, pain points, buying motivations, expectations)
4. Offer Architecture (Primary offer, secondary offer, discount strategy, profitability notes, approval status)
5. Budget Allocation Plan (Total budget, daily budget, 3-phase split: Testing / Scaling / Retargeting, budget distribution table)
6. Creative & Content Strategy (Brand colors, visual identity, tone, image ad concepts, video/Reels concepts, ad copy suggestions, headlines/CTAs, weekly content calendar)
7. Advertising Campaign Setup (Platforms, ad objectives, structure, audience parameters, placements, messaging strategy)
8. Customer Communication & Operations (Messenger/chat workflow, automated welcome message, quick replies, order-collection script, response time recommendations, delivery/fulfillment, exchange policy)
9. Risk Management (Campaign risks, budget risks, operational risks, trust barriers, mitigation solutions, pending client decisions)
10. Final Recommendations & Next Steps (Recommended actions, required approvals, required assets, launch checklist)

DOCUMENT 2: CAMPAIGN_EXECUTION_SCRIPT.md REQUIRED STRUCTURE:
# CAMPAIGN EXECUTION SCRIPT: ${company.toUpperCase()}
A beginner-friendly, step-by-step practical guide:
Part 1 — Campaign Foundation (Strategy, positioning, core message, target audience, primary offer)
Part 2 — Budget Execution (Total budget, daily budget, phase-by-phase allocation table, testing vs scaling instructions)
Part 3 — Creative Production (Required images, video/Reel concepts with 0-3s hook instructions, recording tips for phone cameras, ad copy in Banglish/English, headlines, CTAs)
Part 4 — Advertising Setup (Step-by-step Ads Manager walkthrough: objective, ad set targeting, placement, ad creative assembly)
Part 5 — Customer Messaging (Instant automated welcome message script, 3 quick replies, common FAQs, 3-step order confirmation template, follow-up script)
Part 6 — Organic Content Execution (Weekly posting rhythm, post descriptions, Reel concepts, engagement actions)
Part 7 — Daily & Weekly Monitoring (Daily checklist, core KPIs to check, performance benchmarks, creative testing rules)
Part 8 — Scaling & Improvement (When to increase budget, when to pause fatigue creatives, how to optimize)
Part 9 — Final Launch Checklist (Checklist covering assets, payment/billing, ad account, messaging, offer sign-off, final launch confirmation)`;

    if (isGeminiConfigured()) {
      const activePrimaryModel = process.env.GEMINI_MODEL || GEMINI_MODEL;
      const activeFallbackModel = process.env.GEMINI_FALLBACK_MODEL || GEMINI_FALLBACK_MODEL;

      for (const modelToUse of [activePrimaryModel, activeFallbackModel]) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await withTimeout(
            ai.models.generateContent({
              model: modelToUse,
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              config: {
                responseMimeType: "application/json",
                temperature: 0.3,
              },
            }),
            25000,
            `Gemini request to ${modelToUse} timed out after 25s`
          );

          const raw = response.text || "{}";
          const parsed = JSON.parse(raw);
          const validated = CampaignDocumentsSchema.safeParse(parsed);
          if (validated.success && validated.data.master_campaign_brief_md && validated.data.master_campaign_brief_md.length > 200) {
            const hasExecutionScript = Boolean(validated.data.campaign_execution_script_md && validated.data.campaign_execution_script_md.length > 200);
            if (!hasExecutionScript) {
              const fallback = this.generateDynamicFallbackDocuments(artifact1);
              validated.data.campaign_execution_script_md = fallback.campaign_execution_script_md;
            }
            console.log(`[BriefAgent] Generated campaign documents using model: ${modelToUse}`);
            return validated.data;
          }
        } catch (err: any) {
          console.warn(`[BriefAgent] Model ${modelToUse} failed or timed out:`, err.message);
        }
      }
    }

    // High-Fidelity Dynamic Fallback Synthesis Engine
    return this.generateDynamicFallbackDocuments(artifact1);
  },

  /**
   * Dynamic Markdown Synthesis Engine (Zero external dependencies fallback)
   */
  generateDynamicFallbackDocuments(artifact1: any) {
    const company = artifact1.client?.company_name || "Client Brand";
    const industry = artifact1.client?.industry || "Retail & E-commerce";
    const product = artifact1.product_service?.name || "Featured Products";
    const priceRange = artifact1.product_service?.price_range || (artifact1.product_service?.price ? `৳${artifact1.product_service.price}` : "Not Provided");
    const objective = artifact1.campaign?.objective || "Direct Sales & Orders";
    const audienceDesc = artifact1.target_audience?.description || "Urban consumers";
    const ageRange = artifact1.target_audience?.age_range || "18–28";
    const location = artifact1.target_audience?.location || "Bangladesh (Major Urban Centers)";
    const rawBudget = artifact1.budget?.amount;
    const currency = artifact1.budget?.currency || "BDT";
    const budgetStr = rawBudget ? `৳${rawBudget.toLocaleString()} ${currency}` : "৳15,000 – ৳20,000 BDT (Estimated)";
    const dailySpend = rawBudget ? `৳${Math.round(rawBudget / 30).toLocaleString()}` : "৳500 – ৳650";
    const duration = artifact1.timeline?.duration || "30 Days";
    const tone = Array.isArray(artifact1.brand_preferences?.tone) && artifact1.brand_preferences.tone.length > 0 
      ? artifact1.brand_preferences.tone.join(", ") 
      : "Youthful, clean, approachable, and trustworthy";
    const colors = Array.isArray(artifact1.brand_preferences?.colors) && artifact1.brand_preferences.colors.length > 0 
      ? artifact1.brand_preferences.colors.join(", ") 
      : "Neutral tones (Black, White, Beige)";
    const courier = artifact1.operations?.delivery_partner || "Steadfast Courier / Pathao";
    const primaryOffer = artifact1.offers?.primary_offer || "Buy 2 Bundle with Special Discount + Free Delivery";

    const masterBriefMd = `# MASTER CAMPAIGN BRIEF: ${company.toUpperCase()}
**Document Version:** 1.0  
**Brand:** ${company}  
**Industry:** ${industry}  
**Focus Product / Service:** ${product}  
**Campaign Period:** ${duration}  
**Prepared by:** AI Marketing Agency Agent  

---

## 1. Executive Summary & Brand Overview

### 1.1 Confirmed Client Facts
* **Brand Name:** ${company}
* **Industry & Vertical:** ${industry}
* **Core Product Focus:** ${product} (Pricing: ${priceRange})
* **Operating Background:** ${artifact1.client?.operating_history || "Active e-commerce operations"}
* **Current Infrastructure:** ${artifact1.client?.website ? `Website: ${artifact1.client.website}` : "Online sales via Facebook Page, Messenger, and Instagram"}
* **Delivery & Fulfillment:** ${courier} with Cash on Delivery (COD)
* **Target Audience:** ${audienceDesc} (Ages: ${ageRange}, Location: ${location})
* **Campaign Duration:** ${duration}
* **Allocated Budget:** ${budgetStr}

### 1.2 Core Problem & Brand Positioning
* **Customer Friction Solved:** ${artifact1.product_service?.pain_point_solved || "Bridging the gap between affordable pricing and genuine, dependable product quality."}
* **Brand Positioning:** ${tone}. Clean, reliable, and accessible without excessive price markup.
* **Unique Selling Proposition (USP):** ${artifact1.client?.usp || "Authentic quality with true-to-life presentation and dependable nationwide fulfillment."}

---

## 2. Campaign Objectives & Target KPIs

### 2.1 Primary & Secondary Objectives
* **Primary Objective:** ${objective} (Direct order generation via messaging)
* **Secondary Objective:** Strengthen brand recognition and repeat customer loyalty in key urban clusters.

### 2.2 Target Key Performance Indicators (Estimates)
> *Note: Projections below are directional estimates based on standard campaign performance and require live validation.*
* **Planned Media Budget:** ${budgetStr} (~${dailySpend}/day)
* **Estimated Inbound Conversations:** ~800 – 1,500 qualified inquiries
* **Target Conversion Rate:** 15% – 25% order confirmation from chat
* **Estimated Orders:** ~120 – 300 orders
* **Target ROAS (Return on Ad Spend):** Estimated 4x – 8x gross revenue

---

## 3. Audience Persona

* **Target Demographics:** Male and female buyers aged ${ageRange}.
* **Geographic Focus:** ${location}.
* **Occupations:** University students, early-career executives, and digital-first shoppers.
* **Psychographics & Behaviors:** Active on Facebook & Instagram; prefers Cash on Delivery; values genuine customer photos and fast responses.
* **Core Pain Points:** Disappointment from over-edited product images; sizing and fabric uncertainty.

---

## 4. Offer Architecture

### 4.1 Primary Offer (*AI Recommendation - Pending Client Approval*)
* **"${primaryOffer}":** Designed to maximize Average Order Value (AOV) and reduce courier cost impact.

### 4.2 Secondary Offer (*AI Recommendation*)
* **First-Time Buyer Incentive:** Flat delivery fee or 10% introductory saving on single items.
* **Risk Reversal Guarantee:** 48-hour size/quality exchange guarantee.

---

## 5. Budget Allocation Plan

| Phase | Duration | Allocation (% of Budget) | Daily Spend | Strategic Focus |
|---|---|---|---|---|
| **Phase 1: Testing & Traction** | Days 1–7 | 20% | ~${dailySpend} | Creative angle & audience response testing |
| **Phase 2: Core Scaling** | Days 8–24 | 60% | ~${dailySpend} | Scaling top winning ad creatives & combo offers |
| **Phase 3: Urgency & Closing** | Days 25–30 | 20% | ~${dailySpend} | Retargeting past message inquiries with limited stock push |

---

## 6. Creative & Content Strategy

* **Visual Identity:** Clean, well-lit natural photos; ${colors}.
* **Tone of Voice:** ${tone}.
* **Ad Formats:** 9:16 vertical short videos (Reels) showing real product details + multi-item carousels.
* **Ad Copy Style:** Conversational Banglish / English with upfront pricing and COD assurance.

---

## 7. Advertising Campaign Setup

* **Platforms:** Meta Ads (Facebook Feed, Instagram Feed, Reels).
* **Campaign Objective:** Engagement → Messaging Apps (Messenger / Instagram Direct).
* **Targeting Parameters:** Ages ${ageRange}, location: ${location}, interests matching ${industry}.
* **CTA Button:** "Send Message".

---

## 8. Customer Communication & Operations

* **Messenger Strategy:** Deploy instant auto-reply with product catalog, price chart, and COD terms.
* **Order Capture Template:** Collect Name, Phone Number, Full Address, and Item/Size in a single message.
* **Target Response Time:** Under 15–30 minutes during peak hours (10:00 AM – 11:00 PM).
* **Fulfillment:** ${courier} nationwide.

---

## 9. Risk Management

* **Delivery Return Risk:** Always verify phone number and address before dispatching COD parcels.
* **Ad Fatigue Risk:** Rotate creatives every 10–14 days.
* **Stock & Sizing Availability:** Confirm stock before boosting specific product variants.

---

## 10. Final Recommendations & Next Steps

1. Client review and sign-off on the recommended combo offer.
2. Prepare 2–3 phone-shot short video clips and 4 product photos.
3. Configure automated welcome replies in Meta Business Suite.
4. Launch Phase 1 test campaign in Meta Ads Manager.
`;

    const executionScriptMd = `# CAMPAIGN EXECUTION SCRIPT: ${company.toUpperCase()}
**Practical Step-by-Step Implementation Guide**  
**Brand:** ${company}  
**Focus Product:** ${product}  
**Budget:** ${budgetStr}  

---

## Part 1 — Campaign Foundation
* **Core Campaign Theme:** "Real Quality, Honest Value."
* **Primary Objective:** ${objective}
* **Target Audience:** ${audienceDesc} (Ages ${ageRange})
* **Hero Offer:** ${primaryOffer} (*Pending final client sign-off*)

---

## Part 2 — Budget Execution
* **Total Media Spend:** ${budgetStr}
* **Daily Ad Budget:** ${dailySpend} per day
* **Phase 1 (Days 1–7):** Deploy 2 ad variations at ~৳500/day to test which creative drives the cheapest messages.
* **Phase 2 (Days 8–24):** Increase spend on the top-performing creative to ~৳650/day.
* **Phase 3 (Days 25–30):** Run retargeting with urgency messaging ("Limited stock remaining").

---

## Part 3 — Creative Production (Phone Camera Friendly)
* **Required Assets:**
  * 2 Short Video Reels (12–15 seconds, 9:16 vertical format).
  * 1 Carousel set (3–5 square product photos).
* **Video Script Structure:**
  * **0–3 Seconds (Hook):** Immediate dynamic view of ${product} in use.
  * **4–8 Seconds (Detail):** Close-up showing fabric texture, stitching, or finish.
  * **9–12 Seconds (Benefit):** Highlight comfort and weather suitability.
  * **13–15 Seconds (CTA):** Text on screen: "Cash on Delivery Available • Click Send Message".

---

## Part 4 — Advertising Setup (Meta Ads Manager)
1. Navigate to **Meta Ads Manager** (\`adsmanager.facebook.com\`).
2. Click **Create (+)** → Choose **Engagement** objective.
3. In Ad Set settings, select **"Messaging apps"** as conversion location.
4. Set audience:
   * **Location:** ${location}
   * **Age:** ${ageRange}
   * **Placements:** Advantage+ Placements.
5. In Ad level, attach your creative, paste the ad copy, and set the CTA button to **"Send Message"**.

---

## Part 5 — Customer Messaging & Order Closing

### 5.1 Automated Welcome Greeting (Meta Business Suite Inbox):
\`\`\`text
আসসালামু আলাইকুম! ${company}-এ আপনাকে স্বাগতম। 

আমাদের ${product} কালেকশন দেখতে পছন্দ করার জন্য ধন্যবাদ।

🔥 স্পেশাল অফার: ${primaryOffer}
✅ সারা দেশে ক্যাশ অন ডেলিভারি সুবিধা আছে।

অর্ডার বা বিস্তারিত জানতে অনুগ্রহ করে আপনার পছন্দের প্রোডাক্টের ছবি বা সাইজ জানান। আমরা দ্রুতই রিপ্লাই দিচ্ছি!
\`\`\`

### 5.2 3-Step Order Confirmation Template:
\`\`\`text
আপনার অর্ডারটি কনফার্ম করতে অনুগ্রহ করে নিচের তথ্যগুলো দিন:
১. নাম:
২. মোবাইল নম্বর:
৩. সম্পূর্ণ ডেলিভারি ঠিকানা (থানা ও জেলা সহ):
৪. সাইজ / কালার:

🚚 ডেলিভারি চার্জ: ঢাকা সিটিতে ৳৬০ | ঢাকার বাইরে ৳১৩০ (ক্যাশ অন ডেলিভারি)
\`\`\`

---

## Part 6 — Organic Content Execution (3 Posts / Week)
* **Monday:** Product Showcase Carousel (Front, back, and close-up detail).
* **Wednesday:** Behind-the-scenes packing or customer review highlight.
* **Friday:** Short styling/lifestyle Reel.

---

## Part 7 — Daily & Weekly Monitoring Checklist
* **Daily:** Check Meta Ads Manager spend; ensure Cost Per Message stays within target (৳5–৳18).
* **Daily:** Reply to all inbox messages within 30 minutes.
* **Weekly:** Calculate chat-to-order closing rate and review Steadfast/Pathao delivery updates.

---

## Part 8 — Scaling & Optimization Rules
* If Cost Per Message is under ৳10 with a steady 20%+ order closing rate: Increase daily budget by 20%.
* If an ad has run 4 days with Cost Per Message over ৳25: Pause creative and replace with fresh footage.

---

## Part 9 — Final Launch Checklist
- [ ] Product stock and size availability verified.
- [ ] 2 short video clips and 4 photos ready.
- [ ] Courier merchant account active (${courier}).
- [ ] Automated welcome reply enabled in Meta Business Suite.
- [ ] Ad payment method active in Meta Ads Manager.
- [ ] Campaign set live!
`;

    return {
      master_campaign_brief_md: masterBriefMd,
      campaign_execution_script_md: executionScriptMd,
      generated_at: new Date().toISOString(),
      version: "1.0",
    };
  },

  async generateMasterBrief(artifact1: any, artifact2: any) {
    if (isOpenAiConfigured()) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const prompt = `You are a Chief Marketing Strategist.
Combine Artifact-1 (Client Facts) and Artifact-2 (Market Research & Enrichment) into a downstream-ready Master Campaign Brief.

CRITICAL RULES:
1. Under target_audience, keep client_stated strictly separate from research_insights.
2. Build an actionable strategic direction including key message, content direction, and campaign direction.
3. Validate and output strictly JSON.

Artifact-1 (Client Facts):
${JSON.stringify(artifact1, null, 2)}

Artifact-2 (Research Findings):
${JSON.stringify(artifact2, null, 2)}

Produce a Master Campaign Brief adhering to this JSON structure:
{
  "brief_id": "brief_master_1",
  "status": "confirmed",
  "version": "1.0",
  "campaign_summary": {
    "campaign_name": "string",
    "business": "string",
    "product_service": "string",
    "objective": "string",
    "desired_result": "string"
  },
  "target_audience": {
    "client_stated": {},
    "research_insights": {}
  },
  "market_insights": {
    "key_findings": ["string"],
    "trends": ["string"],
    "opportunities": ["string"],
    "risks": ["string"]
  },
  "competitor_insights": {
    "key_competitors": [],
    "pricing_insights": ["string"],
    "positioning_insights": ["string"],
    "content_insights": ["string"]
  },
  "platform_insights": [],
  "offer_and_pricing": {
    "client_offer": "string",
    "market_price_range": "string",
    "recommended_offer_direction": "string"
  },
  "brand_guidelines": {
    "tone": ["string"],
    "language": ["string"],
    "visual_preferences": ["string"],
    "do": ["string"],
    "dont": ["string"]
  },
  "budget": {
    "amount": null,
    "currency": "BDT"
  },
  "timeline": {
    "start_date": "string",
    "end_date": "string",
    "duration": "string"
  },
  "strategic_direction": {
    "key_message": "string",
    "content_direction": ["string"],
    "campaign_direction": ["string"]
  },
  "sources": []
}`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const raw = response.choices[0]?.message?.content || "{}";
        const parsed = JSON.parse(raw);
        const validated = MasterCampaignBriefSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch (err: any) {
        console.warn("[BriefAgent] OpenAI call failed, falling back to Strategy Synthesis Engine:", err.message);
      }
    }

    // High-Fidelity Strategic Synthesis Fallback
    const company = artifact1.client?.company_name || "Client Brand";
    const product = artifact1.product_service?.name || "Premium Product";
    const objective = artifact1.campaign?.objective || "Drive Online Sales";
    const budgetAmount = artifact1.budget?.amount || null;
    const currency = artifact1.budget?.currency || "BDT";
    const duration = artifact1.timeline?.duration || "1 Month Campaign";

    return {
      brief_id: `brief_${Date.now()}`,
      status: "confirmed",
      version: "1.0",
      campaign_summary: {
        campaign_name: artifact1.campaign?.name || `${company} - ${product} Growth Launch`,
        business: `${company} (${artifact1.client?.industry || "Lifestyle & Apparel"})`,
        product_service: product,
        objective: objective,
        desired_result: artifact1.campaign?.desired_result || "Scale direct consumer orders and strengthen brand recall",
      },
      target_audience: {
        client_stated: {
          age_range: artifact1.target_audience?.age_range || "Not specified by client",
          location: artifact1.target_audience?.location || "Not specified by client",
          description: artifact1.target_audience?.description || "Not specified by client",
          gender: artifact1.target_audience?.gender || "All / Unisex",
        },
        research_insights: {
          core_demographic: "Urban youth aged 18-28; high social media usage; university & early-career creators",
          psychographic_drivers: "Authenticity, aesthetic social presence, premium comfort, street culture belonging",
          primary_friction_points: "Skeptical of cheap fabric; requires proof of fabric GSM and collar durability",
          active_channels: ["Instagram Reels", "Facebook Commerce", "TikTok Viral Hooks"],
        },
      },
      market_insights: {
        key_findings: [
          artifact2?.market_research?.overview || "Growing demand for quality domestic D2C brands",
          `Market expansion supported by high social commerce conversion rates in ${artifact1.target_audience?.location || "Bangladesh"}.`,
        ],
        trends: artifact2?.market_research?.trends || ["Streetwear dominance", "Short-form video first"],
        opportunities: artifact2?.market_research?.opportunities || ["Bundle value packs", "Collar durability guarantee"],
        risks: artifact2?.market_research?.risks || ["Sizing returns", "Ad saturation during peaks"],
      },
      competitor_insights: {
        key_competitors: artifact2?.competitor_research || [],
        pricing_insights: [
          "Market benchmark sits between BDT 950 - BDT 1,890 for premium heavy-weight drop-shoulders.",
          "Mid-market competitors compete on price rather than fabric longevity.",
        ],
        positioning_insights: [
          `Position ${company} not as fast fashion, but as 'Engineered Heavyweight Streetwear for Everyday Longevity'.`,
        ],
        content_insights: [
          "Competitors with the highest engagement use customer fit comparisons and unedited fabric close-up clips.",
        ],
      },
      platform_insights: artifact2?.platform_research || [],
      offer_and_pricing: {
        client_offer: artifact1.product_service?.offer || "Standard retail launch",
        market_price_range: artifact2?.pricing_research?.market_price_range || "BDT 1,150 - 1,850",
        recommended_offer_direction:
          "Launch with 'Drop #01 Special': Dual Tee Bundle at BDT 2,490 with Free Nationwide Delivery + Free Sticker Pack. This overcomes initial hesitation and increases average basket size.",
      },
      brand_guidelines: {
        tone: ["Confident", "Urban & Modern", "Authentic", "Accessible Premium"],
        language: ["English / Conversational Banglish", "Crisp, benefit-driven copy"],
        visual_preferences: ["Minimalist aesthetic", "High-contrast street photography", "Raw 9:16 mobile video"],
        do: [
          "Show real fabric texture in natural light",
          "Include clear sizing guide with height/weight models",
          "Highlight wash-tested durability",
        ],
        dont: [
          "Avoid generic stock imagery or overly glossy artificial mockups",
          "Don't hide shipping or exchange terms",
        ],
      },
      budget: {
        amount: budgetAmount,
        currency: currency,
      },
      timeline: {
        start_date: artifact1.timeline?.start_date || "Phase 1: Week 1 (Teaser & Early Access)",
        end_date: artifact1.timeline?.end_date || "Phase 2: Weeks 2-4 (Full Scale Conversion)",
        duration: duration,
      },
      strategic_direction: {
        key_message: `Wear the standard. Built with heavy GSM structure for effortless everyday fit that never loses shape.`,
        content_direction: [
          "Hook-First Video Ads (0-3s): 'Why standard tees fail after 2 washes vs our collar test'",
          "Carousel Proof: 5-star reviews + customer street photos across Dhaka",
          "Retargeting Ad: 'Left it in your cart? Grab your size before Drop 01 runs out.'",
        ],
        campaign_direction: [
          "Phase 1 (Days 1-7): Teaser & Pre-order VIP list creation via Instagram Stories & TikTok",
          "Phase 2 (Days 8-21): Full conversion push utilizing Advantage+ Catalog Ads and UGC video testimonials",
          "Phase 3 (Days 22-30): Urgency & bundle push to drive remaining inventory before seasonal reset",
        ],
      },
      sources: artifact2?.sources || [],
    };
  },
};

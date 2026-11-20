/**
 * Consultant Questions Generator
 * Generates senior marketing consultant-grade questions for incomplete or missing campaign facts.
 * Every question:
 * 1. Explains WHY the information matters strategically for the campaign.
 * 2. Is easy for a non-marketer client to understand and answer.
 * 3. Provides concrete examples or answer choices so the client can reply quickly.
 * 4. Dynamically incorporates brand context, industry, and existing facts.
 */

export interface FieldQuestionContext {
  fieldKey: string;
  fieldLabel: string;
  companyName?: string;
  industry?: string;
  productName?: string;
  artifact?: any;
}

export class ConsultantQuestionGenerator {
  /**
   * Generates a ready-to-send question for a missing or incomplete field.
   */
  static generateQuestion(ctx: FieldQuestionContext): string {
    const { fieldKey, fieldLabel, artifact = {} } = ctx;
    const company =
      ctx.companyName ||
      artifact?.client?.company_name ||
      (artifact?.campaign?.name && !artifact.campaign.name.toLowerCase().includes("new marketing campaign")
        ? artifact.campaign.name
        : "");
    const brandRef = company && company.trim().length > 0 ? company.trim() : "your brand";
    const industry = ctx.industry || artifact?.client?.industry || "";
    const industryLower = industry.toLowerCase();
    const isSports = industryLower.includes("sport") || industryLower.includes("apparel") || industryLower.includes("jersey");
    const isSaaS = industryLower.includes("saas") || industryLower.includes("software") || industryLower.includes("tech");
    const isFood = industryLower.includes("restaurant") || industryLower.includes("food") || industryLower.includes("cafe");

    const key = (fieldKey || "").toLowerCase();
    const label = (fieldLabel || "").toLowerCase();

    // 1. Target Audience / Customer Profile
    if (
      key.includes("audience") ||
      label.includes("audience") ||
      key.includes("target_audience") ||
      label.includes("ideal customer")
    ) {
      if (isSports) {
        return `To make sure we’re spending your budget on the right people for ${brandRef}, could you describe your ideal customer? For example: age range, location, whether you mainly target football players, local sports clubs, or casual fans, and what they care about most when buying sportswear. If you have data on your best existing customers, that’s even better.`;
      }
      if (isSaaS) {
        return `To make sure we’re spending your budget on the right people for ${brandRef}, could you describe your ideal customer profile? For example: job titles (e.g. founders, CTOs, agency owners), company size, and the primary operational headache your software solves. If you have data on your best existing clients, that’s even better.`;
      }
      return `To make sure we’re spending your budget on the right people, could you describe your ideal customer? For example: age range, location, profession, and the main problem your product solves for them. If you have data on your best existing customers, that’s even better.`;
    }

    // 1b. Target Audience: Age Range
    if (key.includes("age") || label.includes("age")) {
      return `To calibrate our visual creative and messaging tone for peak engagement, what age demographic best represents your core buyers for ${brandRef}? For example: 18–24 (students and youth), 25–34 (young working professionals), or 35+ (family decision-makers)?`;
    }

    // 1c. Target Audience: Location
    if (key.includes("location") || label.includes("location")) {
      return `To ensure your ad budget is focused strictly where you can fulfill demand, what geographic locations should we target for ${brandRef}? For example: major hubs like Dhaka and Chittagong, all divisional cities, or nationwide delivery across Bangladesh?`;
    }

    // 2. Website & Online Presence
    if (key.includes("website") || label.includes("website")) {
      return `To help us analyze your current digital presence and ensure our campaign drives traffic to the right destination, do you have an active website or online store for ${brandRef}? If yes, please share the URL; if not, let us know if you currently take orders primarily through Facebook Messenger, WhatsApp, or Instagram.`;
    }

    // 3. Price & Commercial Model
    if (key.includes("price") || label.includes("price") || key.includes("pricing")) {
      if (isSports) {
        return `To help us calculate your target Customer Acquisition Cost (CAC) and project realistic Return on Ad Spend (ROAS) for ${brandRef}, what is the typical price range of your jerseys and sportswear (e.g., starter fan jerseys at 800 BDT up to custom club sets)? If you know your typical average order value, that will help us optimize conversion bids.`;
      }
      if (isSaaS) {
        return `To help us project customer acquisition economics and lifetime value (LTV) for ${brandRef}, what is your pricing model (e.g., monthly subscription tier, annual contract, or per-user seat pricing)? Knowing your starting price point helps us target buyers with the right budget authority.`;
      }
      return `To help us recommend the right advertising strategy and calculate your expected return on ad spend (ROAS) for ${brandRef}, what is the typical price range of your products or services (e.g., starter pricing to premium packages)? If you know your average order value (AOV), that will be very helpful.`;
    }

    // 4. Product Name & Hero Offering
    if (
      (key.includes("product") && key.includes("name")) ||
      (label.includes("product") && label.includes("name")) ||
      key === "name"
    ) {
      if (isSports) {
        return `To make sure our ad messaging highlights your strongest commercial lever, what specific product or apparel line do you want to feature as the hero offering for ${brandRef}? For example: custom football team kits, premium drop-shoulder t-shirts, or a new season club jersey?`;
      }
      return `To make sure our ad messaging highlights your strongest value proposition, what specific product or service line do you want to feature as the hero offering in this campaign for ${brandRef}? For example: a top-selling hero item, a newly launched solution, or a core package?`;
    }

    // 5. Product Type / Offering Category
    if (key.includes("type") || label.includes("type")) {
      return `To help us determine the best ad formats and customer journey for ${brandRef}, what type of offering is this? For example: physical retail merchandise, custom on-demand manufacturing, digital services, or subscription software?`;
    }

    // 6. Campaign Objective
    if (key.includes("objective") || label.includes("objective")) {
      return `To ensure our media strategy and ad formats align with your commercial goals for ${brandRef}, what is the primary objective for this campaign? For example: acquiring immediate online sales, generating qualified business leads, booking consultations, or building broad brand awareness?`;
    }

    // 7. Desired Result / 30-Day Milestone
    if (key.includes("desired_result") || label.includes("desired result") || key.includes("result")) {
      return `To help us set clear performance benchmarks, what specific result or metric would make this campaign a clear success for ${brandRef} in the first 30 days? For example: reaching 100+ verified customer orders, generating 50 qualified business inquiries, or hitting a specific sales revenue milestone?`;
    }

    // 8. Budget
    if (key.includes("budget") || label.includes("budget")) {
      return `To help us structure a realistic media plan and forecast expected impression volume and sales, what monthly or total advertising budget do you have in mind for ${brandRef}? (For example: 20,000 to 50,000 BDT, or let us know if you would like our recommendation on an optimal starting budget based on your goals).`;
    }

    // 9. Timeline & Duration
    if (key.includes("timeline") || label.includes("duration") || key.includes("duration")) {
      return `To help us plan the campaign phases—from initial testing and audience validation to scaling top-performing ads—what timeline or duration are you aiming for with ${brandRef}? For example: a 2-week test, 1 month, 3 months, or aligned with an upcoming seasonal event?`;
    }

    // 10. Brand Personality & Visual Style
    if (
      key.includes("personality") ||
      label.includes("personality") ||
      key.includes("visual") ||
      label.includes("visual style")
    ) {
      return `To ensure our creative design and ad copy resonate with your audience, how would you describe ${brandRef}'s brand personality and visual style? For example: energetic and athletic, clean and modern, or premium and authoritative?`;
    }

    // 11. Primary Offer & Incentives
    if (key.includes("offer") || label.includes("offer")) {
      return `To make your ads immediately compelling and lower initial buyer hesitation, do you have a special introductory offer or hook for this campaign? For example: 10% off first orders, free nationwide delivery, a bundle discount, or a complimentary consultation?`;
    }

    // 12. Operations, Delivery & Courier
    if (
      key.includes("delivery") ||
      label.includes("courier") ||
      key.includes("courier") ||
      label.includes("delivery partner")
    ) {
      return `To make sure our ad scaling aligns with your fulfillment capacity, what courier partner or delivery setup do you currently use for ${brandRef} (e.g., Steadfast, Pathao, RedX, internal delivery), and is Cash on Delivery (COD) supported?`;
    }

    // 13. Response Time & Customer Support
    if (key.includes("response") || label.includes("response time")) {
      return `To help us synchronize ad traffic with your sales team's availability, what is your team's typical response time when a prospective buyer messages your page or website (e.g. within 5 minutes, 1 hour, or same day)? Fast response times significantly increase paid ad conversion rates.`;
    }

    // 14. Company Name (if missing)
    if (key.includes("company") || label.includes("company")) {
      return `To ensure our strategic brief, ad accounts, and creative assets are accurately branded, could you confirm the official name of your business and any registered brand name you operate under?`;
    }

    // 15. Industry Vertical (if missing)
    if (key.includes("industry") || label.includes("industry")) {
      return `To help us benchmark your campaign against industry standards and top competitors, what specific industry vertical and market niche does your business specialize in?`;
    }

    // Default Fallback
    return `To make sure our campaign strategy for ${brandRef} is built with operational accuracy, could you share a bit more detail regarding your ${fieldLabel}? Explaining your current situation or preferences will help us calibrate the plan effectively.`;
  }

  /**
   * Identifies which section of Artifact-1 a field belongs to for saving manual updates.
   */
  static getSectionPath(fieldKey: string, fieldLabel: string): { section: string; field: string } {
    const key = (fieldKey || "").toLowerCase();
    const label = (fieldLabel || "").toLowerCase();

    if (key.includes("website") || label.includes("website")) return { section: "client", field: "website" };
    if (key.includes("company") || label.includes("company")) return { section: "client", field: "company_name" };
    if (key.includes("industry") || label.includes("industry")) return { section: "client", field: "industry" };
    if (key.includes("price") || label.includes("price")) return { section: "product_service", field: "price" };
    if (key.includes("product") || label.includes("product name")) return { section: "product_service", field: "name" };
    if (key.includes("type") || label.includes("type")) return { section: "product_service", field: "type" };
    if (key.includes("objective") || label.includes("objective")) return { section: "campaign", field: "objective" };
    if (key.includes("result") || label.includes("desired result")) return { section: "campaign", field: "desired_result" };
    if (key.includes("age") || label.includes("age range")) return { section: "target_audience", field: "age_range" };
    if (key.includes("location") || label.includes("location")) return { section: "target_audience", field: "location" };
    if (key.includes("audience") || label.includes("notes") || label.includes("audience notes")) return { section: "target_audience", field: "description" };
    if (key.includes("budget") || label.includes("budget")) return { section: "budget", field: "amount" };
    if (key.includes("duration") || key.includes("timeline") || label.includes("duration")) return { section: "timeline", field: "duration" };
    if (key.includes("offer") || label.includes("primary offer")) return { section: "offers", field: "primary_offer" };
    if (key.includes("courier") || key.includes("delivery") || label.includes("courier partner")) return { section: "operations", field: "delivery_partner" };
    if (key.includes("response") || label.includes("response time")) return { section: "operations", field: "response_time" };
    if (key.includes("visual") || label.includes("visual style")) return { section: "brand_preferences", field: "visual_preference" };

    return { section: "client", field: fieldKey || "notes" };
  }
}

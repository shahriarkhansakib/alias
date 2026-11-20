import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: {
          generateContent: mockGenerateContent,
        },
      };
    }),
  };
});

import { ConversationAgent, AiUnavailableError } from "@/lib/ai/conversation-agent";

describe("ConversationAgent Gemini retries and fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-api-key";
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    process.env.GEMINI_FALLBACK_MODEL = "gemini-flash-latest";
    process.env.ALLOW_DEMO_FALLBACK = "false";
  });

  it("retries up to 2 times on 503 and succeeds on 3rd attempt", async () => {
    const error503 = Object.assign(
      new Error("This model is currently experiencing high demand. Please try again later."),
      { status: 503, code: 503 }
    );

    const successResponse = {
      text: JSON.stringify({
        ai_message: "হ্যালো! স্কিনকেয়ার ব্র্যান্ডের জন্য ফেসবুকে কীভাবে প্রচার করতে চান?",
        extracted_updates: {
          client: { company_name: "Glow BD" },
        },
        confidence_scores: { "client.company_name": 0.9 },
        status: "collecting",
        missing_fields: ["budget"],
        quick_replies: ["অনলাইন সেলস", "ব্র্যান্ড সচেতনতা"],
      }),
    };

    // Return 503 twice, then success
    mockGenerateContent
      .mockRejectedValueOnce(error503)
      .mockRejectedValueOnce(error503)
      .mockResolvedValueOnce(successResponse);

    const result = await ConversationAgent.processMessage(
      "amader brand ache Glow BD",
      [],
      {}
    );

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(result.engine).toBe("gemini");
    expect(result.ai_message).toContain("হ্যালো!");
    expect(result.extracted_updates?.client?.company_name).toBe("Glow BD");
  }, 15000);

  it("fails after retries and fallback when Gemini returns 503 always, throwing AI_UNAVAILABLE", async () => {
    const error503 = Object.assign(
      new Error("This model is currently experiencing high demand. Please try again later."),
      { status: 503, code: 503 }
    );

    // Always reject with 503
    mockGenerateContent.mockRejectedValue(error503);

    let caughtError: any = null;
    try {
      await ConversationAgent.processMessage("amader brand ache", [], {});
    } catch (err: any) {
      caughtError = err;
    }

    // 3 calls on primary model + 1 call on fallback model = 4 calls total
    expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    expect(caughtError).toBeInstanceOf(AiUnavailableError);
    expect(caughtError.code).toBe("AI_UNAVAILABLE");
    expect(caughtError.statusCode).toBe(503);
  }, 15000);
});

describe("BriefAgent Dynamic Campaign Documents Generation", () => {
  it("dynamically generates MASTER_CAMPAIGN_BRIEF.md and CAMPAIGN_EXECUTION_SCRIPT.md matching the Urban Style structure", async () => {
    const { BriefAgent } = await import("@/lib/ai/brief-agent");

    const urbanStyleArtifact = {
      client: {
        company_name: "Urban Style",
        industry: "Men's Casual Apparel",
        brand_personality: "Youthful, clean, approachable",
        usp: "Stylish designs + comfortable weather-appropriate fabrics + affordable pricing",
        operating_history: "Around 1 year online",
      },
      product_service: {
        name: "Men's Casual Shirts",
        price_range: "৳600–৳1,200",
        pain_point_solved: "Quality fabric that doesn't shrink or lose color, at affordable prices",
      },
      campaign: {
        objective: "Direct sales & orders",
        desired_result: "Noticeable increase in daily orders",
      },
      target_audience: {
        age_range: "18–28",
        description: "University students and young professionals",
        location: "Dhaka and major cities in Bangladesh",
      },
      budget: {
        amount: 20000,
        currency: "BDT",
      },
      timeline: {
        duration: "1 Month",
      },
      brand_preferences: {
        tone: ["Youthful", "Clean", "Approachable"],
        colors: ["Black", "White", "Beige"],
      },
      offers: {
        primary_offer: "Buy 2 shirts get ৳150 off + Free Delivery",
      },
      operations: {
        delivery_partner: "Steadfast & Pathao (Nationwide COD)",
        response_time: "1–2 hours",
      },
    };

    const docs = await BriefAgent.generateCampaignDocuments(urbanStyleArtifact, []);

    expect(docs.master_campaign_brief_md).toBeDefined();
    expect(docs.master_campaign_brief_md).toContain("# MASTER CAMPAIGN BRIEF: URBAN STYLE");
    expect(docs.master_campaign_brief_md).toContain("1. Executive Summary & Brand Overview");
    expect(docs.master_campaign_brief_md).toContain("2. Campaign Objectives & Target KPIs");
    expect(docs.master_campaign_brief_md).toContain("3. Audience Persona");
    expect(docs.master_campaign_brief_md).toContain("4. Offer Architecture");
    expect(docs.master_campaign_brief_md).toContain("5. Budget Allocation Plan");
    expect(docs.master_campaign_brief_md).toContain("6. Creative & Content Strategy");
    expect(docs.master_campaign_brief_md).toContain("7. Advertising Campaign Setup");
    expect(docs.master_campaign_brief_md).toContain("8. Customer Communication & Operations");
    expect(docs.master_campaign_brief_md).toContain("9. Risk Management");
    expect(docs.master_campaign_brief_md).toContain("10. Final Recommendations & Next Steps");

    expect(docs.campaign_execution_script_md).toBeDefined();
    expect(docs.campaign_execution_script_md).toContain("# CAMPAIGN EXECUTION SCRIPT: URBAN STYLE");
    expect(docs.campaign_execution_script_md).toContain("Part 1 — Campaign Foundation");
    expect(docs.campaign_execution_script_md).toContain("Part 2 — Budget Execution");
    expect(docs.campaign_execution_script_md).toContain("Part 3 — Creative Production");
    expect(docs.campaign_execution_script_md).toContain("Part 4 — Advertising Setup");
    expect(docs.campaign_execution_script_md).toContain("Part 5 — Customer Messaging");
    expect(docs.campaign_execution_script_md).toContain("Part 6 — Organic Content Execution");
    expect(docs.campaign_execution_script_md).toContain("Part 7 — Daily & Weekly Monitoring");
    expect(docs.campaign_execution_script_md).toContain("Part 8 — Scaling & Optimization Rules");
    expect(docs.campaign_execution_script_md).toContain("Part 9 — Final Launch Checklist");
  });

  it("dynamically adapts to a completely different industry (e.g. B2B SaaS) without hardcoding apparel", async () => {
    const { BriefAgent } = await import("@/lib/ai/brief-agent");

    const saasArtifact = {
      client: {
        company_name: "CloudDesk BD",
        industry: "B2B SaaS / Office Automation",
        brand_personality: "Professional, reliable, efficient",
        usp: "Automates payroll, client invoices, and attendance for local agencies",
        operating_history: "Beta launching",
      },
      product_service: {
        name: "Agency Operations Suite",
        price_range: "৳3,000/month",
        pain_point_solved: "Disorganized spreadsheets and delayed client billing",
      },
      campaign: {
        objective: "Demo Bookings & Free Trial Signups",
      },
      target_audience: {
        age_range: "25–45",
        description: "Agency founders, operations heads, and HR managers in Dhaka",
        location: "Dhaka, Bangladesh",
      },
      budget: {
        amount: 35000,
        currency: "BDT",
      },
      timeline: {
        duration: "45 Days",
      },
    };

    const docs = await BriefAgent.generateCampaignDocuments(saasArtifact, []);

    expect(docs.master_campaign_brief_md).toContain("CLOUDDESK BD");
    expect(docs.master_campaign_brief_md).toContain("B2B SaaS / Office Automation");
    expect(docs.master_campaign_brief_md).toContain("Agency Operations Suite");
    expect(docs.campaign_execution_script_md).toContain("CLOUDDESK BD");
    // Should NOT contain shirts or Steadfast courier
    expect(docs.master_campaign_brief_md).not.toContain("shirts");
  });
});

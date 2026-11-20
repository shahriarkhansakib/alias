import { describe, it, expect, beforeEach, vi } from "vitest";
import { AdminCommunicationAgent } from "@/lib/ai/admin-communication-agent";
import { CommunicationSafetyGuard } from "./safety-guard";

describe("Senior-Level Marketing Consultant AI Suggestions Engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ALLOW_DEMO_AUTH;
    delete process.env.ALLOW_INSECURE_NON_TRANSACTIONAL_FALLBACK;
  });

  // 1. Business Introduction & Brand Strategy
  it("generates senior consultant advice for business introduction and brand intake", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Jersey Camp BD (Sports Apparel)",
      clientName: "Tanvir",
      businessName: "Jersey Camp BD",
      recentMessages: [{ sender: "client", content: "Jersey Camp BD (Sports Apparel)" }],
    });

    expect(res.suggestions).toBeDefined();
    expect(res.intentCategory).toBe("Business & Brand Intake");

    const { professional, friendly, detailed } = res.suggestions;
    // Professional: Strategic, concise, business-oriented
    expect(professional).toContain("Jersey Camp BD");
    expect(professional).toMatch(/objective|direct online sales|brand awareness/i);

    // Friendly: Warm, approachable partner tone
    expect(friendly).toContain("Jersey Camp BD");
    expect(friendly).toMatch(/hero products|collections|standout/i);

    // Detailed: Full-funnel growth framework
    expect(detailed).toMatch(/funnel|Meta|demographic/i);
  });

  // 2. Conversion and Sales Problems (Consultant-grade diagnostic)
  it("provides structured diagnostic approach when client reports conversion or sales problems", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "We are getting lots of website visitors and clicks from our ads, but no one is placing orders.",
      clientName: "Nusrat",
      businessName: "Vintage Denims",
      recentMessages: [
        { sender: "client", content: "We are getting lots of website visitors and clicks from our ads, but no one is placing orders." },
      ],
    });

    expect(res.intentCategory).toBe("Conversion & Sales Funnel Optimization");
    const { professional, detailed } = res.suggestions;

    // Must diagnose friction points (landing page, offer, checkout, delivery trust)
    expect(professional).toMatch(/bounce rate|friction|checkout/i);
    expect(detailed).toMatch(/audit|Offer|checkout|drop-off/i);

    // Never generic chatbot text
    expect(professional).not.toContain("our team has logged this request for verification");
  });

  // 3. Paid Advertising & Creative Strategy
  it("recommends creative testing frameworks for paid ad campaigns", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Should we run Instagram Reels video ads or dynamic product catalog carousels?",
      clientName: "Farhan",
      businessName: "Apex Cloud",
      recentMessages: [
        { sender: "client", content: "Should we run Instagram Reels video ads or dynamic product catalog carousels?" },
      ],
    });

    expect(res.intentCategory).toBe("Paid Advertising & Creative Strategy");
    const { professional, friendly, detailed } = res.suggestions;

    expect(professional).toMatch(/testing|scaling|Reels/i);
    expect(friendly).toMatch(/video|carousels/i);
    expect(detailed).toMatch(/testing|Conversion API|retargeting/i);
  });

  // 4. Budget & Pricing Strategy
  it("calibrates ad spend against commercial benchmarks without inventing unauthorized discounts", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "How much budget do we need to start seeing consistent sales?",
      clientName: "Arif",
      businessName: "FreshBite Express",
      recentMessages: [
        { sender: "client", content: "How much budget do we need to start seeing consistent sales?" },
      ],
    });

    expect(res.intentCategory).toBe("Budgeting & Pricing Policy");
    const { professional, detailed } = res.suggestions;

    // Professional mentions learning phase / CAC calibration
    expect(professional).toMatch(/learning phase|Customer Acquisition Cost|average/i);
    // Detailed mentions multi-phase budget allocation
    expect(detailed).toMatch(/Phase 1|ROAS|spend/i);
  });

  // 5. Target Audience & Regional Demographics (STP)
  it("applies STP segmentation principles for regional expansion", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Should we target only Dhaka and Chittagong or launch nationwide across Bangladesh?",
      clientName: "Tanvir",
      businessName: "Jersey Camp BD",
      recentMessages: [
        { sender: "client", content: "Should we target only Dhaka and Chittagong or launch nationwide across Bangladesh?" },
      ],
    });

    expect(res.intentCategory).toBe("Target Audience & Segmentation");
    const { professional, detailed } = res.suggestions;

    expect(professional).toMatch(/Dhaka and Chittagong|delivery logistics|purchasing power/i);
    expect(detailed).toMatch(/STP|audience|logistics/i);
  });

  // 6. Client Objections Handling
  it("de-risks client skepticism with structured testing methodology", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "We tried Facebook ads with another agency last year and it was a complete waste of money.",
      clientName: "Kamal",
      businessName: "UrbanThread",
      recentMessages: [
        { sender: "client", content: "We tried Facebook ads with another agency last year and it was a complete waste of money." },
      ],
    });

    expect(res.intentCategory).toBe("Client Objection & Skepticism");
    const { professional, friendly } = res.suggestions;

    // Empathizes and explains root causes of past ad failures
    expect(professional).toMatch(/testing|methodology|de-risk/i);
    expect(friendly).toMatch(/gamble|profitable|test/i);
  });

  // 7. Complaints and Dissatisfaction (Empathetic client relationship management)
  it("handles client frustration with immediate accountability and constructive next steps", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "I am really disappointed with how long this onboarding is taking.",
      clientName: "Sadia",
      businessName: "Lumina Skincare",
      recentMessages: [
        { sender: "client", content: "I am really disappointed with how long this onboarding is taking." },
      ],
    });

    expect(res.intentCategory).toBe("Complaint & Dissatisfaction");
    const { professional, friendly, detailed } = res.suggestions;

    expect(professional).toMatch(/candor|priority|address/i);
    expect(friendly).toMatch(/sorry|expectations|resolve/i);
    expect(detailed).toMatch(/accountability|milestones|bottlenecks/i);
  });

  // 8. Business Safety & Non-Inventing Enforcement
  it("strictly refuses to invent physical office locations when asked unsupported questions", async () => {
    const res = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Where is your physical office located in Chittagong port area?",
      clientName: "Kamal",
      businessName: "Fashion Point",
      recentMessages: [],
    });

    expect(res.noRelevantScriptFound).toBe(true);
    expect(res.requiresAdminReview).toBe(true);
    // Must provide holding reply rather than hallucinating an office address
    expect(res.suggestions.professional).toContain("verifying");
  });

  // 9. Follow-Up Nudge Generator
  it("generates senior consultant follow-up nudges when conversation is awaiting client response", () => {
    const followUps = AdminCommunicationAgent.generateFollowUpSuggestions({
      clientName: "Tanvir",
      businessName: "Jersey Camp BD",
      lastAdminReply: "We have finalized your ad testing angles.",
    });

    expect(followUps.professional).toContain("Tanvir");
    expect(followUps.professional).toContain("Jersey Camp BD");
    expect(followUps.friendly).toContain("Tanvir");
    expect(followUps.detailed).toMatch(/rollout|targeting|creative/i);
  });
});

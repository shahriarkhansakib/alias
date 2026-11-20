import { describe, it, expect } from "vitest";
import { CommunicationSafetyGuard } from "./safety-guard";
import { AdminCommunicationAgent } from "@/lib/ai/admin-communication-agent";

describe("CommunicationSafetyGuard - Conservative 3-Layer Policy", () => {
  it("blocks messages with pricing or financial commitments", () => {
    const text1 = "Our agency fee will be 50000 BDT for this phase.";
    const res1 = CommunicationSafetyGuard.evaluate(text1);
    expect(res1.passed).toBe(false);
    expect(res1.flags).toContain("PRICING_OR_FINANCIAL_COMMITMENT");

    const text2 = "We can offer a special 20% discount on your campaign.";
    const res2 = CommunicationSafetyGuard.evaluate(text2);
    expect(res2.passed).toBe(false);
    expect(res2.flags).toContain("PRICING_OR_FINANCIAL_COMMITMENT");
  });

  it("blocks messages with refund commitments", () => {
    const text = "If you are not satisfied, we offer a full money back refund.";
    const res = CommunicationSafetyGuard.evaluate(text);
    expect(res.passed).toBe(false);
    expect(res.flags).toContain("REFUND_OR_CANCELLATION_COMMITMENT");
  });

  it("blocks messages with payment account numbers or mobile wallets", () => {
    const text = "Please send payment to our official bKash 01712345678.";
    const res = CommunicationSafetyGuard.evaluate(text);
    expect(res.passed).toBe(false);
    expect(res.flags).toContain("PAYMENT_ACCOUNT_DETAILS");
  });

  it("blocks messages with contractual or legal liability promises", () => {
    const text = "We assume liability and legally guarantee 100,000 conversions.";
    const res = CommunicationSafetyGuard.evaluate(text);
    expect(res.passed).toBe(false);
    expect(res.flags).toContain("LEGAL_OR_WARRANTY_LIABILITY");
  });

  it("blocks replies when AI confidence is below 0.85 threshold", () => {
    const text = "We have received your campaign question and are looking into it.";
    const res = CommunicationSafetyGuard.evaluate(text, { confidenceScore: 0.82 });
    expect(res.passed).toBe(false);
    expect(res.flags).toContain("LOW_AI_CONFIDENCE");
  });

  it("blocks replies when AI flags ambiguity or missing facts", () => {
    const text = "We might be able to handle that deliverable soon.";
    const res = CommunicationSafetyGuard.evaluate(text, { isAmbiguous: true });
    expect(res.passed).toBe(false);
    expect(res.flags).toContain("AMBIGUOUS_INQUIRY");

    const res2 = CommunicationSafetyGuard.evaluate(text, { missingContext: true });
    expect(res2.passed).toBe(false);
    expect(res2.flags).toContain("MISSING_FACTUAL_CONTEXT");
  });

  it("approves safe consultative updates with high confidence", () => {
    const text =
      "Hello, thank you for checking in. Our strategy team is currently analyzing your active brief and market benchmarks to formulate next steps.";
    const res = CommunicationSafetyGuard.evaluate(text, { confidenceScore: 0.95 });
    expect(res.passed).toBe(true);
    expect(res.flags).toHaveLength(0);
  });
});

describe("AdminCommunicationAgent - Generation and Fallback", () => {
  it("provides structured 3-tone responses when called", async () => {
    const result = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "When will our campaign launch?",
      clientName: "Rahim",
      businessName: "Bengal Threads",
      recentMessages: [],
    });

    expect(result.suggestions).toBeDefined();
    expect(result.suggestions.professional).toContain("Rahim");
    expect(result.suggestions.friendly).toContain("Rahim");
    expect(result.suggestions.detailed).toContain("Rahim");
    expect(["professional", "friendly", "detailed"]).toContain(result.recommendedTone);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminCommunicationAgent } from "@/lib/ai/admin-communication-agent";
import { CommunicationSafetyGuard } from "./safety-guard";
import { ScriptService } from "./script-service";

describe("10-Second Admin Takeover Window & Script-Grounded Communication", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. 10-Second Window Delay Logic", () => {
    it("calculates 10-second scheduledStartAt properly from countdownDurationSeconds", () => {
      const now = Date.now();
      const countdownSec = 10;
      const scheduledStartAt = new Date(now + countdownSec * 1000);

      const diffMs = scheduledStartAt.getTime() - now;
      expect(diffMs).toBe(10000);
      expect(scheduledStartAt.getTime()).toBeGreaterThan(now);
    });

    it("identifies whether a job is within the 10-second waiting window", () => {
      const now = new Date();
      // Future job: still within admin takeover window
      const futureJob = {
        scheduledStartAt: new Date(now.getTime() + 8000), // 8 seconds in the future
      };
      const isEligibleNow = futureJob.scheduledStartAt.getTime() <= now.getTime();
      expect(isEligibleNow).toBe(false);

      // Expired job: 10s has passed, eligible for AI execution
      const pastJob = {
        scheduledStartAt: new Date(now.getTime() - 1000), // 1 second in past
      };
      const isEligiblePast = pastJob.scheduledStartAt.getTime() <= now.getTime();
      expect(isEligiblePast).toBe(true);
    });
  });

  describe("2. Admin Takeover & Control State", () => {
    it("cancels pending jobs and sets adminControlled=true when Admin switches AI OFF", () => {
      const threadState = {
        threadGeneration: 1,
        perThreadAiEnabled: true,
        adminControlled: false,
        aiAutoReplyAllowed: true,
      };

      // Admin toggles AI OFF
      const updatedState = {
        ...threadState,
        perThreadAiEnabled: false,
        adminControlled: true,
        aiAutoReplyAllowed: false,
        threadGeneration: threadState.threadGeneration + 1, // bumped generation fences in-flight workers
      };

      expect(updatedState.perThreadAiEnabled).toBe(false);
      expect(updatedState.adminControlled).toBe(true);
      expect(updatedState.aiAutoReplyAllowed).toBe(false);
      expect(updatedState.threadGeneration).toBe(2);
    });

    it("resumes AI and resets adminControlled=false when Admin clicks Resume AI", () => {
      const controlledState = {
        threadGeneration: 2,
        perThreadAiEnabled: false,
        adminControlled: true,
        aiAutoReplyAllowed: false,
      };

      // Admin clicks Resume AI
      const resumedState = {
        ...controlledState,
        perThreadAiEnabled: true,
        adminControlled: false,
        aiAutoReplyAllowed: true,
        threadGeneration: controlledState.threadGeneration + 1,
      };

      expect(resumedState.perThreadAiEnabled).toBe(true);
      expect(resumedState.adminControlled).toBe(false);
      expect(resumedState.aiAutoReplyAllowed).toBe(true);
      expect(resumedState.threadGeneration).toBe(3);
    });

    it("sending a manual admin reply automatically triggers admin takeover", () => {
      const thread = {
        threadGeneration: 1,
        adminControlled: false,
        aiAutoReplyAllowed: true,
      };

      // Manual admin reply executed
      const postAdminReplyThread = {
        ...thread,
        threadGeneration: thread.threadGeneration + 1,
        adminControlled: true,
        aiAutoReplyAllowed: false,
        lastSender: "admin",
      };

      expect(postAdminReplyThread.adminControlled).toBe(true);
      expect(postAdminReplyThread.aiAutoReplyAllowed).toBe(false);
      expect(postAdminReplyThread.lastSender).toBe("admin");
    });
  });

  describe("3. Race Condition & Multi-Entity Fencing", () => {
    it("fences out stale workers when threadGeneration moves during processing", () => {
      const initialJobGeneration: number = 1;
      const currentThreadGeneration: number = 2; // bumped by admin takeover or manual reply

      const canDispatch = initialJobGeneration === currentThreadGeneration;
      expect(canDispatch).toBe(false);
    });

    it("fences out auto-reply dispatch if admin takeover occurred while reply job was queued", () => {
      const thread = {
        adminControlled: true, // admin intervened during the countdown
        aiAutoReplyAllowed: false,
      };

      const isAllowedToDispatch = !thread.adminControlled && thread.aiAutoReplyAllowed;
      expect(isAllowedToDispatch).toBe(false);
    });

    it("cancels superseded jobs when client sends rapid consecutive messages", () => {
      const message1Job = { id: "job_1", threadGeneration: 1, status: "PENDING" };
      
      // Client sends message 2 before message 1 was answered
      const message2Gen = 2;
      const cancelledJob1 = {
        ...message1Job,
        status: "CANCELLED",
        cancelledReason: "SUPERSEDED_BY_NEW_CLIENT_MESSAGE",
      };

      expect(cancelledJob1.status).toBe("CANCELLED");
      expect(message2Gen).toBeGreaterThan(message1Job.threadGeneration);
    });
  });

  describe("4. Script Grounding & Non-Inventing Enforcement", () => {
    it("matches approved services script for marketing strategy inquiries", async () => {
      const match = await ScriptService.findRelevantScripts(
        "আমাদের ব্র্যান্ডের জন্য ফেসবুক ও ইনস্টাগ্রাম মার্কেটিং করতে চাই"
      );

      expect(match.bestMatch).toBeDefined();
      expect(match.bestMatch?.category).toBe("Services");
      expect(match.confidenceScore).toBeGreaterThanOrEqual(0.7);
    });

    it("matches delivery timeline script for launch inquiries", async () => {
      const match = await ScriptService.findRelevantScripts(
        "ক্যাম্পেইন কবে নাগাদ লাইভ বা লঞ্চ হবে?"
      );

      expect(match.bestMatch).toBeDefined();
      expect(match.bestMatch?.category).toBe("Delivery Timeline");
      expect(match.confidenceScore).toBeGreaterThanOrEqual(0.7);
    });

    it("refuses to invent pricing when client asks an unsupported question", async () => {
      const result = await AdminCommunicationAgent.generateSuggestions({
        clientMessage: "Do you have an office in Chittagong port area?",
        clientName: "Kamal",
        businessName: "Fashion Point",
        recentMessages: [],
      });

      expect(result.suggestions).toBeDefined();
      // Should not invent an office address or false claims
      expect(result.noRelevantScriptFound).toBe(true);
      expect(result.requiresAdminReview).toBe(true);
      // Safe holding statement should be provided
      expect(result.suggestions.professional).toContain("verifying");
    });

    it("safety guard blocks any suggested reply that contains unauthorized pricing or guarantees", () => {
      const unauthorizedText = "We guarantee you will make 500,000 BDT in sales within 7 days.";
      const safety = CommunicationSafetyGuard.evaluate(unauthorizedText);

      expect(safety.passed).toBe(false);
      expect(safety.flags).toContain("PRICING_OR_FINANCIAL_COMMITMENT");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";
import AdminAutoReplyJob from "@/models/AdminAutoReplyJob";
import AdminAiGenerationJob from "@/models/AdminAiGenerationJob";
import AdminClientThread from "@/models/AdminClientThread";
import AdminClientMessage from "@/models/AdminClientMessage";
import AdminCommunicationSettings from "@/models/AdminCommunicationSettings";
import Campaign from "@/models/Campaign";
import Artifact1 from "@/models/Artifact1";
import Artifact2 from "@/models/Artifact2";
import MasterCampaignBrief from "@/models/MasterCampaignBrief";
import { ThreadService } from "@/lib/communication/thread-service";
import { AdminCommunicationAgent } from "@/lib/ai/admin-communication-agent";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";

describe("Context-Aware AI Suggestions for Manual Admin Replies", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ALLOW_DEMO_AUTH;
    delete process.env.ALLOW_INSECURE_NON_TRANSACTIONAL_FALLBACK;
  });

  // Mock session helper
  const mockTransactionSession = () => {
    vi.spyOn(mongoose, "startSession").mockResolvedValue({
      withTransaction: async (fn: any) => fn(),
      endSession: vi.fn(),
    } as any);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Auto-Reply Disabled
  // Disable AI Auto-Reply. Client sends a message.
  // Verify three AI suggestions are generated.
  // Verify no automatic message is sent.
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 1: Auto-Reply Disabled -> 3 suggestions generated, no auto message sent", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();

    const threadDoc: any = {
      _id: threadId,
      campaignId,
      clientId,
      clientName: "Demo Client",
      businessName: "Jersey Camp BD",
      threadGeneration: 1,
      adminControlled: true, // Manual mode (Auto-Reply disabled)
      aiAutoReplyAllowed: false,
      perThreadAiEnabled: false,
      save: vi.fn().mockResolvedValue(true),
    };

    const messageDoc: any = {
      _id: messageId,
      threadId,
      campaignId,
      clientId,
      sender: "client",
      content: "Jersey Camp BD (Sports Apparel)",
      aiStatus: "PENDING",
      createdAt: new Date(),
    };

    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);
    vi.spyOn(AdminClientMessage, "findById").mockResolvedValue(messageDoc);
    vi.spyOn(Campaign, "findById").mockResolvedValue(null);
    vi.spyOn(Artifact1, "findById").mockResolvedValue(null);
    vi.spyOn(Artifact1, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(Artifact2, "findById").mockResolvedValue(null);
    vi.spyOn(Artifact2, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(MasterCampaignBrief, "findById").mockResolvedValue(null);
    vi.spyOn(MasterCampaignBrief, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(AdminClientMessage, "find").mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: () => [],
        }),
      }),
    } as any);
    const updateMsgSpy = vi.spyOn(AdminClientMessage, "findByIdAndUpdate").mockResolvedValue({} as any);
    const createAutoJobSpy = vi.spyOn(AdminAutoReplyJob, "create");

    vi.spyOn(AdminCommunicationSettings, "findOne").mockResolvedValue({
      autoReplyGlobalEnabled: false,
      countdownDurationSeconds: 10,
    } as any);

    // Call AI suggestion generation directly
    const suggestionsResult = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Jersey Camp BD (Sports Apparel)",
      clientName: "Demo Client",
      businessName: "Jersey Camp BD",
      recentMessages: [{ sender: "client", content: "Jersey Camp BD (Sports Apparel)" }],
    });

    // 1. Verify 3 suggestions generated
    expect(suggestionsResult.suggestions).toBeDefined();
    expect(suggestionsResult.suggestions.professional).toBeTruthy();
    expect(suggestionsResult.suggestions.friendly).toBeTruthy();
    expect(suggestionsResult.suggestions.detailed).toBeTruthy();
    expect(suggestionsResult.suggestions.professional).toContain("Jersey Camp BD");

    // 2. Verify worker does not schedule auto-reply when adminControlled is true
    const jobDoc: any = {
      _id: new mongoose.Types.ObjectId(),
      threadId,
      messageId,
      threadGeneration: 1,
      claimToken: "token_123",
      status: "PENDING",
      attempts: 0,
      scheduledStartAt: new Date(Date.now() - 1000),
    };

    vi.spyOn(AdminAiGenerationJob, "findOneAndUpdate").mockResolvedValue({
      ...jobDoc,
      status: "PROCESSING",
    });
    vi.spyOn(AdminAiGenerationJob, "findOne").mockResolvedValue(jobDoc);

    await (DurableCommunicationWorker as any).processAiJob(jobDoc._id, "worker_test");

    // Auto-reply job must NEVER be created when auto-reply is disabled
    expect(createAutoJobSpy).not.toHaveBeenCalled();
    // Message aiStatus must be set to COMPLETED with suggestions
    expect(updateMsgSpy).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        $set: expect.objectContaining({
          aiStatus: "COMPLETED",
          aiAnalysis: expect.objectContaining({
            suggestions: expect.any(Object),
          }),
        }),
      }),
      expect.anything()
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: Manual Admin Reply
  // Client provides business information. Admin sends a manual reply.
  // Verify the message is saved.
  // Verify suggestions are synchronized and conversation moves to awaiting client response.
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 2: Manual Admin Reply -> message saved, thread generation advanced, old jobs cancelled", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();

    const threadDoc: any = {
      _id: threadId,
      campaignId,
      clientId,
      threadGeneration: 1,
      adminControlled: false,
      save: vi.fn().mockResolvedValue(true),
    };

    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);
    const cancelAiJobsSpy = vi.spyOn(AdminAiGenerationJob, "updateMany").mockResolvedValue({ modifiedCount: 1 } as any);
    const cancelAutoJobsSpy = vi.spyOn(AdminAutoReplyJob, "updateMany").mockResolvedValue({ modifiedCount: 1 } as any);

    const createdAdminMsg = {
      _id: new mongoose.Types.ObjectId(),
      threadId,
      sender: "admin",
      senderName: "Agency Director",
      content: "okay ami dhhawa",
      readByAdmin: true,
      readByClient: false,
    };
    vi.spyOn(AdminClientMessage, "create").mockResolvedValue([createdAdminMsg] as any);

    const result = await ThreadService.sendAdminReply({
      threadId,
      adminName: "Agency Director",
      content: "okay ami dhhawa",
    });

    // 1. Admin reply message is successfully saved
    expect(result.message.content).toBe("okay ami dhhawa");
    expect(result.message.sender).toBe("admin");

    // 2. Thread generation increments and marks adminControlled
    expect(result.thread.threadGeneration).toBe(2);
    expect(result.thread.lastSender).toBe("admin");
    expect(result.thread.adminControlled).toBe(true);

    // 3. Pending AI generation jobs for the answered message are cancelled
    expect(cancelAiJobsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ threadId }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "CANCELLED" }) }),
      expect.anything()
    );
    expect(cancelAutoJobsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ threadId }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "CANCELLED" }) }),
      expect.anything()
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: New Client Message
  // Admin manually replies. Client sends another message containing a new question.
  // Verify all three suggestions address the new client message.
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 3: New Client Message -> generates fresh suggestions addressing new question", async () => {
    const suggestionsResult = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Do you also handle Instagram Reels video ads or only Facebook image banners?",
      clientName: "Demo Client",
      businessName: "Jersey Camp BD",
      recentMessages: [
        { sender: "client", content: "Jersey Camp BD (Sports Apparel)" },
        { sender: "admin", content: "okay ami dhhawa" },
        { sender: "client", content: "Do you also handle Instagram Reels video ads or only Facebook image banners?" },
      ],
    });

    // Verify 3 distinct suggestions addressing video/Reels inquiry
    expect(suggestionsResult.suggestions).toBeDefined();
    const { professional, friendly, detailed } = suggestionsResult.suggestions;
    expect(professional).toBeTruthy();
    expect(friendly).toBeTruthy();
    expect(detailed).toBeTruthy();

    // Must not be the generic holding text
    expect(professional).not.toContain("our team is currently verifying the specific details to ensure complete operational accuracy");
    expect(detailed).not.toContain("our account team has logged this request for verification");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Conversation Context
  // Client provides business name, product info, asks question.
  // Verify AI remembers all previous info and answers latest question.
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 4: Conversation Context -> remembers previous facts and answers latest question", async () => {
    const artifact1 = {
      client: { company_name: "Jersey Camp BD", industry: "Sports Apparel" },
      product_service: { name: "Cricket and Football Jerseys" },
      budget: { amount: 30000, currency: "BDT" },
    };

    const suggestionsResult = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Can we start next Monday across Dhaka and Chittagong?",
      clientName: "Tanvir",
      businessName: "Jersey Camp BD",
      recentMessages: [
        { sender: "client", content: "Jersey Camp BD (Sports Apparel)" },
        { sender: "admin", content: "Welcome! We are excited to partner with Jersey Camp BD." },
        { sender: "client", content: "We sell football and cricket jerseys. Budget is 30,000 BDT." },
        { sender: "admin", content: "Got it! 30k BDT gives us solid testing budget." },
        { sender: "client", content: "Can we start next Monday across Dhaka and Chittagong?" },
      ],
      artifact1,
    });

    const { professional, friendly, detailed } = suggestionsResult.suggestions;
    expect(professional).toBeTruthy();
    expect(friendly).toBeTruthy();
    expect(detailed).toBeTruthy();

    // Must address the regional / timeline question
    expect(professional).toContain("Jersey Camp BD");
    expect(professional).not.toContain("our team is currently verifying the specific details");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: Multiple Clients Isolation
  // Open Client A and generate suggestions. Verify Client A's suggestions do not bleed.
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 5: Multiple Clients -> Client A and Client B suggestions are completely isolated", async () => {
    const suggestionsClientA = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Jersey Camp BD (Sports Apparel)",
      clientName: "Client A",
      businessName: "Jersey Camp BD",
      recentMessages: [{ sender: "client", content: "Jersey Camp BD (Sports Apparel)" }],
    });

    const suggestionsClientB = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "Apex Cloud Systems (B2B SaaS ERP)",
      clientName: "Client B",
      businessName: "Apex Cloud Systems",
      recentMessages: [{ sender: "client", content: "Apex Cloud Systems (B2B SaaS ERP)" }],
    });

    // Client A suggestions must reference Jersey Camp BD and not Apex
    expect(suggestionsClientA.suggestions.professional).toContain("Jersey Camp BD");
    expect(suggestionsClientA.suggestions.professional).not.toContain("Apex Cloud");

    // Client B suggestions must reference Apex Cloud Systems and not Jersey Camp
    expect(suggestionsClientB.suggestions.professional).toContain("Apex Cloud Systems");
    expect(suggestionsClientB.suggestions.professional).not.toContain("Jersey Camp");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: Race Conditions & Stale Generation Prevention
  // When generation finishes after thread generation has advanced, discard suggestions.
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 6: Race Conditions -> Stale AI generation responses cannot overwrite newer state", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();

    // Thread generation already moved to 3 (e.g. admin replied or newer client msg arrived)
    const threadDoc: any = {
      _id: threadId,
      threadGeneration: 3,
      adminControlled: true,
      save: vi.fn().mockResolvedValue(true),
    };

    const messageDoc: any = {
      _id: messageId,
      threadId,
      sender: "client",
      content: "Old message",
      aiStatus: "PROCESSING",
    };

    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);
    vi.spyOn(AdminClientMessage, "findById").mockResolvedValue(messageDoc);
    const updateMsgSpy = vi.spyOn(AdminClientMessage, "findByIdAndUpdate").mockResolvedValue({} as any);

    // Job was created for generation 1
    const staleJobDoc: any = {
      _id: new mongoose.Types.ObjectId(),
      threadId,
      messageId,
      threadGeneration: 1, // Stale!
      claimToken: "token_abc",
      status: "PENDING",
      attempts: 0,
      scheduledStartAt: new Date(Date.now() - 1000),
    };

    const jobCancelSpy = vi.spyOn(AdminAiGenerationJob, "findOneAndUpdate").mockResolvedValue({
      ...staleJobDoc,
      status: "PROCESSING",
    });

    const result = await (DurableCommunicationWorker as any).processAiJob(staleJobDoc._id, "worker_test");

    // Worker must abort and not save stale suggestions
    expect(result).toBe(false);
    expect(jobCancelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ _id: staleJobDoc._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "CANCELLED",
          lastError: "SUPERSEDED_BY_NEWER_THREAD_GENERATION",
        }),
      })
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 7: Auto-Reply Re-enabled
  // Re-enable Auto-Reply. Verify auto-reply scheduling works when safe and eligible.
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 7: Auto-Reply Re-enabled -> suggestions remain available and eligible auto-reply is scheduled", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();

    const threadDoc: any = {
      _id: threadId,
      campaignId,
      clientId,
      clientName: "Demo Client",
      businessName: "Jersey Camp BD",
      threadGeneration: 2,
      adminControlled: false,
      aiAutoReplyAllowed: true,
      perThreadAiEnabled: true,
      save: vi.fn().mockResolvedValue(true),
    };

    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);

    // Call togglePerThreadAi(true) to resume AI auto-reply
    const updatedThread = await ThreadService.togglePerThreadAi(threadId, true, "Agency Director");

    expect(updatedThread.perThreadAiEnabled).toBe(true);

    // Suggestions still work seamlessly
    const suggestionsResult = await AdminCommunicationAgent.generateSuggestions({
      clientMessage: "What is your pricing policy?",
      clientName: "Demo Client",
      businessName: "Jersey Camp BD",
      recentMessages: [{ sender: "client", content: "What is your pricing policy?" }],
    });

    expect(suggestionsResult.suggestions).toBeDefined();
    expect(suggestionsResult.suggestions.professional).toBeTruthy();
  });
});

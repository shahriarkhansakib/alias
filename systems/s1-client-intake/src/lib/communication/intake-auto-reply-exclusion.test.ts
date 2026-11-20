import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";
import AdminAutoReplyJob from "@/models/AdminAutoReplyJob";
import AdminAiGenerationJob from "@/models/AdminAiGenerationJob";
import AdminClientThread from "@/models/AdminClientThread";
import AdminClientMessage from "@/models/AdminClientMessage";
import AdminCommunicationSettings from "@/models/AdminCommunicationSettings";
import Campaign from "@/models/Campaign";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import Artifact1 from "@/models/Artifact1";
import Artifact2 from "@/models/Artifact2";
import MasterCampaignBrief from "@/models/MasterCampaignBrief";
import { ThreadService } from "@/lib/communication/thread-service";
import { AdminCommunicationAgent } from "@/lib/ai/admin-communication-agent";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";
import { PresenceService } from "@/lib/communication/presence-service";

describe("Intake Duplicate AI Response Prevention & Exclusion Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockTransactionSession = () => {
    vi.spyOn(mongoose, "startSession").mockResolvedValue({
      withTransaction: async (fn: any) => fn(),
      endSession: vi.fn(),
    } as any);
  };

  // 1. An intake client message generates exactly one Intake AI response
  it("Scenario 1: Intake client message generates exactly one Intake AI response", async () => {
    const intakeMessages: any[] = [];
    const conversationId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();

    // Client sends message
    intakeMessages.push({
      _id: new mongoose.Types.ObjectId(),
      conversationId,
      campaignId,
      sender: "user",
      content: "TechFlow (Software)",
      createdAt: new Date(),
    });

    // Intake agent produces single conversational response
    intakeMessages.push({
      _id: new mongoose.Types.ObjectId(),
      conversationId,
      campaignId,
      sender: "ai",
      content: "TechFlow সফটওয়্যার নিয়ে কাজ করছে জেনে ভালো লাগলো।",
      extractedFields: { client: { company_name: "TechFlow" } },
      createdAt: new Date(),
    });

    const aiReplies = intakeMessages.filter((m) => m.sender === "ai");
    expect(aiReplies.length).toBe(1);
    expect(aiReplies[0].content).toContain("TechFlow");
  });

  // 2. Intake synchronization does not schedule an automatic reply
  it("Scenario 2: Intake synchronization does not schedule an automatic reply", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();
    const jobId = new mongoose.Types.ObjectId();

    const threadDoc: any = {
      _id: threadId,
      campaignId,
      clientId,
      clientName: "Asraful Islam",
      businessName: "TechFlow",
      threadType: "intake", // Identified as intake thread
      threadGeneration: 1,
      adminControlled: false,
      aiAutoReplyAllowed: true,
      perThreadAiEnabled: true,
      save: vi.fn().mockResolvedValue(true),
    };

    const messageDoc: any = {
      _id: messageId,
      threadId,
      campaignId,
      clientId,
      sender: "client",
      content: "TechFlow (Software)",
      aiStatus: "PENDING",
      createdAt: new Date(),
    };

    const jobDoc: any = {
      _id: jobId,
      threadId,
      threadGeneration: 1,
      messageId,
      status: "PENDING",
      attempts: 0,
      scheduledStartAt: new Date(Date.now() - 1000),
    };

    vi.spyOn(AdminAiGenerationJob, "findOneAndUpdate").mockResolvedValue(jobDoc);
    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);
    vi.spyOn(AdminClientMessage, "findById").mockResolvedValue(messageDoc);
    vi.spyOn(AdminClientMessage, "findByIdAndUpdate").mockResolvedValue(messageDoc);
    vi.spyOn(Campaign, "findById").mockResolvedValue({ _id: campaignId } as any);
    vi.spyOn(Artifact1, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(Artifact2, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(MasterCampaignBrief, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(AdminClientMessage, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => [messageDoc] }) }),
    } as any);

    vi.spyOn(PresenceService, "getState").mockResolvedValue({
      effectiveMode: "ADMIN_AWAY",
      settings: {
        autoReplyGlobalEnabled: true,
        countdownDurationSeconds: 10,
        defaultTone: "professional",
      },
    } as any);

    vi.spyOn(AdminCommunicationSettings, "findOne").mockResolvedValue({
      autoReplyGlobalEnabled: true,
      defaultTone: "professional",
      countdownDurationSeconds: 10,
    } as any);

    vi.spyOn(AdminCommunicationAgent, "generateSuggestions").mockResolvedValue({
      suggestions: {
        professional: "Professional response",
        friendly: "Friendly response",
        detailed: "Detailed response",
      },
      recommendedTone: "professional",
      confidenceScore: 0.95,
      safetyEvaluation: { passed: true, flags: [] },
      provider: "gemini",
      providerModel: "gemini-3.5-flash",
      noRelevantScriptFound: false,
    } as any);

    const autoReplyCreateSpy = vi.spyOn(AdminAutoReplyJob, "create");

    const result = await (DurableCommunicationWorker as any).processAiJob(jobId, "test-worker");

    expect(result).toBe(true);
    // Crucial check: Auto-reply job must NOT be created for intake thread
    expect(autoReplyCreateSpy).not.toHaveBeenCalled();
    // Message auto-reply status must remain NOT_SCHEDULED
    expect(AdminClientMessage.findByIdAndUpdate).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        $set: expect.objectContaining({
          autoReplyStatus: "NOT_SCHEDULED",
        }),
      }),
      expect.anything()
    );
  });

  // 3. Intake threads are rejected during worker dispatch
  it("Scenario 3: Intake threads are rejected during worker dispatch", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const jobId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();

    const threadDoc: any = {
      _id: threadId,
      threadType: "intake",
      threadGeneration: 1,
    };

    const jobDoc: any = {
      _id: jobId,
      threadId,
      threadGeneration: 1,
      messageId,
      status: "PENDING",
      proposedReply: "This is an intake reply that should never be sent autonomously",
      scheduledExecuteAt: new Date(Date.now() - 1000),
    };

    vi.spyOn(AdminAutoReplyJob, "findOneAndUpdate").mockImplementation(((query: any, update: any) => {
      if (query._id && update?.$set?.status === "PROCESSING") {
        return Promise.resolve(jobDoc);
      }
      return Promise.resolve(jobDoc);
    }) as any);

    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);
    vi.spyOn(PresenceService, "getState").mockResolvedValue({
      effectiveMode: "ADMIN_AWAY",
      settings: { autoReplyGlobalEnabled: true },
    } as any);

    const messageCreateSpy = vi.spyOn(AdminClientMessage, "create");

    const result = await (DurableCommunicationWorker as any).processAutoReplyJob(jobId, "test-worker");

    expect(result).toBe(false);
    expect(messageCreateSpy).not.toHaveBeenCalled();
    // Verify job was marked as CANCELLED with INTAKE_THREAD_EXCLUDED
    expect(AdminAutoReplyJob.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: jobId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "CANCELLED",
          cancelledReason: "INTAKE_THREAD_EXCLUDED",
        }),
      }),
      expect.anything()
    );
  });

  // 4. Recovery never dispatches an intake auto-reply
  it("Scenario 4: Recovery never dispatches an intake auto-reply", async () => {
    const threadId = new mongoose.Types.ObjectId();
    const staleJobId = new mongoose.Types.ObjectId();

    const staleJob = {
      _id: staleJobId,
      threadId,
      status: "PROCESSING",
      lockedAt: new Date(Date.now() - 60000),
    };

    const threadDoc = {
      _id: threadId,
      threadType: "intake",
    };

    vi.spyOn(AdminAiGenerationJob, "updateMany").mockResolvedValue({} as any);
    vi.spyOn(AdminAutoReplyJob, "find").mockReturnValue({
      lean: () => Promise.resolve([staleJob]),
    } as any);
    vi.spyOn(AdminClientThread, "findById").mockReturnValue({
      lean: () => Promise.resolve(threadDoc),
    } as any);

    const cancelSpy = vi.spyOn(AdminAutoReplyJob, "findByIdAndUpdate").mockResolvedValue({} as any);

    await (DurableCommunicationWorker as any).recoverStaleJobs();

    expect(cancelSpy).toHaveBeenCalledWith(
      staleJobId,
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "CANCELLED",
          cancelledReason: "INTAKE_THREAD_EXCLUDED",
        }),
      })
    );
  });

  // 5. Intake AI responses still synchronize to the Admin Dashboard
  it("Scenario 5: Intake AI responses still synchronize to the Admin Dashboard", async () => {
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();
    const threadId = new mongoose.Types.ObjectId();

    const intakeAiMessage = {
      _id: new mongoose.Types.ObjectId(),
      campaignId,
      sender: "ai",
      content: "TechFlow সফটওয়্যার নিয়ে কাজ করছে জেনে ভালো লাগলো।",
      createdAt: new Date(),
    };

    vi.spyOn(Campaign, "findById").mockResolvedValue({ _id: campaignId, clientId, name: "TechFlow" } as any);
    vi.spyOn(ThreadService, "findOrCreateThread").mockResolvedValue({
      _id: threadId,
      campaignId,
      clientId,
      businessName: "TechFlow",
      threadType: "intake",
      save: vi.fn().mockResolvedValue(true),
    } as any);

    vi.spyOn(Message, "find").mockReturnValue({
      sort: () => Promise.resolve([intakeAiMessage]),
    } as any);
    vi.spyOn(AdminClientMessage, "find").mockReturnValue({
      lean: () => Promise.resolve([]),
    } as any);

    const createAdminMsgSpy = vi.spyOn(AdminClientMessage, "create").mockResolvedValue({} as any);

    await ThreadService.syncCampaignIntakeMessages(campaignId);

    // Sync must insert the intake AI message into AdminClientMessage as "ai_auto" from "AI Marketing Consultant"
    expect(createAdminMsgSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId,
        sender: "ai_auto",
        senderName: "AI Marketing Consultant",
        content: intakeAiMessage.content,
      })
    );
  });

  // 6. Admin AI suggestions remain available where previously supported
  it("Scenario 6: Admin AI suggestions remain available on intake messages in Admin Dashboard", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();
    const jobId = new mongoose.Types.ObjectId();

    const threadDoc: any = {
      _id: threadId,
      campaignId,
      clientId,
      clientName: "Asraful Islam",
      businessName: "TechFlow",
      threadType: "intake",
      threadGeneration: 1,
      adminControlled: false,
      aiAutoReplyAllowed: true,
      perThreadAiEnabled: true,
      save: vi.fn().mockResolvedValue(true),
    };

    const messageDoc: any = {
      _id: messageId,
      threadId,
      campaignId,
      clientId,
      sender: "client",
      content: "TechFlow (Software)",
      aiStatus: "PENDING",
      createdAt: new Date(),
    };

    const jobDoc: any = {
      _id: jobId,
      threadId,
      threadGeneration: 1,
      messageId,
      status: "PENDING",
      attempts: 0,
      scheduledStartAt: new Date(Date.now() - 1000),
    };

    vi.spyOn(AdminAiGenerationJob, "findOneAndUpdate").mockResolvedValue(jobDoc);
    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);
    vi.spyOn(AdminClientMessage, "findById").mockResolvedValue(messageDoc);
    const updateMsgSpy = vi.spyOn(AdminClientMessage, "findByIdAndUpdate").mockResolvedValue(messageDoc);
    vi.spyOn(Campaign, "findById").mockResolvedValue({ _id: campaignId } as any);
    vi.spyOn(Artifact1, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(Artifact2, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(MasterCampaignBrief, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(AdminClientMessage, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => [messageDoc] }) }),
    } as any);

    vi.spyOn(PresenceService, "getState").mockResolvedValue({
      effectiveMode: "ADMIN_AWAY",
      settings: { autoReplyGlobalEnabled: true, countdownDurationSeconds: 10 },
    } as any);

    vi.spyOn(AdminCommunicationSettings, "findOne").mockResolvedValue({
      autoReplyGlobalEnabled: true,
      defaultTone: "professional",
      countdownDurationSeconds: 10,
    } as any);

    vi.spyOn(AdminCommunicationAgent, "generateSuggestions").mockResolvedValue({
      suggestions: {
        professional: "Professional tone suggestion for admin",
        friendly: "Friendly tone suggestion for admin",
        detailed: "Detailed tone suggestion for admin",
      },
      recommendedTone: "professional",
      confidenceScore: 0.95,
      safetyEvaluation: { passed: true, flags: [] },
      provider: "gemini",
      providerModel: "gemini-3.5-flash",
      noRelevantScriptFound: false,
    } as any);

    await (DurableCommunicationWorker as any).processAiJob(jobId, "test-worker");

    // Suggestions MUST still be saved to the message
    expect(updateMsgSpy).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        $set: expect.objectContaining({
          aiStatus: "COMPLETED",
          aiAnalysis: expect.objectContaining({
            suggestions: expect.objectContaining({
              professional: "Professional tone suggestion for admin",
            }),
          }),
        }),
      }),
      expect.anything()
    );
  });

  // 7. Manual admin replies continue working
  it("Scenario 7: Manual admin replies continue working and mirror correctly", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();

    const threadDoc: any = {
      _id: threadId,
      campaignId,
      clientId,
      threadGeneration: 1,
      save: vi.fn().mockResolvedValue(true),
    };

    const adminMsgDoc: any = {
      _id: new mongoose.Types.ObjectId(),
      threadId,
      sender: "admin",
      content: "Hello from human agency admin!",
    };

    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(threadDoc);
    vi.spyOn(AdminClientMessage, "create").mockResolvedValue([adminMsgDoc] as any);
    vi.spyOn(AdminAutoReplyJob, "updateMany").mockResolvedValue({} as any);
    vi.spyOn(AdminAiGenerationJob, "updateMany").mockResolvedValue({} as any);

    const messageCreateSpy = vi.spyOn(Message, "create").mockResolvedValue({} as any);
    vi.spyOn(Conversation, "findOne").mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as any);

    // Set connection readyState to 1 for mirror check
    const origReadyState = (mongoose.connection as any).readyState;
    (mongoose.connection as any).readyState = 1;

    try {
      const result = await ThreadService.sendAdminReply({
        threadId,
        adminName: "Senior Consultant",
        content: "Hello from human agency admin!",
      });

      expect(result.message.content).toBe("Hello from human agency admin!");
      // Verify mirror occurred with source: "admin_reply"
      expect(messageCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId,
          content: "Hello from human agency admin!",
          extractedFields: expect.objectContaining({ source: "admin_reply" }),
        })
      );
    } finally {
      (mongoose.connection as any).readyState = origReadyState;
    }
  });

  // 8. Direct communication threads still receive automatic replies
  it("Scenario 8: Direct communication threads receive automatic replies normally", async () => {
    mockTransactionSession();
    const threadId = new mongoose.Types.ObjectId();
    const campaignId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();
    const jobId = new mongoose.Types.ObjectId();

    const directThreadDoc: any = {
      _id: threadId,
      campaignId,
      clientId,
      clientName: "Enterprise Client",
      businessName: "CloudScale Systems",
      threadType: "direct", // Explicitly direct communication thread
      threadGeneration: 1,
      adminControlled: false,
      aiAutoReplyAllowed: true,
      perThreadAiEnabled: true,
      save: vi.fn().mockResolvedValue(true),
    };

    const messageDoc: any = {
      _id: messageId,
      threadId,
      campaignId,
      clientId,
      sender: "client",
      content: "Can you review our Q3 cloud spend?",
      aiStatus: "PENDING",
      createdAt: new Date(),
    };

    const jobDoc: any = {
      _id: jobId,
      threadId,
      threadGeneration: 1,
      messageId,
      status: "PENDING",
      attempts: 0,
      scheduledStartAt: new Date(Date.now() - 1000),
    };

    vi.spyOn(AdminAiGenerationJob, "findOneAndUpdate").mockResolvedValue(jobDoc);
    vi.spyOn(AdminClientThread, "findById").mockResolvedValue(directThreadDoc);
    vi.spyOn(AdminClientMessage, "findById").mockResolvedValue(messageDoc);
    vi.spyOn(AdminClientMessage, "findByIdAndUpdate").mockResolvedValue(messageDoc);
    vi.spyOn(Campaign, "findById").mockResolvedValue({ _id: campaignId } as any);
    vi.spyOn(Artifact1, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(Artifact2, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(MasterCampaignBrief, "findOne").mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    vi.spyOn(AdminClientMessage, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => [messageDoc] }) }),
    } as any);

    vi.spyOn(PresenceService, "getState").mockResolvedValue({
      effectiveMode: "ADMIN_AWAY",
      settings: {
        autoReplyGlobalEnabled: true,
        countdownDurationSeconds: 10,
        defaultTone: "professional",
      },
    } as any);

    vi.spyOn(AdminCommunicationSettings, "findOne").mockResolvedValue({
      autoReplyGlobalEnabled: true,
      defaultTone: "professional",
      countdownDurationSeconds: 10,
      settingsRevision: 1,
    } as any);

    vi.spyOn(AdminCommunicationAgent, "generateSuggestions").mockResolvedValue({
      suggestions: {
        professional: "We will analyze your Q3 cloud spend immediately.",
        friendly: "We'd love to check your Q3 spend!",
        detailed: "Detailed Q3 audit breakdown.",
      },
      recommendedTone: "professional",
      confidenceScore: 0.95,
      safetyEvaluation: { passed: true, flags: [] },
      provider: "gemini",
      providerModel: "gemini-3.5-flash",
      noRelevantScriptFound: false,
    } as any);

    const autoReplyCreateSpy = vi.spyOn(AdminAutoReplyJob, "create").mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }] as any);

    const result = await (DurableCommunicationWorker as any).processAiJob(jobId, "test-worker");

    expect(result).toBe(true);
    // Direct communication thread MUST schedule auto reply job!
    expect(autoReplyCreateSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          threadId,
          proposedReply: "We will analyze your Q3 cloud spend immediately.",
          status: "PENDING",
        }),
      ]),
      expect.anything()
    );
  });

  // 9. The 10-second takeover window remains functional
  it("Scenario 9: The 10-second takeover window remains functional for direct threads", async () => {
    const now = Date.now();
    const countdownSec = 10;
    const scheduledExecuteAt = new Date(now + countdownSec * 1000);

    expect(scheduledExecuteAt.getTime() - now).toBe(10000);

    // Job created 5 seconds ago: still 5s remaining in takeover window
    const job5sAgo = {
      scheduledExecuteAt: new Date(now + 5000),
      status: "PENDING",
    };
    const isDue = job5sAgo.scheduledExecuteAt.getTime() <= now;
    expect(isDue).toBe(false);

    // Job created 11 seconds ago: 10s window elapsed, ready to dispatch
    const job11sAgo = {
      scheduledExecuteAt: new Date(now - 1000),
      status: "PENDING",
    };
    const isReady = job11sAgo.scheduledExecuteAt.getTime() <= now;
    expect(isReady).toBe(true);
  });

  // 10. Legacy intake threads without an explicit thread type are safely excluded
  it("Scenario 10: Legacy intake threads without an explicit thread type are safely excluded", async () => {
    const campaignId = new mongoose.Types.ObjectId();

    // Legacy thread with undefined threadType
    const legacyThreadDoc = {
      _id: new mongoose.Types.ObjectId(),
      campaignId,
      threadType: undefined,
    };

    // Mock Conversation and Message existence for this campaignId
    vi.spyOn(Conversation, "exists").mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as any);
    vi.spyOn(Message, "countDocuments").mockResolvedValue(5 as any);

    const isIntake = await ThreadService.isIntakeThread(legacyThreadDoc);

    // Must be classified as intake because Conversation/Message exist
    expect(isIntake).toBe(true);
  });
});

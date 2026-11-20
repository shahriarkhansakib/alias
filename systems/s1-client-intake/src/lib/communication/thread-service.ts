import mongoose from "mongoose";
import { dbConnect } from "@/lib/db/connect";
import AdminClientThread, { IAdminClientThread } from "@/models/AdminClientThread";
import AdminClientMessage, { IAdminClientMessage } from "@/models/AdminClientMessage";
import AdminAiGenerationJob from "@/models/AdminAiGenerationJob";
import AdminAutoReplyJob from "@/models/AdminAutoReplyJob";
import Campaign from "@/models/Campaign";
import User from "@/models/User";

export class DatabaseTransactionCapabilityError extends Error {
  statusCode: number;
  constructor(message: string, cause?: any) {
    super(message);
    this.name = "DatabaseTransactionCapabilityError";
    this.statusCode = 503;
    if (cause) this.cause = cause;
  }
}

/**
 * Execute a callback within an atomic MongoDB transaction.
 * Fail-closed policy: If replica set transaction capability is unavailable,
 * throws DatabaseTransactionCapabilityError unless explicit insecure fallback
 * is granted in non-production environments.
 */
export async function runCommunicationTransaction<T>(
  callback: (session: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  await dbConnect();
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result!;
  } catch (err: any) {
    const isReplicaSetError =
      err.message?.includes("replica set") ||
      err.message?.includes("Transaction numbers are only allowed") ||
      err.code === 20;

    if (isReplicaSetError) {
      const allowInsecure =
        process.env.ALLOW_INSECURE_NON_TRANSACTIONAL_FALLBACK === "true" &&
        process.env.NODE_ENV !== "production";

      if (!allowInsecure) {
        console.error(
          "[Database Capability Failure] MongoDB multi-document transactions are required for communication atomicity, but current cluster is not a replica set."
        );
        throw new DatabaseTransactionCapabilityError(
          "MongoDB multi-document transaction capability is required for communication atomic guarantees, but the database cluster is not a replica set.",
          err
        );
      }
      console.warn(
        "[WARN] Operating in non-transactional fallback mode because ALLOW_INSECURE_NON_TRANSACTIONAL_FALLBACK is true."
      );
      return await callback(session);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

export class ThreadService {
  /**
   * Determine whether a thread is an intake thread.
   * Checks explicit threadType first, then safely inspects campaign/conversation relationships for legacy records.
   */
  static async isIntakeThread(thread: IAdminClientThread | any): Promise<boolean> {
    if (!thread) return false;
    if (thread.threadType === "intake") return true;
    if (thread.threadType === "direct") return false;

    // Legacy thread check: examine campaign and intake conversation relationships
    try {
      if (thread.campaignId) {
        const ConversationModel = mongoose.models.Conversation || (await import("@/models/Conversation")).default;
        const MessageModel = mongoose.models.Message || (await import("@/models/Message")).default;
        const [convExists, msgCount] = await Promise.all([
          ConversationModel.exists({ campaignId: thread.campaignId }),
          MessageModel.countDocuments({ campaignId: thread.campaignId }),
        ]);
        if (convExists || msgCount > 0) {
          return true;
        }
      }
    } catch (err) {
      console.warn("[ThreadService.isIntakeThread] Error resolving legacy thread type:", err);
    }
    return false;
  }

  /**
   * Find or initialize a communication thread between client and agency admin.
   * Handles duplicate key race conditions (Mongo E11000) gracefully.
   */
  static async findOrCreateThread(params: {
    campaignId: string | mongoose.Types.ObjectId;
    clientId: string | mongoose.Types.ObjectId;
    clientName?: string;
    clientEmail?: string;
    businessName?: string;
    threadType?: "intake" | "direct";
  }): Promise<IAdminClientThread> {
    await dbConnect();
    const campaignIdObj = new mongoose.Types.ObjectId(params.campaignId.toString());
    const clientIdObj = new mongoose.Types.ObjectId(params.clientId.toString());

    // Fast-path lookup
    let thread = await AdminClientThread.findOne({
      campaignId: campaignIdObj,
      clientId: clientIdObj,
    });

    if (thread) {
      let needsSave = false;
      if (params.threadType && thread.threadType !== params.threadType) {
        thread.threadType = params.threadType;
        needsSave = true;
      } else if (!thread.threadType) {
        const resolvedType = (await this.isIntakeThread(thread)) ? "intake" : "direct";
        thread.threadType = resolvedType;
        needsSave = true;
      }
      if (params.clientName && thread.clientName !== params.clientName) {
        thread.clientName = params.clientName;
        needsSave = true;
      }
      if (params.clientEmail && thread.clientEmail !== params.clientEmail) {
        thread.clientEmail = params.clientEmail;
        needsSave = true;
      }
      if (params.businessName && thread.businessName !== params.businessName) {
        thread.businessName = params.businessName;
        needsSave = true;
      }
      if (needsSave) {
        await thread.save();
      }
      return thread;
    }

    // Attempt creation with fallback on duplicate race
    try {
      thread = await AdminClientThread.create({
        campaignId: campaignIdObj,
        clientId: clientIdObj,
        clientName: params.clientName || "",
        clientEmail: params.clientEmail || "",
        businessName: params.businessName || "",
        threadType: params.threadType || "intake",
        threadGeneration: 1,
        unreadAdminCount: 0,
        unreadClientCount: 0,
        status: "active",
      });
      return thread;
    } catch (err: any) {
      if (err.code === 11000) {
        const existing = await AdminClientThread.findOne({
          campaignId: campaignIdObj,
          clientId: clientIdObj,
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Client sends an incoming message.
   * Atomic transaction:
   * 1. Inserts incoming AdminClientMessage.
   * 2. Increments AdminClientThread.threadGeneration.
   * 3. Cancels all previous pending/processing auto-reply and AI generation jobs for this thread.
   * 4. Enqueues a durable AdminAiGenerationJob.
   */
  static async sendClientMessage(params: {
    campaignId: string | mongoose.Types.ObjectId;
    clientId: string | mongoose.Types.ObjectId;
    clientName: string;
    content: string;
    idempotencyKey?: string;
    threadType?: "intake" | "direct";
  }): Promise<{ message: IAdminClientMessage; thread: IAdminClientThread }> {
    const thread = await this.findOrCreateThread({
      campaignId: params.campaignId,
      clientId: params.clientId,
      clientName: params.clientName,
      threadType: params.threadType || "direct",
    });

    return await runCommunicationTransaction(async (session) => {
      const sessionOpt = { session };

      // 1. Fetch current thread with write lock / fresh state
      const currentThread = await AdminClientThread.findById(thread._id, null, sessionOpt);
      if (!currentThread) {
        throw new Error("Thread not found during message dispatch");
      }

      const nextGeneration = (currentThread.threadGeneration || 1) + 1;

      // 2. Insert incoming message
      const [newMessage] = await AdminClientMessage.create(
        [
          {
            threadId: currentThread._id,
            campaignId: currentThread.campaignId,
            clientId: currentThread.clientId,
            sender: "client",
            senderName: params.clientName || "Client",
            content: params.content.trim(),
            idempotencyKey: params.idempotencyKey,
            aiStatus: "PENDING",
            autoReplyStatus: "NOT_SCHEDULED",
            readByAdmin: false,
            readByClient: true,
          },
        ],
        sessionOpt
      );

      // 3. Cancel all previous PENDING or PROCESSING jobs for this thread
      await AdminAutoReplyJob.updateMany(
        {
          threadId: currentThread._id,
          status: { $in: ["PENDING", "PROCESSING"] },
        },
        {
          $set: {
            status: "CANCELLED",
            cancelledReason: "SUPERSEDED_BY_NEW_CLIENT_MESSAGE",
          },
        },
        sessionOpt
      );

      await AdminAiGenerationJob.updateMany(
        {
          threadId: currentThread._id,
          status: { $in: ["PENDING", "PROCESSING"] },
        },
        {
          $set: {
            status: "CANCELLED",
            lastError: "SUPERSEDED_BY_NEW_CLIENT_MESSAGE",
          },
        },
        sessionOpt
      );

      // 4. Update thread metadata and increment threadGeneration
      currentThread.threadGeneration = nextGeneration;
      currentThread.lastMessageSnippet = params.content.slice(0, 120);
      currentThread.lastMessageAt = new Date();
      currentThread.lastSender = "client";
      currentThread.activeJobId = null;
      currentThread.unreadAdminCount = (currentThread.unreadAdminCount || 0) + 1;
      await currentThread.save(sessionOpt);

      // 5. Enqueue durable AI Generation Job to produce suggested replies for Admin
      const { PresenceService } = await import("@/lib/communication/presence-service");
      const currentState = await PresenceService.getState();
      const canScheduleAi = currentState.effectiveMode !== "MESSAGING_OFF";

      if (canScheduleAi) {
        // AI analyzes client question immediately to provide fresh suggestions for Admin
        const [genJob] = await AdminAiGenerationJob.create(
          [
            {
              threadId: currentThread._id,
              threadGeneration: nextGeneration,
              messageId: newMessage._id,
              idempotencyKey: `gen_${newMessage._id.toString()}`,
              scheduledStartAt: new Date(),
              status: "PENDING",
              attempts: 0,
              lockedAt: null,
              lockedBy: null,
            },
          ],
          sessionOpt
        );

        currentThread.pendingAiJobId = genJob._id;
        currentThread.aiJobScheduledStartAt = new Date();
        currentThread.lastClientMessageAt = new Date();
      } else {
        newMessage.aiStatus = "CANCELLED";
        newMessage.aiError = "MESSAGING_OFF";
        await newMessage.save(sessionOpt);
      }

      return { message: newMessage, thread: currentThread };
    });
  }

  /**
   * Admin sends a manual or approved reply.
   * Atomic transaction:
   * 1. Inserts outgoing AdminClientMessage.
   * 2. Increments AdminClientThread.threadGeneration.
   * 3. Cancels all pending or processing jobs for this thread.
   */
  static async sendAdminReply(params: {
    threadId: string | mongoose.Types.ObjectId;
    adminName: string;
    content: string;
    idempotencyKey?: string;
  }): Promise<{ message: IAdminClientMessage; thread: IAdminClientThread }> {
    await dbConnect();
    const threadIdObj = new mongoose.Types.ObjectId(params.threadId.toString());

    return await runCommunicationTransaction(async (session) => {
      const sessionOpt = { session };

      const currentThread = await AdminClientThread.findById(threadIdObj, null, sessionOpt);
      if (!currentThread) {
        throw new Error("Thread not found");
      }

      const nextGeneration = (currentThread.threadGeneration || 1) + 1;

      // 1. Insert admin message
      const [newMessage] = await AdminClientMessage.create(
        [
          {
            threadId: currentThread._id,
            campaignId: currentThread.campaignId,
            clientId: currentThread.clientId,
            sender: "admin",
            senderName: params.adminName || "Agency Admin",
            content: params.content.trim(),
            idempotencyKey: params.idempotencyKey,
            aiStatus: "COMPLETED",
            autoReplyStatus: "NOT_SCHEDULED",
            readByAdmin: true,
            readByClient: false,
          },
        ],
        sessionOpt
      );

      // 2. Cancel all pending / processing jobs
      await AdminAutoReplyJob.updateMany(
        {
          threadId: currentThread._id,
          status: { $in: ["PENDING", "PROCESSING"] },
        },
        {
          $set: {
            status: "CANCELLED",
            cancelledReason: "CANCELLED_BY_ADMIN_MANUAL_REPLY",
          },
        },
        sessionOpt
      );

      await AdminAiGenerationJob.updateMany(
        {
          threadId: currentThread._id,
          status: { $in: ["PENDING", "PROCESSING"] },
        },
        {
          $set: {
            status: "CANCELLED",
            lastError: "CANCELLED_BY_ADMIN_MANUAL_REPLY",
          },
        },
        sessionOpt
      );

      // 3. Update thread & establish Human Takeover
      currentThread.threadGeneration = nextGeneration;
      currentThread.lastMessageSnippet = params.content.slice(0, 120);
      currentThread.lastMessageAt = new Date();
      currentThread.lastSender = "admin";
      currentThread.activeJobId = null;
      currentThread.unreadClientCount = (currentThread.unreadClientCount || 0) + 1;
      currentThread.adminControlled = true;
      currentThread.adminControlledAt = new Date();
      currentThread.adminControlledBy = params.adminName || "Agency Admin";
      currentThread.aiAutoReplyAllowed = false;
      await currentThread.save(sessionOpt);

      // 3b. Immediately cancel and clear any active AI typing state
      try {
        const { TypingStateManager } = await import("@/lib/communication/typing-state-manager");
        const key = currentThread.campaignId?.toString() || currentThread._id.toString();
        TypingStateManager.cancelAiTyping(key);
        TypingStateManager.clearTyping(key);
      } catch {}

      // 4. If thread is associated with a campaign intake, mirror reply to Message model
      if (currentThread.campaignId && mongoose.connection.readyState === 1) {
        try {
          const MessageModel = mongoose.models.Message || (await import("@/models/Message")).default;
          const ConversationModel = mongoose.models.Conversation || (await import("@/models/Conversation")).default;
          const conv = await ConversationModel.findOne({ campaignId: currentThread.campaignId });
          const conversationId = conv?._id || currentThread.campaignId;
          await MessageModel.create({
            conversationId,
            campaignId: currentThread.campaignId,
            sender: "ai",
            content: params.content.trim(),
            extractedFields: { source: "admin_reply", adminSender: params.adminName || "Agency Admin" },
          });
        } catch (mirrorErr) {
          console.warn("[ThreadService.sendAdminReply] Mirror warning:", mirrorErr);
        }
      }

      return { message: newMessage, thread: currentThread };
    });
  }

  /**
   * Admin stops a pending countdown.
   * Atomic transaction:
   * 1. Increments threadGeneration.
   * 2. Sets thread.activeJobId = null.
   * 3. Cancels pending AdminAutoReplyJob.
   */
  static async stopCountdown(
    threadId: string | mongoose.Types.ObjectId
  ): Promise<{ success: boolean; thread: IAdminClientThread }> {
    await dbConnect();
    const threadIdObj = new mongoose.Types.ObjectId(threadId.toString());

    return await runCommunicationTransaction(async (session) => {
      const sessionOpt = { session };

      const currentThread = await AdminClientThread.findById(threadIdObj, null, sessionOpt);
      if (!currentThread) {
        throw new Error("Thread not found");
      }

      const nextGeneration = (currentThread.threadGeneration || 1) + 1;

      // Cancel pending jobs
      await AdminAutoReplyJob.updateMany(
        {
          threadId: currentThread._id,
          status: { $in: ["PENDING", "PROCESSING"] },
        },
        {
          $set: {
            status: "CANCELLED",
            cancelledReason: "STOPPED_BY_ADMIN",
          },
        },
        sessionOpt
      );

      // If active message has pending auto-reply status, update it
      await AdminClientMessage.updateMany(
        {
          threadId: currentThread._id,
          autoReplyStatus: "PENDING",
        },
        {
          $set: {
            autoReplyStatus: "CANCELLED",
          },
        },
        sessionOpt
      );

      currentThread.threadGeneration = nextGeneration;
      currentThread.activeJobId = null;
      await currentThread.save(sessionOpt);

      // Cancel any active AI typing indicator immediately
      try {
        const { TypingStateManager } = await import("@/lib/communication/typing-state-manager");
        const key = currentThread.campaignId?.toString() || currentThread._id.toString();
        TypingStateManager.cancelAiTyping(key);
        TypingStateManager.clearTyping(key);
      } catch {}

      return { success: true, thread: currentThread };
    });
  }

  /**
   * Retrieve thread messages for Client view.
   * Marks unread admin/ai_auto messages as readByClient.
   */
  static async getClientMessages(threadId: string | mongoose.Types.ObjectId) {
    await dbConnect();
    const threadIdObj = new mongoose.Types.ObjectId(threadId.toString());

    const messages = await AdminClientMessage.find({ threadId: threadIdObj })
      .sort({ createdAt: 1 })
      .lean();

    // Mark messages as read by client
    await AdminClientMessage.updateMany(
      { threadId: threadIdObj, readByClient: false, sender: { $in: ["admin", "ai_auto"] } },
      { $set: { readByClient: true } }
    );

    await AdminClientThread.findByIdAndUpdate(threadIdObj, {
      $set: { unreadClientCount: 0 },
    });

    return messages;
  }

  /**
   * Retrieve thread messages and latest AI suggestions for Admin view.
   * Marks unread client messages as readByAdmin.
   * Purges any legacy duplicate echoes where ai_auto duplicated an admin message.
   */
  static async getAdminMessages(threadId: string | mongoose.Types.ObjectId) {
    await dbConnect();
    const threadIdObj = new mongoose.Types.ObjectId(threadId.toString());

    let messages = await AdminClientMessage.find({ threadId: threadIdObj })
      .sort({ createdAt: 1 })
      .lean();

    // Auto-purge any duplicate echo where an ai_auto message duplicated an admin message
    const adminContents = new Set(
      messages.filter((m) => m.sender === "admin").map((m) => m.content.trim())
    );
    const echoIds = messages
      .filter((m) => m.sender === "ai_auto" && adminContents.has(m.content.trim()))
      .map((m) => m._id);

    if (echoIds.length > 0) {
      await AdminClientMessage.deleteMany({ _id: { $in: echoIds } });
      messages = messages.filter(
        (m) => !(m.sender === "ai_auto" && adminContents.has(m.content.trim()))
      );
    }

    // Mark messages as read by admin
    await AdminClientMessage.updateMany(
      { threadId: threadIdObj, readByAdmin: false, sender: "client" },
      { $set: { readByAdmin: true } }
    );

    await AdminClientThread.findByIdAndUpdate(threadIdObj, {
      $set: { unreadAdminCount: 0 },
    });

    // Find active auto-reply job if any
    const activeJob = await AdminAutoReplyJob.findOne({
      threadId: threadIdObj,
      status: "PENDING",
    }).lean();

    return { messages, activeJob };
  }

  /**
   * Sync intake chat messages for a campaign into the Admin Client Communication Thread.
   * Ensures that whatever the client sends in the intake/onboarding section
   * is instantly visible in the Admin Communication Dashboard.
   */
  static async syncCampaignIntakeMessages(campaignId: string | mongoose.Types.ObjectId) {
    await dbConnect();
    const campaignIdObj = new mongoose.Types.ObjectId(campaignId.toString());
    const campaign = await Campaign.findById(campaignIdObj);
    if (!campaign) return null;

    let user = null;
    if (campaign.clientId) {
      user = await User.findById(campaign.clientId).catch(() => null);
    }

    const clientId = campaign.clientId;
    if (!clientId) return null;

    const clientName = user?.name || "Demo Client";
    const clientEmail = user?.email || "client@example.com";
    const businessName = campaign.name || "Client Campaign";

    const thread = await this.findOrCreateThread({
      campaignId: campaignIdObj,
      clientId,
      clientName,
      clientEmail,
      businessName,
      threadType: "intake",
    });

    const MessageModel = mongoose.models.Message || (await import("@/models/Message")).default;
    const intakeMessages = await MessageModel.find({ campaignId: campaignIdObj }).sort({ createdAt: 1 });

    if (intakeMessages.length === 0) return thread;

    // Check existing messages in AdminClientMessage
    const existingAdminMsgs = await AdminClientMessage.find({ threadId: thread._id }).lean();
    
    // Purge any legacy duplicate echoes where ai_auto duplicated an admin message
    const adminContents = new Set(
      existingAdminMsgs
        .filter((m) => m.sender === "admin")
        .map((m) => m.content.trim())
    );
    const legacyEchoIds = existingAdminMsgs
      .filter((m) => m.sender === "ai_auto" && adminContents.has(m.content.trim()))
      .map((m) => m._id);
    if (legacyEchoIds.length > 0) {
      await AdminClientMessage.deleteMany({ _id: { $in: legacyEchoIds } });
    }

    // Track outbound messages (from admin or ai_auto) to prevent echoing admin manual replies
    const existingOutboundContents = new Set(
      existingAdminMsgs
        .filter((m) => m.sender === "admin" || m.sender === "ai_auto")
        .map((m) => m.content.trim())
    );
    const existingClientContents = new Set(
      existingAdminMsgs
        .filter((m) => m.sender === "client")
        .map((m) => m.content.trim())
    );

    let newCount = 0;
    let lastClientMsgId: mongoose.Types.ObjectId | null = null;
    for (const msg of intakeMessages) {
      if (msg.sender === "system") continue;
      // Skip messages that originated as mirrored admin replies
      if (msg.extractedFields?.source === "admin_reply") continue;

      const isClient = msg.sender === "user";
      const cleanContent = msg.content.trim();

      if (isClient) {
        if (!existingClientContents.has(cleanContent)) {
          const createdMsg = await AdminClientMessage.create({
            threadId: thread._id,
            campaignId: campaignIdObj,
            clientId,
            sender: "client",
            senderName: clientName,
            content: cleanContent,
            aiStatus: "PENDING",
            readByAdmin: false,
            readByClient: true,
            createdAt: msg.createdAt || new Date(),
          });
          existingClientContents.add(cleanContent);
          newCount++;
          lastClientMsgId = createdMsg._id;
        }
      } else {
        // Outbound message (AI consultant from intake or admin reply)
        // If this exact text was already recorded (e.g. from an admin manual reply or existing outbound), DO NOT duplicate it!
        if (!existingOutboundContents.has(cleanContent) && !adminContents.has(cleanContent)) {
          await AdminClientMessage.create({
            threadId: thread._id,
            campaignId: campaignIdObj,
            clientId,
            sender: "ai_auto",
            senderName: "AI Marketing Consultant",
            content: cleanContent,
            aiStatus: "COMPLETED",
            readByAdmin: false,
            readByClient: true,
            createdAt: msg.createdAt || new Date(),
          });
          existingOutboundContents.add(cleanContent);
        }
      }
    }

    const lastMsg = intakeMessages[intakeMessages.length - 1];
    if (lastMsg) {
      thread.lastMessageSnippet = lastMsg.content.slice(0, 120);
      thread.lastMessageAt = lastMsg.createdAt || new Date();
      thread.lastSender = lastMsg.sender === "user" ? "client" : "ai_auto";
      thread.businessName = campaign.name || thread.businessName;
      if (lastMsg.sender === "user") {
        thread.unreadAdminCount = (thread.unreadAdminCount || 0) + newCount;
        if (lastClientMsgId) {
          const nextGen = (thread.threadGeneration || 1) + 1;
          thread.threadGeneration = nextGen;
          await AdminAiGenerationJob.updateMany(
            { threadId: thread._id, status: { $in: ["PENDING", "PROCESSING"] } },
            { $set: { status: "CANCELLED", lastError: "SUPERSEDED_BY_NEW_CLIENT_MESSAGE" } }
          );

          const { PresenceService } = await import("@/lib/communication/presence-service");
          const currentState = await PresenceService.getState();
          // AI suggestions are ALWAYS generated unless global messaging is completely shut off
          const canScheduleAi = currentState.effectiveMode !== "MESSAGING_OFF";

          if (canScheduleAi) {
            await AdminAiGenerationJob.create({
              threadId: thread._id,
              threadGeneration: nextGen,
              messageId: lastClientMsgId,
              idempotencyKey: `gen_${lastClientMsgId.toString()}`,
              scheduledStartAt: new Date(),
              status: "PENDING",
              attempts: 0,
              lockedAt: null,
              lockedBy: null,
            });
            thread.pendingAiJobId = null;
            thread.aiJobScheduledStartAt = new Date();
            thread.lastClientMessageAt = new Date();
          }
        }
      }
      await thread.save();
    }

    return thread;
  }

  /**
   * Admin lists all threads.
   */
  static async getAllThreads() {
    await dbConnect();
    return await AdminClientThread.find()
      .populate("campaignId", "name status")
      .populate("clientId", "name email")
      .sort({ lastMessageAt: -1 })
      .lean();
  }

  /**
   * Get single thread by ID.
   */
  static async getThreadById(threadId: string | mongoose.Types.ObjectId) {
    await dbConnect();
    return await AdminClientThread.findById(threadId)
      .populate("campaignId", "name status")
      .populate("clientId", "name email")
      .lean();
  }

  /**
   * Toggle per-thread AI auto-reply.
   * When disabled: immediately cancels all pending AI generation and auto-reply jobs for this thread.
   * When enabled: marks thread as AI-eligible again.
   */
  static async togglePerThreadAi(
    threadId: string | mongoose.Types.ObjectId,
    enabled: boolean,
    adminName: string = "Agency Admin"
  ): Promise<IAdminClientThread> {
    await dbConnect();
    const threadIdObj = new mongoose.Types.ObjectId(threadId.toString());

    return await runCommunicationTransaction(async (session) => {
      const sessionOpt = { session };
      const thread = await AdminClientThread.findById(threadIdObj, null, sessionOpt);
      if (!thread) throw new Error("Thread not found");

      thread.perThreadAiEnabled = enabled;

      if (!enabled) {
        // Cancel all pending auto-reply jobs for this thread (auto-reply disabled)
        await AdminAutoReplyJob.updateMany(
          { threadId: threadIdObj, status: { $in: ["PENDING", "PROCESSING"] } },
          { $set: { status: "CANCELLED", cancelledReason: "PER_THREAD_AI_DISABLED_BY_ADMIN" } },
          sessionOpt
        );
        // Note: AI Suggestion generation jobs remain active so admin still gets suggestions for manual review
        // Mark thread as admin-controlled, disable auto-reply
        thread.adminControlled = true;
        thread.adminControlledAt = new Date();
        thread.adminControlledBy = adminName;
        thread.aiAutoReplyAllowed = false;
        thread.activeJobId = null;
        thread.pendingAiJobId = null;
        thread.aiJobScheduledStartAt = null;
        // Bump generation to fence in-flight workers
        thread.threadGeneration = (thread.threadGeneration || 1) + 1;

        // Cancel any active AI typing indicator immediately
        try {
          const { TypingStateManager } = await import("@/lib/communication/typing-state-manager");
          const key = thread.campaignId?.toString() || thread._id.toString();
          TypingStateManager.cancelAiTyping(key);
          TypingStateManager.clearTyping(key);
        } catch {}
      } else {
        // Re-enable AI for this thread
        thread.adminControlled = false;
        thread.aiAutoReplyAllowed = true;
        thread.pendingAiJobId = null;
        thread.aiJobScheduledStartAt = null;
        thread.threadGeneration = (thread.threadGeneration || 1) + 1;
      }

      await thread.save(sessionOpt);
      return thread;
    });
  }

  /**
   * Admin resumes AI Auto-Reply for an Admin-controlled thread.
   */
  static async resumeAiAutoReply(
    threadId: string | mongoose.Types.ObjectId
  ): Promise<IAdminClientThread | null> {
    await dbConnect();
    const threadIdObj = new mongoose.Types.ObjectId(threadId.toString());

    return await runCommunicationTransaction(async (session) => {
      const thread = await AdminClientThread.findById(threadIdObj, null, { session });
      if (!thread) return null;

      thread.adminControlled = false;
      thread.aiAutoReplyAllowed = true;
      thread.threadGeneration = (thread.threadGeneration || 1) + 1;
      await thread.save({ session });
      return thread;
    });
  }
}

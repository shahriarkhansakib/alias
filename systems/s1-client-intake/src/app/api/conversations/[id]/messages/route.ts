import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";
import { ConversationAgent } from "@/lib/ai/conversation-agent";
import { ThreadService } from "@/lib/communication/thread-service";
import { TypingStateManager } from "@/lib/communication/typing-state-manager";
import { AiTypingService } from "@/lib/communication/ai-typing-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";
    if (!campaignId || campaignId.toLowerCase() === "new") {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
    }
    const userMessage = body.message?.trim();

    if (!userMessage) {
      return NextResponse.json({ error: "Message content cannot be empty" }, { status: 400 });
    }

    const campaign = await Repository.getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const conversation = await Repository.getConversation(campaignId);
    const conversationId = conversation?._id?.toString() || campaign.conversationId?.toString() || "conv_default";

    // 1. Fetch history and current artifact
    const existingMessages = await Repository.getMessages(campaignId);
    let artifact = await Repository.getArtifact1(campaignId);
    if (!artifact) {
      artifact = await Repository.upsertArtifact1(campaignId, {}, "draft");
    }

    // Check if the latest message was already this user message (e.g. from an immediately preceding failed turn)
    const lastMsg = existingMessages[existingMessages.length - 1];
    const isRetryOfFailedMessage =
      lastMsg && lastMsg.sender === "user" && lastMsg.content.trim() === userMessage.trim();

    if (!isRetryOfFailedMessage) {
      await Repository.createMessage({
        conversationId,
        campaignId,
        sender: "user",
        content: userMessage,
      });

      // Synchronize immediately to Admin Communication Dashboard so admin sees incoming client messages in real time
      try {
        await ThreadService.syncCampaignIntakeMessages(campaignId);
      } catch (e) {
        console.warn("[API/Messages] Immediate intake sync warning:", e);
      }
    }

    // Check if AI is disabled (Admin Controlled, Per-Thread AI Off, Global Auto-Reply Off, or Global Messaging Off)
    let isAiDisabled = false;
    try {
      const AdminClientThread = (await import("@/models/AdminClientThread")).default;
      const AdminCommunicationSettings = (await import("@/models/AdminCommunicationSettings")).default;
      const mongooseMod = (await import("mongoose")).default;
      const campaignIdObj = mongooseMod.Types.ObjectId.isValid(campaignId)
        ? new mongooseMod.Types.ObjectId(campaignId)
        : null;
      const thread = await AdminClientThread.findOne({
        $or: [
          ...(campaignIdObj ? [{ campaignId: campaignIdObj }] : []),
          { campaignId },
        ],
      }).lean();
      const { PresenceService } = await import("@/lib/communication/presence-service");
      const commState = await PresenceService.getState();
      const settings = await AdminCommunicationSettings.findOne({}).lean();

      if (
        commState.effectiveMode === "MESSAGING_OFF" ||
        settings?.autoReplyGlobalEnabled === false ||
        (thread && (thread.adminControlled || thread.perThreadAiEnabled === false || thread.aiAutoReplyAllowed === false))
      ) {
        isAiDisabled = true;
      }
    } catch (checkErr) {
      console.warn("[API/Messages] AI control check warning:", checkErr);
    }

    if (isAiDisabled) {
      return NextResponse.json({
        success: true,
        aiMessage: null,
        systemMessage: null,
        artifact,
        status: "admin_controlled",
        missingFields: [],
        quickReplies: [],
        engine: "paused",
        isAiDisabled: true,
      });
    }

    // Messages prior to the current userMessage
    const priorHistory = isRetryOfFailedMessage
      ? existingMessages.slice(0, -1)
      : existingMessages;

    // 2. Activate AI typing indicator & process with Conversation AI Agent
    const aiStartTime = Date.now();
    TypingStateManager.setAiTyping(campaignId, true, 8000, [conversationId]);

    let agentResult: any;
    try {
      agentResult = await ConversationAgent.processMessage(
        userMessage,
        priorHistory.map((h) => ({ sender: h.sender, content: h.content })),
        artifact
      );
    } catch (agentErr) {
      TypingStateManager.setAiTyping(campaignId, false);
      throw agentErr;
    }

    // 2b. Dynamic Typing Duration: scale with actual response length
    const elapsedTimeMs = Date.now() - aiStartTime;
    const targetDurationMs = AiTypingService.calculateTargetTypingDuration(
      agentResult.ai_message || ""
    );
    const remainingDelay = AiTypingService.calculateRemainingDelay(
      targetDurationMs,
      elapsedTimeMs
    );

    if (remainingDelay > 0) {
      await AiTypingService.waitRemainingDelay(remainingDelay, async () => {
        // Interrupted if Admin started typing or took over
        const current = TypingStateManager.getTypingState(campaignId);
        return current.isTyping && current.source === "admin";
      });
    }

    // 2c. Safety check: Verify Admin has not taken over during generation or wait
    const currentTyping = TypingStateManager.getTypingState(campaignId);
    if (currentTyping.isTyping && currentTyping.source === "admin") {
      TypingStateManager.cancelAiTyping(campaignId);
      return NextResponse.json({
        success: true,
        aiMessage: null,
        systemMessage: null,
        artifact,
        status: "admin_controlled",
        missingFields: [],
        quickReplies: [],
        engine: "paused",
        isAiDisabled: true,
      });
    }

    // Stop AI typing indicator immediately upon reply readiness
    TypingStateManager.setAiTyping(campaignId, false);

    // 3. Save AI response message with extracted fields
    const aiMessage = await Repository.createMessage({
      conversationId,
      campaignId,
      sender: "ai",
      content: agentResult.ai_message,
      extractedFields: agentResult.extracted_updates,
    });

    // 5. Update Artifact 1 with latest verified facts
    const updatedArtifact = await Repository.upsertArtifact1(
      campaignId,
      agentResult.extracted_updates,
      undefined,
      { source: "client_stated" }
    );

    // 5b. Auto-rename campaign as soon as a brand name is confirmed or changed
    const extractedBrandName =
      agentResult.extracted_updates?.client?.company_name ||
      updatedArtifact?.client?.company_name;
    const currentCampaignName = campaign.name || "";
    const isDefaultName =
      !currentCampaignName ||
      currentCampaignName === "New Marketing Campaign" ||
      currentCampaignName === "Untitled Campaign";

    if (
      extractedBrandName &&
      typeof extractedBrandName === "string" &&
      extractedBrandName.trim().length >= 2 &&
      extractedBrandName.toLowerCase() !== "name"
    ) {
      const cleanBrand = extractedBrandName.trim();
      if (isDefaultName || cleanBrand.toLowerCase() !== currentCampaignName.toLowerCase()) {
        await Repository.updateCampaignName(campaignId, cleanBrand);
      }
    }

    // 6. If ready for confirmation, update campaign status and persist system message
    let systemMessage = null;
    if (agentResult.status === "ready_for_confirmation") {
      await Repository.updateCampaignStatus(campaignId, "ready_for_confirmation");
      await Repository.upsertArtifact1(campaignId, {}, "READY_FOR_REVIEW", { source: "client_stated" });
      systemMessage = await Repository.createMessage({
        conversationId,
        campaignId,
        sender: "system",
        content:
          "✓ All essential campaign facts have been collected and structured in Artifact-1! Please review the details on the right panel and proceed to confirmation when ready.",
      });
    }

    // 7. Sync intake messages to Admin Communication Thread in background so Admin sees them live
    try {
      await ThreadService.syncCampaignIntakeMessages(campaignId);
    } catch (syncErr) {
      console.warn("[API/Messages] Failed to sync to admin communication thread:", syncErr);
    }

    return NextResponse.json({
      success: true,
      aiMessage,
      systemMessage,
      artifact: updatedArtifact,
      status: agentResult.status,
      missingFields: agentResult.missing_fields,
      quickReplies: agentResult.quick_replies || [],
      engine: agentResult.engine || "demo",
    });
  } catch (error: any) {
    console.error("[API/Messages] Error processing message:", error);
    try {
      const { id: rawId } = await params;
      const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";
      if (campaignId) {
        TypingStateManager.setAiTyping(campaignId, false);
        await ThreadService.syncCampaignIntakeMessages(campaignId);
      }
    } catch {}
    if (error.code === "AI_UNAVAILABLE" || error.name === "AiUnavailableError") {
      return NextResponse.json(
        { error: "AI is currently unavailable", code: "AI_UNAVAILABLE", details: error.message },
        { status: 503 }
      );
    }
    const status = error.statusCode || (error.name === "DatabaseConnectionError" ? 503 : 500);
    return NextResponse.json(
      { error: "Failed to process chat message", details: error.message },
      { status }
    );
  }
}

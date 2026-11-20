import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { ThreadService } from "@/lib/communication/thread-service";
import { TypingStateManager } from "@/lib/communication/typing-state-manager";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized admin access" }, { status: 403 });
    }

    const { threadId: rawId } = await params;
    const threadId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";
    if (!threadId) {
      return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const isTyping = Boolean(body.isTyping);

    const thread = await ThreadService.getThreadById(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const campaignId = thread.campaignId?._id
      ? String(thread.campaignId._id)
      : thread.campaignId
      ? String(thread.campaignId)
      : threadId;

    // Register alias and set admin typing state (cancels any pending AI typing)
    const state = TypingStateManager.setAdminTyping(
      campaignId,
      admin.id,
      isTyping,
      [threadId, campaignId]
    );

    return NextResponse.json({
      success: true,
      isTyping: state.isTyping,
      source: state.source,
      conversationId: campaignId,
    });
  } catch (error: any) {
    console.error("[API/Admin/Typing/POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to update typing state", details: error.message },
      { status: 500 }
    );
  }
}

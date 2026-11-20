import { NextResponse } from "next/server";
import { ThreadService } from "@/lib/communication/thread-service";
import { CommunicationAuth } from "@/lib/auth/communication-auth";

/**
 * POST /api/admin/communication/threads/:threadId/toggle-ai
 * Body: { enabled: boolean }
 *
 * Enables or disables per-thread AI auto-reply.
 * When disabled (enabled=false):
 *   - Cancels all pending AI generation jobs for this thread immediately.
 *   - Cancels all pending auto-reply jobs for this thread immediately.
 *   - Marks thread as adminControlled=true.
 * When enabled (enabled=true):
 *   - Marks thread as adminControlled=false, aiAutoReplyAllowed=true.
 *   - Future client messages will trigger the standard 10-second window.
 */
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
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

    const thread = await ThreadService.togglePerThreadAi(
      threadId,
      enabled,
      admin.name || "Agency Admin"
    );

    return NextResponse.json({
      success: true,
      thread: {
        _id: thread._id,
        perThreadAiEnabled: thread.perThreadAiEnabled,
        adminControlled: thread.adminControlled,
        aiAutoReplyAllowed: thread.aiAutoReplyAllowed,
        threadGeneration: thread.threadGeneration,
      },
    });
  } catch (error: any) {
    console.error("[API/Admin/ToggleAi/POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to toggle per-thread AI", details: error.message },
      { status: 500 }
    );
  }
}

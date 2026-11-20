import { NextResponse } from "next/server";
import { ThreadService } from "@/lib/communication/thread-service";
import { CommunicationAuth } from "@/lib/auth/communication-auth";

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

    const body = await req.json().catch(() => ({}));
    const content = body.content ? String(body.content).trim() : "";
    const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : undefined;

    if (!content) {
      return NextResponse.json({ error: "Reply content cannot be empty" }, { status: 400 });
    }

    const result = await ThreadService.sendAdminReply({
      threadId,
      adminName: admin.name || "Agency Admin",
      content,
      idempotencyKey,
    });

    return NextResponse.json({
      success: true,
      message: result.message,
      thread: result.thread,
    });
  } catch (error: any) {
    console.error("[API/Admin/Reply/POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to send admin reply", details: error.message },
      { status: 500 }
    );
  }
}

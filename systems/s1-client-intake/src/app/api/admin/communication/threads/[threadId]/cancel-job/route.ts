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

    const result = await ThreadService.stopCountdown(threadId);

    return NextResponse.json({
      success: true,
      thread: result.thread,
    });
  } catch (error: any) {
    console.error("[API/Admin/CancelJob/POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to stop countdown", details: error.message },
      { status: 500 }
    );
  }
}

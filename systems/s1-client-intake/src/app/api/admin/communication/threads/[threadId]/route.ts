import { NextResponse } from "next/server";
import { ThreadService } from "@/lib/communication/thread-service";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";
import AdminAiGenerationJob from "@/models/AdminAiGenerationJob";
import { dbConnect } from "@/lib/db/connect";
import mongoose from "mongoose";

export async function GET(
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

    const thread = await ThreadService.getThreadById(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Process any pending jobs for this thread (only if 10s window has elapsed)
    await DurableCommunicationWorker.processThreadJobs(threadId);

    const { messages, activeJob } = await ThreadService.getAdminMessages(threadId);

    // Look up pending AI generation job for countdown display
    await dbConnect();
    const pendingAiJob = await AdminAiGenerationJob.findOne({
      threadId: new mongoose.Types.ObjectId(threadId),
      status: "PENDING",
    })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({
      success: true,
      thread: {
        ...thread,
        perThreadAiEnabled: (thread as any).perThreadAiEnabled !== false,
        aiJobScheduledStartAt: pendingAiJob?.scheduledStartAt ?? null,
        hasPendingAiJob: !!pendingAiJob,
      },
      messages,
      activeJob,
    });
  } catch (error: any) {
    console.error("[API/Admin/ThreadDetail/GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch thread detail", details: error.message },
      { status: 500 }
    );
  }
}

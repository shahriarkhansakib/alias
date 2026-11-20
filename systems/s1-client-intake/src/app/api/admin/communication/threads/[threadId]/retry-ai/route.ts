import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import AdminClientThread from "@/models/AdminClientThread";
import AdminClientMessage from "@/models/AdminClientMessage";
import AdminAiGenerationJob from "@/models/AdminAiGenerationJob";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";
import { dbConnect } from "@/lib/db/connect";
import mongoose from "mongoose";

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

    await dbConnect();
    const thread = await AdminClientThread.findById(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Find latest client message in this thread
    const latestClientMsg = await AdminClientMessage.findOne({
      threadId: thread._id,
      sender: "client",
    }).sort({ createdAt: -1 });

    if (!latestClientMsg) {
      return NextResponse.json({ error: "No client message found in thread" }, { status: 400 });
    }

    // Reset message aiStatus to PENDING
    latestClientMsg.aiStatus = "PENDING";
    latestClientMsg.aiError = undefined;
    await latestClientMsg.save();

    // Cancel any previous pending jobs for this message
    await AdminAiGenerationJob.updateMany(
      {
        threadId: thread._id,
        messageId: latestClientMsg._id,
        status: { $in: ["PENDING", "PROCESSING"] },
      },
      {
        $set: { status: "CANCELLED", lastError: "RETRY_TRIGGERED_BY_ADMIN" },
      }
    );

    // Create a fresh pending AI generation job
    const newJob = await AdminAiGenerationJob.create({
      threadId: thread._id,
      threadGeneration: thread.threadGeneration,
      messageId: latestClientMsg._id,
      idempotencyKey: `retry_gen_${latestClientMsg._id.toString()}_${Date.now()}`,
      status: "PENDING",
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
    });

    // Process immediately in background/worker
    await DurableCommunicationWorker.processThreadJobs(thread._id);

    return NextResponse.json({
      success: true,
      jobId: newJob._id,
      messageId: latestClientMsg._id,
    });
  } catch (error: any) {
    console.error("[API/Admin/RetryAi] Error:", error);
    return NextResponse.json(
      { error: "Failed to retry AI generation", details: error.message },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { ThreadService } from "@/lib/communication/thread-service";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    const auth = await CommunicationAuth.verifyClientOwnership(campaignId, req);
    if (!auth.authorized || !auth.campaign || !auth.user) {
      const status = auth.status || (auth.user ? 403 : 401);
      return NextResponse.json(
        { error: auth.error || "Unauthorized access to campaign" },
        { status }
      );
    }

    const clientId = auth.campaign.clientId
      ? auth.campaign.clientId.toString()
      : auth.user.id;

    const thread = await ThreadService.findOrCreateThread({
      campaignId,
      clientId,
      clientName: auth.user.name || "Client",
      clientEmail: auth.user.email || "client@example.com",
      businessName: auth.campaign.name || "Campaign Client",
    });

    const messages = await ThreadService.getClientMessages(thread._id);

    return NextResponse.json({
      success: true,
      thread,
      messages,
    });
  } catch (error: any) {
    console.error("[API/ClientMessages/GET] Error:", error);
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: "Failed to fetch messages", details: error.message },
      { status }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    const auth = await CommunicationAuth.verifyClientOwnership(campaignId, req);
    if (!auth.authorized || !auth.campaign || !auth.user) {
      const status = auth.status || (auth.user ? 403 : 401);
      return NextResponse.json(
        { error: auth.error || "Unauthorized access to campaign" },
        { status }
      );
    }

    const body = await req.json().catch(() => ({}));
    const content = body.content ? String(body.content).trim() : "";
    const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : undefined;

    if (!content) {
      return NextResponse.json({ error: "Message content cannot be empty" }, { status: 400 });
    }

    const clientId = auth.campaign.clientId
      ? auth.campaign.clientId.toString()
      : auth.user.id;

    const result = await ThreadService.sendClientMessage({
      campaignId,
      clientId,
      clientName: auth.user.name || "Client",
      content,
      idempotencyKey,
    });

    // Asynchronously kickstart the thread worker for immediate AI analysis
    DurableCommunicationWorker.processThreadJobs(result.thread._id).catch((err) => {
      console.warn("[API/ClientMessages/POST] Non-blocking worker kick error:", err);
    });

    return NextResponse.json({
      success: true,
      message: result.message,
      thread: result.thread,
    });
  } catch (error: any) {
    console.error("[API/ClientMessages/POST] Error:", error);
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: "Failed to send message", details: error.message },
      { status }
    );
  }
}

import { NextResponse } from "next/server";
import { ThreadService } from "@/lib/communication/thread-service";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";
import { CommunicationRateLimiter } from "@/lib/communication/rate-limiter";

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

    // Rate Limiting: per-user and per-campaign/thread (max 5 requests per 10-second window)
    const rateLimit = await CommunicationRateLimiter.checkRateLimit({
      key: `tick:user:${auth.user.id}:campaign:${campaignId}`,
      maxRequests: 5,
      windowSeconds: 10,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded for thread synchronization. Please slow down.",
          retryAfter: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds || 2),
          },
        }
      );
    }

    const clientId = auth.campaign.clientId
      ? auth.campaign.clientId.toString()
      : auth.user.id;

    const thread = await ThreadService.findOrCreateThread({
      campaignId,
      clientId,
      clientName: auth.user.name || "Client",
      businessName: auth.campaign.name || "Campaign Client",
    });

    // Strictly thread-scoped worker execution
    await DurableCommunicationWorker.processThreadJobs(thread._id);

    return NextResponse.json({
      success: true,
      ticked: true,
      threadId: thread._id,
      remaining: rateLimit.remaining,
    });
  } catch (error: any) {
    console.error("[API/ClientMessages/Tick] Error:", error);
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: "Tick failed", details: error.message },
      { status }
    );
  }
}

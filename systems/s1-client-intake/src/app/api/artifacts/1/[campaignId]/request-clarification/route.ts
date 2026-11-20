import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";
import { ThreadService } from "@/lib/communication/thread-service";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    if (!campaignId) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { section, fieldKey, question, requestedBy = "admin" } = body;

    if (!section || !fieldKey) {
      return NextResponse.json(
        { error: "Section and fieldKey are required to request clarification" },
        { status: 400 }
      );
    }

    const artifact = await Repository.requestArtifact1Clarification(
      campaignId,
      section,
      fieldKey,
      question || `Clarification needed on ${section}.${fieldKey}`,
      requestedBy
    );

    // If an optional question was provided, post it as an admin message to the client intake chat
    let message = null;
    if (question && typeof question === "string" && question.trim().length > 0) {
      const conv = await Repository.getConversation(campaignId);
      const conversationId = conv?._id?.toString() || "conv_default";
      message = await Repository.createMessage({
        conversationId,
        campaignId,
        sender: "system",
        content: `[Admin Request]: ${question.trim()}`,
      });

      try {
        await ThreadService.syncCampaignIntakeMessages(campaignId);
      } catch (e) {
        console.warn("[API/Clarification] Sync warning:", e);
      }
    }

    return NextResponse.json({
      success: true,
      artifact,
      message,
    });
  } catch (error: any) {
    console.error("[API/Artifact1/Clarification] Error:", error);
    return NextResponse.json(
      { error: "Failed to request clarification", details: error.message },
      { status: 500 }
    );
  }
}

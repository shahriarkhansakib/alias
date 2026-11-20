import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";

/**
 * Downstream Handoff Endpoint:
 * GET /api/campaigns/[campaignId]/artifacts/client-brief
 * 
 * Returns only the latest CONFIRMED Artifact-1 brief snapshot.
 * Unconfirmed or non-existent briefs return a 404 or 400 error.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id?: string; campaignId?: string }> }
) {
  try {
    const resolvedParams = await params;
    const rawId = resolvedParams.id || resolvedParams.campaignId || "";
    const campaignId = rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "");

    if (!campaignId || campaignId.toLowerCase() === "new") {
      return NextResponse.json(
        { error: "Invalid campaign ID provided" },
        { status: 400 }
      );
    }

    const campaign = await Repository.getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    const confirmedBrief = await Repository.getConfirmedClientBrief(campaignId);

    if (!confirmedBrief) {
      const currentArtifact = await Repository.getArtifact1(campaignId);
      const currentStatus = currentArtifact?.status || "NOT_FOUND";
      return NextResponse.json(
        {
          error: "No confirmed client campaign brief artifact available for downstream pipelines.",
          campaignId,
          status: currentStatus,
          message:
            "Artifact-1 is currently in review or draft stage and must be confirmed by an admin before handoff to downstream AI agents.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      artifactId: confirmedBrief.artifactId,
      campaignId: confirmedBrief.campaignId,
      version: confirmedBrief.version,
      status: "CONFIRMED",
      structuredCampaignInformation: confirmedBrief.structuredCampaignInformation,
      provenanceMetadata: confirmedBrief.provenanceMetadata,
      confirmationMetadata: confirmedBrief.confirmationMetadata,
      artifact: confirmedBrief.artifact,
    });
  } catch (error: any) {
    console.error("[API/ClientBrief/Handoff] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve confirmed client campaign brief",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

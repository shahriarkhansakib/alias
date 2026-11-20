import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";
import { ResearchAgent } from "@/lib/ai/research-agent";
import { BriefAgent } from "@/lib/ai/brief-agent";

export async function GET(req: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await params;
    if (!campaignId || typeof campaignId !== "string" || campaignId.trim().length === 0) {
      return NextResponse.json({ error: "Invalid campaign ID provided" }, { status: 400 });
    }

    const campaign = await Repository.getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const artifact2 = await Repository.getArtifact2(campaignId);
    const artifact1 = await Repository.getArtifact1(campaignId);

    return NextResponse.json({
      success: true,
      campaign,
      artifact1,
      artifact2: artifact2 || null,
      status: artifact2?.research_status || (campaign.status === "researching" ? "IN_PROGRESS" : "NOT_STARTED"),
    });
  } catch (error: any) {
    console.error("[API/Research/GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch research", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  let campaignId = "";
  try {
    const resolvedParams = await params;
    campaignId = resolvedParams.campaignId;
    if (!campaignId || typeof campaignId !== "string" || campaignId.trim().length === 0) {
      return NextResponse.json({ error: "Invalid campaign ID provided" }, { status: 400 });
    }

    const campaign = await Repository.getCampaignById(campaignId);
    const artifact1 = await Repository.getArtifact1(campaignId);

    if (!campaign || !artifact1) {
      return NextResponse.json({ error: "Campaign or Artifact 1 not found" }, { status: 404 });
    }

    // Set campaign status
    await Repository.updateCampaignStatus(campaignId, "researching");

    // Conduct verified research
    const artifact2Data = await ResearchAgent.conductResearch(artifact1);
    const savedArtifact2 = await Repository.saveArtifact2(campaignId, artifact2Data);

    const nextCampaignStatus =
      artifact2Data.research_status === "COMPLETED" || artifact2Data.research_status === "PARTIALLY_COMPLETED"
        ? "research_completed"
        : "collecting";

    await Repository.updateCampaignStatus(campaignId, nextCampaignStatus);

    return NextResponse.json({
      success: true,
      artifact2: savedArtifact2,
      research_status: artifact2Data.research_status,
      stats: artifact2Data.stats,
    });
  } catch (error: any) {
    console.error("[API/Research/POST] Error:", error);
    // Reset campaign status on error so UI does not get permanently stuck in 'researching'
    if (campaignId) {
      try {
        await Repository.updateCampaignStatus(campaignId, "collecting");
      } catch (statusErr) {
        console.error("[API/Research/POST] Failed to reset campaign status on error:", statusErr);
      }
    }
    return NextResponse.json(
      { error: "Failed to execute research", details: error.message },
      { status: 500 }
    );
  }
}

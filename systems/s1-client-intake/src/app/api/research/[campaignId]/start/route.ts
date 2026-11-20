import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";
import { ResearchAgent } from "@/lib/ai/research-agent";
import { BriefAgent } from "@/lib/ai/brief-agent";

export async function POST(req: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await params;
    const campaign = await Repository.getCampaignById(campaignId);
    const artifact1 = await Repository.getArtifact1(campaignId);

    if (!campaign || !artifact1) {
      return NextResponse.json({ error: "Campaign or Artifact 1 not found" }, { status: 404 });
    }

    // Set status to researching
    await Repository.updateCampaignStatus(campaignId, "researching");

    // Conduct Market, Competitor, Audience, Platform, and Pricing Research
    const artifact2Data = await ResearchAgent.conductResearch(artifact1);
    const savedArtifact2 = await Repository.saveArtifact2(campaignId, artifact2Data);

    // Update status to research_completed
    await Repository.updateCampaignStatus(campaignId, "research_completed");

    // Synthesize into Master Campaign Brief
    const masterBriefData = await BriefAgent.generateMasterBrief(artifact1, savedArtifact2);
    const savedBrief = await Repository.saveMasterBrief(campaignId, masterBriefData);

    return NextResponse.json({
      success: true,
      artifact2: savedArtifact2,
      masterBrief: savedBrief,
    });
  } catch (error: any) {
    console.error("[API/Research/Start] Error in research pipeline:", error);
    return NextResponse.json(
      { error: "Failed to complete research and brief generation", details: error.message },
      { status: 500 }
    );
  }
}

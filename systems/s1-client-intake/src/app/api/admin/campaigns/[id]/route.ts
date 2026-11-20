import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: campaignId } = await params;
    const campaign = await Repository.getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const conversation = await Repository.getConversation(campaignId);
    const messages = await Repository.getMessages(campaignId);
    const artifact1 = await Repository.getArtifact1(campaignId);
    const artifact2 = await Repository.getArtifact2(campaignId);
    const masterBrief = await Repository.getMasterBrief(campaignId);

    return NextResponse.json({
      success: true,
      campaign,
      conversation,
      messages,
      artifact1,
      artifact2,
      masterBrief,
    });
  } catch (error: any) {
    console.error("[API/Admin/CampaignDetail] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaign details", details: error.message },
      { status: 500 }
    );
  }
}

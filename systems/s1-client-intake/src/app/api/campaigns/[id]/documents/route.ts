import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";
import { BriefAgent } from "@/lib/ai/brief-agent";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: campaignId } = await params;
    const docs = await Repository.getCampaignDocuments(campaignId);
    if (!docs || (!docs.masterBriefMarkdown && !docs.executionScriptMarkdown)) {
      return NextResponse.json({ error: "Campaign documents not found" }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      masterBriefMarkdown: docs.masterBriefMarkdown,
      executionScriptMarkdown: docs.executionScriptMarkdown,
      status: docs.status,
    });
  } catch (error: any) {
    console.error("[API/CampaignDocuments/GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaign documents", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: campaignId } = await params;
    const artifact1 = await Repository.getArtifact1(campaignId);
    if (!artifact1) {
      return NextResponse.json({ error: "Artifact 1 not found for this campaign" }, { status: 404 });
    }

    const messages = await Repository.getMessages(campaignId);
    const docs = await BriefAgent.generateCampaignDocuments(artifact1, messages);

    await Repository.saveCampaignDocuments(campaignId, {
      masterBriefMarkdown: docs.master_campaign_brief_md,
      executionScriptMarkdown: docs.campaign_execution_script_md,
    });

    return NextResponse.json({
      success: true,
      masterBriefMarkdown: docs.master_campaign_brief_md,
      executionScriptMarkdown: docs.campaign_execution_script_md,
      generated_at: docs.generated_at,
    });
  } catch (error: any) {
    console.error("[API/CampaignDocuments/POST] Error regenerating documents:", error);
    return NextResponse.json(
      { error: "Failed to regenerate campaign documents", details: error.message },
      { status: 500 }
    );
  }
}

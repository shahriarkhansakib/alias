import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";

export async function GET(req: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    if (!campaignId || campaignId.toLowerCase() === "new") {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const campaign = await Repository.getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    let artifact = await Repository.getArtifact1(campaignId);
    if (!artifact) {
      artifact = await Repository.upsertArtifact1(campaignId, {}, "DRAFT");
    }
    return NextResponse.json({ success: true, artifact });
  } catch (error: any) {
    console.error("[API/Artifact1] Error fetching artifact 1:", error);
    return NextResponse.json(
      { error: "Failed to fetch artifact", details: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    if (!campaignId) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const updates = body.updates || body;
    const source = body.source || "admin_provided";
    const status = body.status;
    const reason = body.reason || "Admin edit";
    const modifiedBy = body.modifiedBy || "admin";

    const artifact = await Repository.upsertArtifact1(campaignId, updates, status, {
      source,
      reason,
      modifiedBy,
    });
    return NextResponse.json({ success: true, artifact });
  } catch (error: any) {
    console.error("[API/Artifact1] Error updating artifact 1:", error);
    return NextResponse.json(
      { error: "Failed to update artifact", details: error.message },
      { status: 500 }
    );
  }
}

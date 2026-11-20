import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";
import { BriefAgent } from "@/lib/ai/brief-agent";

export async function POST(req: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await params;
    const body = await req.json().catch(() => ({}));
    const confirmedBy = body.confirmedBy || "admin";

    const existingArtifact = await Repository.getArtifact1(campaignId);
    if (!existingArtifact) {
      return NextResponse.json({ error: "Artifact 1 not found for this campaign" }, { status: 404 });
    }

    // Verify all 6 essential requirements are filled across sections or legacy fields
    const missing: string[] = [];
    const compName =
      existingArtifact.client?.company_name ||
      existingArtifact.sections?.business_profile?.company_name?.value;
    if (!compName || (typeof compName === "string" && compName.trim().length < 2)) {
      missing.push("Company / Brand Name");
    }

    const prodName =
      existingArtifact.product_service?.name ||
      existingArtifact.sections?.product_offering?.name?.value;
    if (!prodName) missing.push("Product / Service Name");

    const objName =
      existingArtifact.campaign?.objective ||
      existingArtifact.sections?.campaign_objectives?.primary_objective?.value;
    if (!objName) missing.push("Campaign Objective");

    const aud =
      existingArtifact.target_audience?.description ||
      existingArtifact.target_audience?.location ||
      existingArtifact.target_audience?.age_range ||
      existingArtifact.sections?.target_audience?.description?.value ||
      existingArtifact.sections?.target_audience?.location?.value ||
      existingArtifact.sections?.target_audience?.age_range?.value;
    if (!aud) missing.push("Target Audience");

    const hasBudget =
      Boolean(existingArtifact.budget?.amount) ||
      existingArtifact.budget?.type === "unknown" ||
      Boolean(existingArtifact.sections?.budget_allocation?.total_budget?.value) ||
      existingArtifact.sections?.budget_allocation?.budget_type?.value === "unknown";
    if (!hasBudget) missing.push("Marketing Budget");

    const hasDuration =
      Boolean(existingArtifact.timeline?.duration) ||
      Boolean(existingArtifact.sections?.execution_timeline?.duration?.value);
    if (!hasDuration) missing.push("Timeline Duration");

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot confirm Artifact-1. Please fill all important requirements first: ${missing.join(", ")}.`,
          missingFields: missing,
        },
        { status: 400 }
      );
    }

    const artifact = await Repository.confirmArtifact1(campaignId, confirmedBy);

    // Fetch conversation history for high-fidelity context
    const messages = await Repository.getMessages(campaignId);

    // Generate campaign documents deliverables for backward compatibility
    let docs: any = null;
    try {
      docs = await BriefAgent.generateCampaignDocuments(artifact, messages);
      await Repository.saveCampaignDocuments(campaignId, {
        masterBriefMarkdown: docs.master_campaign_brief_md,
        executionScriptMarkdown: docs.campaign_execution_script_md,
      });
    } catch (docErr) {
      console.warn("[API/Artifact1/Confirm] Warning generating documents:", docErr);
    }

    return NextResponse.json({
      success: true,
      artifact,
      documents: docs,
      redirectTo: `/campaign/${campaignId}/brief`,
    });
  } catch (error: any) {
    console.error("[API/Artifact1/Confirm] Error confirming artifact 1:", error);
    return NextResponse.json(
      { error: "Failed to confirm artifact and generate campaign documents", details: error.message },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";
import { generateContextualQuickReplies } from "@/lib/ai/conversation-agent";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    if (!campaignId || campaignId.toLowerCase() === "new") {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const campaign = await Repository.getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    let messages = await Repository.getMessages(campaignId);

    // If this is a brand new conversation with no messages yet, seed an initial consultant greeting
    if (!messages || messages.length === 0) {
      const conversation = await Repository.getConversation(campaignId);
      const convId = conversation?._id?.toString() || "conv_init";

      const welcomeMsg = await Repository.createMessage({
        conversationId: convId,
        campaignId,
        sender: "ai",
        content:
          "Hello! I am your AI Marketing Consultant. I will help you formulate a comprehensive campaign strategy. To get started, tell me a little about your brand and what product or service you want to promote.",
      });

      messages = [welcomeMsg];
    }

    // Determine current missing requirements from artifact to provide contextually correct quick replies
    const artifact = await Repository.getArtifact1(campaignId);
    const missing: string[] = [];
    const client = artifact?.client || {};
    const product = artifact?.product_service || {};
    const campaignObj = artifact?.campaign || {};
    const audience = artifact?.target_audience || {};
    const budget = artifact?.budget || {};
    const timeline = artifact?.timeline || {};

    if (!client.company_name) missing.push("company/brand name");
    if (!product.name) missing.push("product or service name");
    if (!campaignObj.objective) missing.push("campaign objective");
    if (!audience.location && !audience.age_range && !audience.description) missing.push("target audience");
    if (!budget.amount && budget.type !== "unknown") missing.push("budget");
    if (!timeline.duration) missing.push("timeline");

    const quickReplies = generateContextualQuickReplies(missing, client.company_name, client.industry);

    return NextResponse.json({ success: true, messages, quickReplies });
  } catch (error: any) {
    console.error("[API/Conversations] Error fetching conversation:", error);
    const status = error.statusCode || (error.name === "DatabaseConnectionError" ? 503 : 500);
    return NextResponse.json(
      { error: "Failed to fetch conversation", details: error.message },
      { status }
    );
  }
}

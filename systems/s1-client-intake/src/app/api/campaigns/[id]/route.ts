import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    if (!campaignId || campaignId.toLowerCase() === "new") {
      return NextResponse.json(
        { error: "Invalid campaign ID", redirect: "/campaign/new" },
        { status: 400 }
      );
    }

    const campaign = await Repository.getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found", campaignId },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, campaign });
  } catch (error: any) {
    console.error("[API/Campaigns/[id]] Error fetching campaign:", error);
    const status = error.statusCode || (error.name === "DatabaseConnectionError" ? 503 : 500);
    return NextResponse.json(
      { error: "Failed to fetch campaign", details: error.message },
      { status }
    );
  }
}

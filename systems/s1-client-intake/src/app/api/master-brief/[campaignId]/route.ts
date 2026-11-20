import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";

export async function GET(req: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await params;
    const brief = await Repository.getMasterBrief(campaignId);
    if (!brief) {
      return NextResponse.json({ error: "Master brief not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, brief });
  } catch (error: any) {
    console.error("[API/MasterBrief] Error fetching master brief:", error);
    return NextResponse.json(
      { error: "Failed to fetch master brief", details: error.message },
      { status: 500 }
    );
  }
}

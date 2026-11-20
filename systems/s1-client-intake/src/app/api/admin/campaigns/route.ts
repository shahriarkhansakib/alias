import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";

export async function GET() {
  try {
    const campaigns = await Repository.getAllCampaigns();
    const stats = await Repository.getAdminStats();
    const storageMode = await Repository.getStorageMode();

    return NextResponse.json({
      success: true,
      campaigns,
      stats,
      storageMode,
    });
  } catch (error: any) {
    console.error("[API/Admin/Campaigns] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch admin campaigns", details: error.message },
      { status: 500 }
    );
  }
}

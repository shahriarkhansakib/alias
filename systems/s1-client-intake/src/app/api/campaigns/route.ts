import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repo";

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const name = body.name || "New Marketing Campaign";

    // Get or create client
    const client = await Repository.getOrCreateDemoClient();
    const clientId = client._id ? client._id.toString() : String(client.id);

    // Create campaign and conversation
    const result = await Repository.createCampaign(name, clientId);

    // Initialize Admin Communication Thread for real-time admin visibility
    try {
      const { ThreadService } = await import("@/lib/communication/thread-service");
      await ThreadService.findOrCreateThread({
        campaignId: result.campaignId,
        clientId,
        clientName: client.name || "Demo Client",
        clientEmail: client.email || "client@example.com",
        businessName: name,
        threadType: "intake",
      });
    } catch (tErr) {
      console.warn("[API/Campaigns] Non-blocking thread init warning:", tErr);
    }

    const storageMode = await Repository.getStorageMode();

    return NextResponse.json({
      success: true,
      campaignId: result.campaignId,
      conversationId: result.conversationId,
      storageMode,
    });
  } catch (error: any) {
    console.error("[API/Campaigns] Error creating campaign:", error);
    const status = error.statusCode || (error.name === "DatabaseConnectionError" ? 503 : 500);
    return NextResponse.json(
      { error: "Failed to create campaign", details: error.message || "Unknown error" },
      { status }
    );
  }
}

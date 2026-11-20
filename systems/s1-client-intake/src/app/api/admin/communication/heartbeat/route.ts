import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { PresenceService } from "@/lib/communication/presence-service";

export async function POST(req: Request) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized admin access" }, { status: 403 });
    }

    const state = await PresenceService.recordHeartbeat(admin.name || "System Admin");

    return NextResponse.json({
      success: true,
      ...state,
    });
  } catch (error: any) {
    console.error("[API/Admin/Heartbeat/POST] Error:", error);
    return NextResponse.json(
      { error: "Heartbeat failed", details: error.message },
      { status: 500 }
    );
  }
}

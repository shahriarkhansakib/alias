import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import AdminCommunicationSettings, { AdminCommunicationMode } from "@/models/AdminCommunicationSettings";
import { PresenceService } from "@/lib/communication/presence-service";
import { dbConnect } from "@/lib/db/connect";

export async function GET(req: Request) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized admin access" }, { status: 403 });
    }

    const state = await PresenceService.getState();

    return NextResponse.json({
      success: true,
      ...state,
    });
  } catch (error: any) {
    console.error("[API/Admin/Settings/GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized admin access" }, { status: 403 });
    }

    await dbConnect();
    const body = await req.json().catch(() => ({}));

    // If mode is being explicitly changed
    if (body.mode && ["ADMIN_ACTIVE", "ADMIN_AWAY", "MESSAGING_OFF"].includes(body.mode)) {
      const manualOverride = body.manualModeOverride !== undefined ? Boolean(body.manualModeOverride) : true;
      await PresenceService.setMode({
        mode: body.mode as AdminCommunicationMode,
        manualOverride,
        adminName: admin.name || "System Admin",
      });
    }

    const settings = await PresenceService.getSettings();

    // Additional configuration updates
    let needsSave = false;
    if (typeof body.countdownDurationSeconds === "number" && body.countdownDurationSeconds >= 5) {
      settings.countdownDurationSeconds = body.countdownDurationSeconds;
      needsSave = true;
    }
    if (typeof body.awayTimeoutSeconds === "number" && body.awayTimeoutSeconds >= 30) {
      settings.awayTimeoutSeconds = body.awayTimeoutSeconds;
      needsSave = true;
    }
    if (body.defaultTone && ["professional", "friendly", "detailed"].includes(body.defaultTone)) {
      settings.defaultTone = body.defaultTone;
      needsSave = true;
    }
    if (typeof body.autoReplyGlobalEnabled === "boolean" && !body.mode) {
      // Legacy compatibility: toggling autoReplyGlobalEnabled maps to ADMIN_AWAY (if true) or ADMIN_ACTIVE (if false)
      const mappedMode: AdminCommunicationMode = body.autoReplyGlobalEnabled ? "ADMIN_AWAY" : "ADMIN_ACTIVE";
      await PresenceService.setMode({
        mode: mappedMode,
        manualOverride: true,
        adminName: admin.name || "System Admin",
      });
      return NextResponse.json({
        success: true,
        ...(await PresenceService.getState()),
      });
    }

    if (needsSave) {
      settings.settingsRevision = (settings.settingsRevision || 1) + 1;
      settings.updatedBy = admin.name || "System Admin";
      await settings.save();
    }

    const state = await PresenceService.getState();

    return NextResponse.json({
      success: true,
      ...state,
    });
  } catch (error: any) {
    console.error("[API/Admin/Settings/POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to update settings", details: error.message },
      { status: 500 }
    );
  }
}

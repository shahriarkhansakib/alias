import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import AdminScript from "@/models/AdminScript";
import { dbConnect } from "@/lib/db/connect";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized admin access" }, { status: 403 });
    }

    const { id: rawId } = await params;
    const id = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

    await dbConnect();
    const script = await AdminScript.findById(id);
    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    script.isActive = !script.isActive;
    script.updatedBy = admin.name || "System Admin";
    await script.save();

    return NextResponse.json({
      success: true,
      script,
    });
  } catch (error: any) {
    console.error("[API/Admin/Scripts/Toggle/PATCH] Error:", error);
    return NextResponse.json(
      { error: "Failed to toggle script", details: error.message },
      { status: 500 }
    );
  }
}

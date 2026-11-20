import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { ScriptService } from "@/lib/communication/script-service";

export async function PUT(
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
    const body = await req.json().catch(() => ({}));

    const updated = await ScriptService.updateScript(id, {
      ...body,
      updatedBy: admin.name || "System Admin",
    });

    if (!updated) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      script: updated,
    });
  } catch (error: any) {
    console.error("[API/Admin/Scripts/PUT] Error:", error);
    return NextResponse.json(
      { error: "Failed to update script", details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const deleted = await ScriptService.deleteScript(id);
    if (!deleted) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Script deleted successfully",
    });
  } catch (error: any) {
    console.error("[API/Admin/Scripts/DELETE] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete script", details: error.message },
      { status: 500 }
    );
  }
}

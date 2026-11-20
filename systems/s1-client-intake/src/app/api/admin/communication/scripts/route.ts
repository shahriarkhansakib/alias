import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { ScriptService } from "@/lib/communication/script-service";

export async function GET(req: Request) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized admin access" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search") || undefined;
    const isActiveParam = searchParams.get("isActive");
    const isActive = isActiveParam !== null ? isActiveParam === "true" : undefined;

    const scripts = await ScriptService.listScripts({ category, search, isActive });

    return NextResponse.json({
      success: true,
      scripts,
    });
  } catch (error: any) {
    console.error("[API/Admin/Scripts/GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch scripts", details: error.message },
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

    const body = await req.json().catch(() => ({}));
    if (!body.title || !body.category || !body.content) {
      return NextResponse.json(
        { error: "Missing required fields: title, category, content" },
        { status: 400 }
      );
    }

    const script = await ScriptService.createScript({
      title: body.title,
      category: body.category,
      content: body.content,
      keywords: body.keywords,
      relevantSituations: body.relevantSituations,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      createdBy: admin.name || "System Admin",
    });

    return NextResponse.json({
      success: true,
      script,
    });
  } catch (error: any) {
    console.error("[API/Admin/Scripts/POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to create script", details: error.message },
      { status: 500 }
    );
  }
}

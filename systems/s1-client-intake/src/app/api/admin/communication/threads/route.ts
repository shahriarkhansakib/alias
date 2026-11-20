import { NextResponse } from "next/server";
import { ThreadService } from "@/lib/communication/thread-service";
import { CommunicationAuth } from "@/lib/auth/communication-auth";

export async function GET(req: Request) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized admin access" }, { status: 403 });
    }

    const threads = await ThreadService.getAllThreads();

    return NextResponse.json({
      success: true,
      threads,
    });
  } catch (error: any) {
    console.error("[API/Admin/Threads/GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch threads", details: error.message },
      { status: 500 }
    );
  }
}

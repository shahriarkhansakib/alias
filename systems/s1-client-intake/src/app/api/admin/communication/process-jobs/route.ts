import { NextResponse } from "next/server";
import { CommunicationAuth } from "@/lib/auth/communication-auth";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";

export async function POST(req: Request) {
  try {
    const admin = await CommunicationAuth.requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized worker trigger" }, { status: 403 });
    }

    const result = await DurableCommunicationWorker.tick();

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error("[API/Admin/ProcessJobs/POST] Error:", error);
    return NextResponse.json(
      { error: "Process jobs failed", details: error.message },
      { status: 500 }
    );
  }
}

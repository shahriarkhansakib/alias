import { NextResponse } from "next/server";
import { DurableCommunicationWorker } from "@/lib/communication/durable-worker";

export async function GET(req: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");

    // Fail-closed verification if CRON_SECRET is configured or in production
    if (cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized cron invocation" }, { status: 401 });
      }
    } else if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET not configured on production deployment" },
        { status: 500 }
      );
    }

    const result = await DurableCommunicationWorker.tick();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (error: any) {
    console.error("[API/Admin/Cron] Error:", error);
    return NextResponse.json(
      { error: "Cron execution failed", details: error.message },
      { status: 500 }
    );
  }
}

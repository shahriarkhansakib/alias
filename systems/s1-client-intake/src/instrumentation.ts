declare global {
  // eslint-disable-next-line no-var
  var __communicationWorkerInterval: NodeJS.Timeout | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      // Clear any existing worker interval from previous HMR reloads
      if (globalThis.__communicationWorkerInterval) {
        clearInterval(globalThis.__communicationWorkerInterval);
        globalThis.__communicationWorkerInterval = undefined;
      }

      const { DurableCommunicationWorker } = await import("@/lib/communication/durable-worker");

      // Background worker tick for persistent Node.js environments (Docker, VPS)
      // Note: On Vercel Serverless, this interval is frozen after request lifecycle;
      // Vercel relies on /api/admin/communication/cron and active client UI tick polling.
      const interval = setInterval(async () => {
        try {
          await DurableCommunicationWorker.tick();
        } catch {
          // DurableCommunicationWorker handles its own error logging and fencing
        }
      }, 3000);

      if (interval.unref) {
        interval.unref();
      }

      globalThis.__communicationWorkerInterval = interval;
    } catch (err) {
      console.error("[Instrumentation] Failed to register communication worker:", err);
    }
  }
}

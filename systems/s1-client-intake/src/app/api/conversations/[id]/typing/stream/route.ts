import { TypingStateManager } from "@/lib/communication/typing-state-manager";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const conversationId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

  if (!conversationId) {
    return new Response("Invalid conversation ID", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Send initial state immediately
      const initial = TypingStateManager.getTypingState(conversationId);
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ isTyping: initial.isTyping })}\n\n`)
      );

      // 2. Subscribe to real-time typing events
      const unsubscribe = TypingStateManager.subscribe(conversationId, (state) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ isTyping: state.isTyping })}\n\n`)
          );
        } catch {
          // Stream controller may be closed
        }
      });

      // 3. Keep-alive heartbeat interval (every 15s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // 4. Clean up on client disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

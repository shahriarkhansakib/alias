import { NextResponse } from "next/server";
import { TypingStateManager } from "@/lib/communication/typing-state-manager";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const conversationId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

  if (!conversationId) {
    return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 });
  }

  const state = TypingStateManager.getTypingState(conversationId);

  return NextResponse.json({
    success: true,
    isTyping: state.isTyping,
    conversationId,
  });
}

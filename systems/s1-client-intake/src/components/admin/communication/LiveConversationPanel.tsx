"use client";

import React, { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  User,
  Sparkles,
  UserCheck,
  Clock,
  Building,
  CheckCircle2,
} from "lucide-react";
import { ThreadItem } from "./ClientInboxPanel";

export interface MessageItem {
  _id: string;
  sender: "client" | "admin" | "ai_auto";
  senderName: string;
  content: string;
  createdAt: string;
  aiStatus?: string;
  aiAnalysis?: any;
  autoReplyStatus?: string;
}

interface LiveConversationPanelProps {
  thread: ThreadItem | null;
  messages: MessageItem[];
  replyText: string;
  setReplyText: (text: string) => void;
  onSendReply: (content: string) => Promise<void>;
  onResumeAi?: (threadId: string) => Promise<void>;
  isSending: boolean;
  isLoading: boolean;
  isResumingAi?: boolean;
}

export function LiveConversationPanel({
  thread,
  messages,
  replyText,
  setReplyText,
  onSendReply,
  onResumeAi,
  isSending,
  isLoading,
  isResumingAi = false,
}: LiveConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const activeThreadIdRef = useRef<string | null>(null);

  const emitTyping = (threadId: string, isTyping: boolean) => {
    if (!threadId) return;
    fetch(`/api/admin/communication/threads/${threadId}/typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isTyping }),
    }).catch(() => {});
  };

  // Clean up typing state on thread change or component unmount
  useEffect(() => {
    const prevThreadId = activeThreadIdRef.current;
    const currentThreadId = thread?._id ? String(thread._id) : null;
    activeThreadIdRef.current = currentThreadId;

    if (prevThreadId && prevThreadId !== currentThreadId) {
      emitTyping(prevThreadId, false);
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }

    return () => {
      if (currentThreadId) {
        emitTyping(currentThreadId, false);
      }
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, [thread?._id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setReplyText(newText);

    if (!thread?._id) return;
    const threadId = String(thread._id);

    if (!newText.trim()) {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      emitTyping(threadId, false);
      return;
    }

    const now = Date.now();
    // Throttle positive typing events to at most once per 1.5s
    if (now - lastTypingSentRef.current > 1500) {
      lastTypingSentRef.current = now;
      emitTyping(threadId, true);
    }

    // Debounce inactivity: hide after 2 seconds
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = setTimeout(() => {
      emitTyping(threadId, false);
      typingTimerRef.current = null;
    }, 2000);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!replyText.trim() || isSending) return;

    // Immediately stop typing indicator on message submission
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (thread?._id) {
      emitTyping(String(thread._id), false);
    }

    onSendReply(replyText.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!thread) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-zinc-50/50 dark:bg-zinc-950 text-zinc-400">
        <Building className="w-12 h-12 text-zinc-300 dark:text-zinc-750 mb-3" />
        <h4 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">
          No Client Conversation Selected
        </h4>
        <p className="text-xs text-zinc-500 max-w-sm mt-1">
          Select an inquiry from the inbox panel on the left to view the live conversation history and manage AI reply suggestions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800">
      {/* Thread Header */}
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm">
            {thread.clientName ? thread.clientName.charAt(0).toUpperCase() : "C"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                {thread.clientName || "Client"}
              </h3>
              <span className="text-xs text-zinc-400 font-normal">
                ({thread.clientEmail || "client@alias.local"})
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              Business:{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {thread.businessName || thread.campaignId?.name || "Active Campaign"}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {thread.adminControlled ? (
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center gap-1.5 border border-purple-300 dark:border-purple-800">
                <UserCheck className="w-3.5 h-3.5" />
                Admin Controlled
              </span>
              {onResumeAi && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResumeAi(thread._id)}
                  disabled={isResumingAi}
                  className="h-7 text-xs bg-white dark:bg-zinc-900 border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 flex items-center gap-1 font-semibold"
                >
                  <Sparkles className="w-3 h-3 text-purple-600" />
                  {isResumingAi ? "Resuming..." : "Resume AI Auto-Reply"}
                </Button>
              )}
            </div>
          ) : (
            <span className="px-2.5 py-1 rounded-full font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Generation #{thread.threadGeneration || 1}
            </span>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {isLoading && messages.length === 0 ? (
          <div className="text-center py-12 text-xs text-zinc-400">Loading conversation...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-xs text-zinc-400">
            No messages recorded in this thread yet.
          </div>
        ) : (
          messages.map((msg) => {
            const isClient = msg.sender === "client";
            const isAi = msg.sender === "ai_auto";

            return (
              <div
                key={msg._id}
                className={`flex flex-col ${isClient ? "items-start" : "items-end"}`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-zinc-500">
                  {isClient ? (
                    <span className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                      <User className="w-3 h-3 text-blue-500" /> {msg.senderName || "Client"}
                    </span>
                  ) : isAi ? (
                    <span className="inline-flex items-center gap-1 font-medium text-purple-600 dark:text-purple-400">
                      <Sparkles className="w-3 h-3" /> ALIAS AI (Auto-Reply)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
                      <UserCheck className="w-3 h-3" /> {msg.senderName || "Agency Admin"}
                    </span>
                  )}
                  <span>•</span>
                  <span className="flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
                    isClient
                      ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-xs"
                      : isAi
                      ? "bg-purple-50 dark:bg-purple-950/40 text-zinc-900 dark:text-zinc-100 border border-purple-200 dark:border-purple-800/60 rounded-br-xs"
                      : "bg-blue-600 text-white rounded-br-xs"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            );
          })
        )}
        <div ref={scrollRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-2"
      >
        <div className="flex gap-2 items-end">
          <Textarea
            value={replyText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type your reply, or select/edit an AI suggestion from the right panel... (Enter to send)"
            className="min-h-[58px] max-h-36 resize-none bg-white dark:bg-zinc-950 text-sm"
            disabled={isSending}
          />
          <Button
            type="submit"
            disabled={isSending || !replyText.trim()}
            className="h-[58px] px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            <Send className="w-4 h-4 mr-2" />
            Send Reply
          </Button>
        </div>
      </form>
    </div>
  );
}

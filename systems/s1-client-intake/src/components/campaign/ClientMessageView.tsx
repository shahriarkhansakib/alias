"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Send,
  Bot,
  UserCheck,
  Clock,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";

interface Message {
  _id: string;
  sender: "client" | "admin" | "ai_auto";
  senderName: string;
  content: string;
  createdAt: string;
  autoReplyStatus?: string;
}

interface ClientMessageViewProps {
  campaignId: string;
  campaignName?: string;
}

export function ClientMessageView({ campaignId, campaignName }: ClientMessageViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRemoteTyping = useTypingIndicator(campaignId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchMessages = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const res = await fetch(`/api/campaigns/${campaignId}/admin-messages`);
      const data = await res.json();
      if (data.success && data.messages) {
        setMessages(data.messages);
      }
      setError(null);
    } catch (err: any) {
      if (!isBackground) {
        setError(err.message || "Failed to load messages");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  // Reconcile and tick thread worker
  const tickWorker = async () => {
    try {
      await fetch(`/api/campaigns/${campaignId}/admin-messages/tick`, {
        method: "POST",
      });
    } catch {
      // Background tick silent failure
    }
  };

  useEffect(() => {
    fetchMessages();

    // 3-second visibility-aware polling loop
    const interval = setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      await tickWorker();
      await fetchMessages(true);
    }, 3000);

    return () => clearInterval(interval);
  }, [campaignId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isRemoteTyping]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || sending) return;

    const content = inputText.trim();
    setInputText("");
    setSending(true);

    try {
      const idempotencyKey = `client_msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const res = await fetch(`/api/campaigns/${campaignId}/admin-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, idempotencyKey }),
      });
      const data = await res.json();
      if (data.success && data.message) {
        setMessages((prev) => [...prev, data.message]);
        scrollToBottom();
      } else {
        setError(data.error || "Failed to send message");
      }
    } catch (err: any) {
      setError(err.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Card className="flex flex-col h-[700px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-semibold text-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
              Agency Direct Communication
            </h3>
            <p className="text-xs text-zinc-500">
              {campaignName ? `Campaign: ${campaignName}` : "Direct account channel with ALIAS agency team"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live Connected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchMessages(false)}
            disabled={loading}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 text-zinc-400">
            <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
              <Bot className="w-6 h-6 text-zinc-500" />
            </div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No messages yet
            </p>
            <p className="text-xs text-zinc-500 max-w-sm mt-1">
              Have questions about your strategy brief, audience targeting, or delivery? Send a message to your agency team below.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isClient = msg.sender === "client";
          const isAi = msg.sender === "ai_auto";

          return (
            <div
              key={msg._id}
              className={`flex flex-col ${isClient ? "items-end" : "items-start"}`}
            >
              <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-zinc-500">
                {isClient ? (
                  <span>You</span>
                ) : isAi ? (
                  <span className="inline-flex items-center gap-1 font-medium text-purple-600 dark:text-purple-400">
                    <Sparkles className="w-3 h-3" /> ALIAS AI (Auto-Reply)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
                    <UserCheck className="w-3 h-3" /> Agency Director
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
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
                  isClient
                    ? "bg-blue-600 text-white rounded-br-xs"
                    : isAi
                    ? "bg-purple-50 dark:bg-purple-950/40 text-zinc-900 dark:text-zinc-100 border border-purple-200 dark:border-purple-800/60 rounded-bl-xs"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-xs"
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          );
        })}
        <TypingIndicator isVisible={isRemoteTyping} />
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSendMessage}
        className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50"
      >
        <div className="flex gap-2 items-end">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message to your agency team... (Enter to send, Shift+Enter for newline)"
            className="min-h-[52px] max-h-32 resize-none bg-white dark:bg-zinc-950 text-sm"
            disabled={sending}
          />
          <Button
            type="submit"
            disabled={sending || !inputText.trim()}
            className="h-[52px] px-5 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Send
          </Button>
        </div>
      </form>
    </Card>
  );
}

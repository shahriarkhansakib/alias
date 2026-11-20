"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Bot, Power, FileText, Sparkles, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientInboxPanel, ThreadItem } from "@/components/admin/communication/ClientInboxPanel";
import {
  LiveConversationPanel,
  MessageItem,
} from "@/components/admin/communication/LiveConversationPanel";
import { AiAssistantPanel } from "@/components/admin/communication/AiAssistantPanel";

export default function AdminCommunicationPage() {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<any | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [activeJob, setActiveJob] = useState<any | null>(null);
  const [replyText, setReplyText] = useState("");
  const [autoReplyGlobalEnabled, setAutoReplyGlobalEnabled] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(10);
  const [defaultTone, setDefaultTone] = useState<"professional" | "friendly" | "detailed">("professional");
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isTogglingSettings, setIsTogglingSettings] = useState(false);
  const [isRetryingAi, setIsRetryingAi] = useState(false);
  const [isTogglingThreadAi, setIsTogglingThreadAi] = useState(false);
  const [isResumingAi, setIsResumingAi] = useState(false);
  const [artifact, setArtifact] = useState<any | null>(null);
  const [isLoadingArtifact, setIsLoadingArtifact] = useState(false);

  // Heartbeat ref to avoid stale closures
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  // Load Global Settings
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/communication/settings");
      const data = await res.json();
      if (data.success && data.settings) {
        setAutoReplyGlobalEnabled(Boolean(data.settings.autoReplyGlobalEnabled));
        setCountdownSeconds(data.settings.countdownDurationSeconds || 10);
        setDefaultTone(data.settings.defaultTone || "professional");
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  // Load All Threads
  const fetchThreads = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setIsLoadingThreads(true);
      const res = await fetch("/api/admin/communication/threads");
      const data = await res.json();
      if (data.success && data.threads) {
        setThreads(data.threads);
        if (!selectedThreadId && data.threads.length > 0) {
          setSelectedThreadId(data.threads[0]._id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch threads:", err);
    } finally {
      if (!isBackground) setIsLoadingThreads(false);
    }
  }, [selectedThreadId]);

  // Load Campaign Artifact-1 (Extracted Facts)
  const fetchCampaignArtifact = useCallback(async (campId: string) => {
    if (!campId) {
      setArtifact(null);
      return;
    }
    try {
      setIsLoadingArtifact(true);
      const res = await fetch(`/api/artifacts/1/${campId}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.artifact) {
          setArtifact(data.artifact);
        }
      }
    } catch (err) {
      console.error("Failed to fetch campaign artifact:", err);
    } finally {
      setIsLoadingArtifact(false);
    }
  }, []);

  // Load Active Thread Messages & Job
  const fetchThreadDetails = useCallback(async (threadId: string, isBackground = false) => {
    try {
      if (!isBackground) setIsLoadingMessages(true);
      const res = await fetch(`/api/admin/communication/threads/${threadId}`);
      const data = await res.json();
      if (data.success) {
        setSelectedThread(data.thread);
        setMessages(data.messages || []);
        setActiveJob(data.activeJob || null);
        const campId = data.thread?.campaignId?._id || data.thread?.campaignId;
        if (campId) {
          fetchCampaignArtifact(String(campId));
        } else {
          setArtifact(null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch thread details:", err);
    } finally {
      if (!isBackground) setIsLoadingMessages(false);
    }
  }, [fetchCampaignArtifact]);

  // Tick worker and refresh on mount & interval
  useEffect(() => {
    fetchSettings();
    fetchThreads();
  }, [fetchSettings, fetchThreads]);

  useEffect(() => {
    if (selectedThreadId) {
      fetchThreadDetails(selectedThreadId);
    }
  }, [selectedThreadId, fetchThreadDetails]);

  // Visibility-aware background polling loop (every 3 seconds)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      // Reconcile pending jobs
      try {
        await fetch("/api/admin/communication/process-jobs", { method: "POST" });
      } catch {}

      fetchThreads(true);
      if (selectedThreadId) {
        fetchThreadDetails(selectedThreadId, true);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [selectedThreadId, fetchThreads, fetchThreadDetails]);

  // Admin presence heartbeat (every 15 seconds)
  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        await fetch("/api/admin/communication/heartbeat", { method: "POST" });
      } catch {}
    };
    sendHeartbeat(); // immediate on mount
    heartbeatRef.current = setInterval(sendHeartbeat, 15000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  // Toggle Auto-Reply Master Switch
  const handleToggleAutoReply = async () => {
    if (isTogglingSettings) return;
    setIsTogglingSettings(true);
    const nextState = !autoReplyGlobalEnabled;
    try {
      const res = await fetch("/api/admin/communication/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReplyGlobalEnabled: nextState }),
      });
      const data = await res.json();
      if (data.success && data.settings) {
        setAutoReplyGlobalEnabled(data.settings.autoReplyGlobalEnabled);
      }
    } catch (err) {
      console.error("Failed to toggle auto-reply:", err);
    } finally {
      setIsTogglingSettings(false);
    }
  };

  // Toggle per-thread AI ON/OFF (the 10-second takeover window action)
  const handleToggleThreadAi = async (enabled: boolean) => {
    if (!selectedThreadId || isTogglingThreadAi) return;
    setIsTogglingThreadAi(true);
    try {
      const res = await fetch(
        `/api/admin/communication/threads/${selectedThreadId}/toggle-ai`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        }
      );
      const data = await res.json();
      if (data.success) {
        // Refresh thread details immediately
        await fetchThreadDetails(selectedThreadId, true);
      }
    } catch (err) {
      console.error("Failed to toggle thread AI:", err);
    } finally {
      setIsTogglingThreadAi(false);
    }
  };

  // Send Admin Reply
  const handleSendReply = async (content: string) => {
    if (!selectedThreadId || isSending) return;
    setIsSending(true);

    try {
      const idempotencyKey = `admin_reply_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const res = await fetch(`/api/admin/communication/threads/${selectedThreadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, idempotencyKey }),
      });
      const data = await res.json();
      if (data.success && data.message) {
        setMessages((prev) => [...prev, data.message]);
        setReplyText("");
        setActiveJob(null);
        fetchThreads(true);
        // Refresh thread to get updated adminControlled state
        await fetchThreadDetails(selectedThreadId, true);
      }
    } catch (err) {
      console.error("Failed to send admin reply:", err);
    } finally {
      setIsSending(false);
    }
  };

  // Stop Auto-Reply Countdown (cancel BOTH auto-reply job and AI generation job)
  const handleStopCountdown = async () => {
    if (!selectedThreadId) return;
    // First cancel the auto-reply countdown job
    try {
      const res = await fetch(`/api/admin/communication/threads/${selectedThreadId}/cancel-job`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setActiveJob(null);
        fetchThreadDetails(selectedThreadId, true);
      }
    } catch (err) {
      console.error("Failed to stop countdown:", err);
    }
    // Also disable per-thread AI to cancel any pending AI generation job
    await handleToggleThreadAi(false);
  };

  // Retry AI Generation
  const handleRetryAi = async () => {
    if (!selectedThreadId || isRetryingAi) return;
    setIsRetryingAi(true);
    try {
      const res = await fetch(`/api/admin/communication/threads/${selectedThreadId}/retry-ai`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        await fetchThreadDetails(selectedThreadId, true);
      }
    } catch (err) {
      console.error("Failed to retry AI generation:", err);
    } finally {
      setIsRetryingAi(false);
    }
  };

  // Resume AI for admin-controlled thread
  const handleResumeAi = async (threadId: string) => {
    if (isResumingAi) return;
    setIsResumingAi(true);
    try {
      const res = await fetch(`/api/admin/communication/threads/${threadId}/resume-ai`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        await fetchThreadDetails(threadId, true);
      }
    } catch (err) {
      console.error("Failed to resume AI:", err);
    } finally {
      setIsResumingAi(false);
    }
  };

  // Handle thread selection with immediate state clearing to prevent cross-client bleed
  const handleSelectThread = (threadId: string) => {
    if (threadId === selectedThreadId) return;
    setSelectedThreadId(threadId);
    setSelectedThread(null);
    setMessages([]);
    setActiveJob(null);
    setArtifact(null);
    fetchThreadDetails(threadId);
  };

  // Re-evaluate conversation state and unanswered client inquiry
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  // Is the conversation currently awaiting client response?
  // True if the admin (or AI auto-reply) has already answered the latest client inquiry
  const isAwaitingClientResponse = Boolean(
    lastMessage && (lastMessage.sender === "admin" || lastMessage.sender === "ai_auto")
  );

  // The latest unanswered client message (only present if the last message in the thread is from the client)
  const unansweredClientMessage =
    !isAwaitingClientResponse && lastMessage && lastMessage.sender === "client"
      ? lastMessage
      : null;

  // The last admin reply (if awaiting client response)
  const lastAdminMessage =
    isAwaitingClientResponse && lastMessage && lastMessage.sender === "admin"
      ? lastMessage
      : [...messages].reverse().find((m) => m.sender === "admin") || null;

  // Latest client message for general reference
  const latestClientMessage =
    [...messages].reverse().find((m) => m.sender === "client") || null;

  // Per-thread AI state
  const perThreadAiEnabled = selectedThread?.perThreadAiEnabled !== false;
  const aiJobScheduledStartAt = selectedThread?.aiJobScheduledStartAt ?? null;
  const hasPendingAiJob = selectedThread?.hasPendingAiJob ?? false;
  const campaignId = selectedThread?.campaignId?._id
    ? String(selectedThread.campaignId._id)
    : selectedThread?.campaignId
    ? String(selectedThread.campaignId)
    : null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-7xl mx-auto -my-4">
      {/* Top Banner Navigation & Master Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-3 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-600" />
              Admin Client Communication Dashboard
            </h2>
            <p className="text-xs text-zinc-500">
              Real-time multi-client inbox with 10-second admin takeover window
            </p>
          </div>
        </div>

        {/* Master Controls */}
        <div className="flex items-center gap-3">
          {/* Auto-Reply Master Toggle */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Power className={`w-3.5 h-3.5 ${autoReplyGlobalEnabled ? "text-emerald-500" : "text-zinc-400"}`} />
              Auto-Reply:
            </span>

            <Button
              size="sm"
              variant={autoReplyGlobalEnabled ? "default" : "outline"}
              onClick={handleToggleAutoReply}
              disabled={isTogglingSettings}
              className={`h-7 px-3 text-xs font-semibold ${
                autoReplyGlobalEnabled
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {autoReplyGlobalEnabled ? `ENABLED (${countdownSeconds}s)` : "DISABLED"}
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchThreads();
              if (selectedThreadId) fetchThreadDetails(selectedThreadId);
            }}
            disabled={isLoadingThreads || isLoadingMessages}
            className="h-8 text-xs"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${
                isLoadingThreads || isLoadingMessages ? "animate-spin" : ""
              }`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* 3-Panel Communication Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Panel 1: Client Inbox (Left) */}
        <div className="w-80 shrink-0">
          <ClientInboxPanel
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelectThread={handleSelectThread}
            isLoading={isLoadingThreads}
          />
        </div>

        {/* Panel 2: Live Conversation (Center) */}
        <LiveConversationPanel
          thread={selectedThread}
          messages={messages}
          replyText={replyText}
          setReplyText={setReplyText}
          onSendReply={handleSendReply}
          onResumeAi={handleResumeAi}
          isSending={isSending}
          isLoading={isLoadingMessages}
          isResumingAi={isResumingAi}
        />

        {/* Panel 3: AI Assistant Copilot & Campaign Brief (Right) */}
        <div className="shrink-0">
          <AiAssistantPanel
            threadId={selectedThreadId}
            threadGeneration={selectedThread?.threadGeneration || 1}
            unansweredClientMessage={unansweredClientMessage}
            isAwaitingClientResponse={isAwaitingClientResponse}
            lastAdminMessage={lastAdminMessage}
            latestClientMessage={latestClientMessage}
            activeJob={activeJob}
            autoReplyGlobalEnabled={autoReplyGlobalEnabled}
            perThreadAiEnabled={perThreadAiEnabled}
            aiJobScheduledStartAt={aiJobScheduledStartAt}
            hasPendingAiJob={hasPendingAiJob}
            artifact={artifact}
            campaignId={campaignId}
            isLoadingArtifact={isLoadingArtifact}
            countdownSeconds={countdownSeconds}
            onUseSuggestion={async (text) => {
              await handleSendReply(text);
            }}
            onEditSuggestion={(text) => {
              setReplyText(text);
            }}
            onStopCountdown={handleStopCountdown}
            onRetryGeneration={handleRetryAi}
            onToggleThreadAi={handleToggleThreadAi}
            onToggleGlobalAutoReply={handleToggleAutoReply}
            onArtifactUpdate={(updated) => setArtifact(updated)}
            isRetrying={isRetryingAi}
            isProcessing={isSending}
            isTogglingThreadAi={isTogglingThreadAi}
          />
        </div>
      </div>
    </div>
  );
}

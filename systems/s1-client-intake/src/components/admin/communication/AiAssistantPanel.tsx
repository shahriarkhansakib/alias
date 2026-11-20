"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Square,
  Copy,
  Send,
  CheckCircle,
  Briefcase,
  Smile,
  FileText,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  Bot,
  BotOff,
  Zap,
  Settings2,
  Check,
  Power,
  ChevronRight,
  Info,
} from "lucide-react";
import { MessageItem } from "./LiveConversationPanel";
import LiveArtifactPreview from "@/components/campaign/LiveArtifactPreview";

export type CopilotState =
  | "IDLE"
  | "WAITING_ADMIN"
  | "ANALYZING"
  | "SUGGESTIONS_READY"
  | "GENERATION_FAILED"
  | "AI_DISABLED"
  | "AWAITING_CLIENT";

export type RightPanelTab = "brief" | "suggestions" | "control";

interface AutoReplyJob {
  _id: string;
  threadGeneration: number;
  scheduledExecuteAt: string;
  proposedReply: string;
  tone: "professional" | "friendly" | "detailed";
  status: string;
}

interface AiAssistantPanelProps {
  threadId?: string | null;
  threadGeneration?: number;
  unansweredClientMessage?: MessageItem | null;
  isAwaitingClientResponse?: boolean;
  lastAdminMessage?: MessageItem | null;
  latestClientMessage?: MessageItem | null;
  activeJob: AutoReplyJob | null;
  autoReplyGlobalEnabled: boolean;
  /** Whether AI auto-reply is enabled for this specific thread */
  perThreadAiEnabled: boolean;
  /** When the pending AI generation job is scheduled to start (the 10s admin window) */
  aiJobScheduledStartAt: string | null;
  /** Whether there is a pending AI generation job */
  hasPendingAiJob: boolean;
  /** Extracted Campaign Facts Artifact-1 */
  artifact?: any | null;
  /** Current Campaign ID */
  campaignId?: string | null;
  /** Loading state for artifact */
  isLoadingArtifact?: boolean;
  /** Delay duration in seconds */
  countdownSeconds?: number;
  onUseSuggestion: (text: string) => Promise<void>;
  onEditSuggestion: (text: string) => void;
  onStopCountdown: () => Promise<void>;
  onRetryGeneration?: () => Promise<void>;
  onToggleThreadAi: (enabled: boolean) => Promise<void>;
  onToggleGlobalAutoReply?: () => Promise<void>;
  onArtifactUpdate?: (updated: any) => void;
  isProcessing: boolean;
  isRetrying?: boolean;
  isTogglingThreadAi?: boolean;
}

export function AiAssistantPanel({
  threadId = null,
  threadGeneration = 1,
  unansweredClientMessage = null,
  isAwaitingClientResponse = false,
  lastAdminMessage = null,
  latestClientMessage = null,
  activeJob,
  autoReplyGlobalEnabled,
  perThreadAiEnabled,
  aiJobScheduledStartAt,
  hasPendingAiJob,
  artifact = null,
  campaignId = null,
  isLoadingArtifact = false,
  countdownSeconds = 10,
  onUseSuggestion,
  onEditSuggestion,
  onArtifactUpdate,
  onStopCountdown,
  onRetryGeneration,
  onToggleThreadAi,
  onToggleGlobalAutoReply,
  isProcessing,
  isRetrying = false,
  isTogglingThreadAi = false,
}: AiAssistantPanelProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>("brief");
  const [autoReplySecondsRemaining, setAutoReplySecondsRemaining] = useState<number | null>(null);
  const [aiWindowSecondsRemaining, setAiWindowSecondsRemaining] = useState<number | null>(null);
  const [copiedTone, setCopiedTone] = useState<string | null>(null);

  // Active client message to evaluate suggestions for
  const activeClientMsg =
    unansweredClientMessage !== undefined
      ? unansweredClientMessage
      : isAwaitingClientResponse
      ? null
      : latestClientMessage;

  // Compute Copilot State - decoupled from Auto-Reply
  let copilotState: CopilotState = "IDLE";
  if (isAwaitingClientResponse) {
    copilotState = "AWAITING_CLIENT";
  } else if (!activeClientMsg) {
    copilotState = "IDLE";
  } else if (
    activeClientMsg.aiStatus === "PENDING" ||
    activeClientMsg.aiStatus === "PROCESSING" ||
    isRetrying
  ) {
    copilotState = "ANALYZING";
  } else if (activeClientMsg.aiAnalysis?.suggestions) {
    copilotState = "SUGGESTIONS_READY";
  } else if (activeClientMsg.aiStatus === "FAILED") {
    copilotState = "GENERATION_FAILED";
  } else {
    copilotState = "IDLE";
  }

  const aiAnalysis = activeClientMsg?.aiAnalysis;
  const suggestions = aiAnalysis?.suggestions;
  const isPendingReply = activeJob && activeJob.status === "PENDING";

  // Auto-reply countdown timer effect
  useEffect(() => {
    if (!isPendingReply || !activeJob?.scheduledExecuteAt) {
      setAutoReplySecondsRemaining(null);
      return;
    }

    const updateTimer = () => {
      const executeAt = new Date(activeJob.scheduledExecuteAt).getTime();
      const now = Date.now();
      const diffMs = executeAt - now;
      setAutoReplySecondsRemaining(diffMs <= 0 ? 0 : Math.ceil(diffMs / 1000));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [activeJob?.scheduledExecuteAt, isPendingReply]);

  // 10-second AI generation window countdown
  useEffect(() => {
    if (!hasPendingAiJob || !aiJobScheduledStartAt) {
      setAiWindowSecondsRemaining(null);
      return;
    }

    const updateTimer = () => {
      const startAt = new Date(aiJobScheduledStartAt).getTime();
      const now = Date.now();
      const diffMs = startAt - now;
      setAiWindowSecondsRemaining(diffMs <= 0 ? 0 : Math.ceil(diffMs / 1000));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [aiJobScheduledStartAt, hasPendingAiJob]);

  const handleCopy = (text: string, tone: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTone(tone);
    setTimeout(() => setCopiedTone(null), 2000);
  };

  const toneConfig = [
    {
      id: "professional" as const,
      label: "Professional",
      icon: Briefcase,
      color: "border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300",
      badge: "Authoritative & Consultative",
    },
    {
      id: "friendly" as const,
      label: "Friendly",
      icon: Smile,
      color: "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300",
      badge: "Warm & Conversational",
    },
    {
      id: "detailed" as const,
      label: "Detailed",
      icon: FileText,
      color: "border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-300",
      badge: "Data-Driven & In-Depth",
    },
  ];

  return (
    <div className="w-96 lg:w-[420px] flex flex-col h-full bg-zinc-50/40 dark:bg-zinc-900/30 overflow-hidden border-l border-zinc-200 dark:border-zinc-800">
      {/* ── 3-TAB NAVIGATION HEADER (Campaign Brief | AI Suggestions | AI Control) ── */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
        <div className="flex items-center gap-1.5 p-1 bg-zinc-100/90 dark:bg-zinc-900 rounded-full border border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab("brief")}
            className={`flex-1 py-1.5 px-2 rounded-full text-xs font-semibold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "brief"
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs border border-zinc-200/80 dark:border-zinc-700"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Campaign Brief</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("suggestions")}
            className={`flex-1 py-1.5 px-2 rounded-full text-xs font-semibold transition-all text-center flex items-center justify-center gap-1.5 relative cursor-pointer ${
              activeTab === "suggestions"
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs border border-zinc-200/80 dark:border-zinc-700"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>AI Suggestions</span>
            {suggestions && (
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("control")}
            className={`flex-1 py-1.5 px-2 rounded-full text-xs font-semibold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "control"
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs border border-zinc-200/80 dark:border-zinc-700"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <Settings2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>AI Control</span>
            <span
              className={`w-2 h-2 rounded-full ${
                perThreadAiEnabled ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: CAMPAIGN BRIEF (Extracted Campaign Facts)                      */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "brief" && (
          <div className="space-y-4 animate-in fade-in">
            {campaignId ? (
              isLoadingArtifact && !artifact ? (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                  <p className="text-xs font-medium text-zinc-500">
                    Loading extracted campaign facts...
                  </p>
                </div>
              ) : (
                <LiveArtifactPreview
                  artifact={artifact}
                  campaignId={campaignId}
                  onSelectQuestion={(qText) => {
                    onEditSuggestion(qText);
                  }}
                  onArtifactUpdate={(updated) => {
                    if (onArtifactUpdate) {
                      onArtifactUpdate(updated);
                    }
                  }}
                />
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white/50 dark:bg-zinc-950/50 p-6">
                <FileText className="w-10 h-10 stroke-1 opacity-30 text-zinc-500" />
                <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  No Campaign Selected
                </h4>
                <p className="text-[11px] text-zinc-500 max-w-xs">
                  Select a client thread from the inbox to review its live extracted facts and campaign brief.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: AI SUGGESTIONS (Copilot & Tone Suggestions)                   */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "suggestions" && (
          <div className="space-y-4 animate-in fade-in">
            {/* Quick header with thread toggle */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  AI Copilot
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggleThreadAi(!perThreadAiEnabled)}
                disabled={isTogglingThreadAi}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer ${
                  perThreadAiEnabled
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800"
                    : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800"
                }`}
              >
                {isTogglingThreadAi ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : perThreadAiEnabled ? (
                  <Bot className="w-3 h-3" />
                ) : (
                  <BotOff className="w-3 h-3" />
                )}
                AI {perThreadAiEnabled ? "ON" : "OFF"}
              </button>
            </div>

            {/* 10-Second Takeover Window Banner */}
            {hasPendingAiJob && aiWindowSecondsRemaining !== null && aiWindowSecondsRemaining > 0 && (
              <Card className="p-4 border-amber-300 bg-amber-50/90 dark:bg-amber-950/40 dark:border-amber-800 shadow-sm space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                    <Clock className="w-4 h-4 text-amber-600 animate-spin" />
                    Admin Takeover Window (10s)
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white font-mono text-xs font-bold">
                    {aiWindowSecondsRemaining}s
                  </span>
                </div>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                  AI will formulate an approved reply once the timer expires. Click Stop or send a manual reply to take full control.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onStopCountdown}
                  disabled={isProcessing}
                  className="w-full text-xs font-semibold h-8 bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  TAKE ADMIN CONTROL (STOP AI)
                </Button>
              </Card>
            )}

            {/* Auto-Reply Countdown Banner */}
            {isPendingReply && autoReplySecondsRemaining !== null && autoReplySecondsRemaining > 0 && (
              <Card className="p-4 border-amber-300 bg-amber-50/80 dark:bg-amber-950/40 dark:border-amber-800 shadow-sm space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                    <Clock className="w-4 h-4 text-amber-600 animate-spin" />
                    Auto-Reply Dispatching In
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white font-mono text-xs font-bold">
                    {autoReplySecondsRemaining}s
                  </span>
                </div>

                <div className="w-full h-1.5 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-600 transition-all duration-500 rounded-full"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, (autoReplySecondsRemaining / 10) * 100)
                      )}%`,
                    }}
                  />
                </div>

                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                  Tone: <strong className="capitalize">{activeJob?.tone}</strong>. Will automatically send if not stopped.
                </p>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onStopCountdown}
                  disabled={isProcessing}
                  className="w-full text-xs font-semibold h-8 bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  STOP AUTO-REPLY
                </Button>
              </Card>
            )}

            {/* Safety Gate Alert if blocked */}
            {activeClientMsg?.autoReplyStatus === "BLOCKED_SAFETY" && (
              <Card className="p-3.5 border-rose-300 bg-rose-50/70 dark:bg-rose-950/30 dark:border-rose-900 text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold text-rose-800 dark:text-rose-300">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  Safety Guard Triggered
                </div>
                <p className="text-[11px] text-rose-700 dark:text-rose-400 leading-relaxed">
                  Automatic dispatch was halted because this reply touches sensitive financial, refund, legal, or ambiguous commitments. Manual admin review is required.
                </p>
              </Card>
            )}

            {/* STATE: ANALYZING */}
            {copilotState === "ANALYZING" && (
              <Card className="p-6 border-purple-200 dark:border-purple-900/60 bg-purple-50/30 dark:bg-purple-950/20 flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in">
                <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center text-purple-600 dark:text-purple-300">
                  <Sparkles className="w-5 h-5 animate-spin" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Analyzing Client Message...
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                    Formulating fresh, context-aware suggestions
                  </p>
                </div>
                {activeClientMsg && (
                  <div className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-left text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">
                      Responding to:
                    </span>
                    <p className="line-clamp-2 italic text-zinc-800 dark:text-zinc-200">
                      "{activeClientMsg.content}"
                    </p>
                  </div>
                )}
              </Card>
            )}

            {/* STATE: GENERATION FAILED */}
            {copilotState === "GENERATION_FAILED" && (
              <Card className="p-5 border-rose-300 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-center space-y-3 animate-in fade-in">
                <div className="w-9 h-9 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-600 flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-rose-900 dark:text-rose-200">
                    AI Suggestion Generation Failed
                  </h4>
                  <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-1">
                    The AI service encountered a temporary error while formulating replies for the latest message.
                  </p>
                </div>

                {onRetryGeneration && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRetryGeneration}
                    disabled={isRetrying || isProcessing}
                    className="w-full text-xs font-medium bg-white dark:bg-zinc-900 border-rose-200 hover:bg-rose-50 text-rose-700 dark:text-rose-300 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRetrying ? "animate-spin" : ""}`} />
                    {isRetrying ? "Retrying..." : "Retry AI Generation"}
                  </Button>
                )}
              </Card>
            )}

            {/* STATE: SUGGESTIONS READY */}
            {copilotState === "SUGGESTIONS_READY" && suggestions && (
              <div className="space-y-3 animate-in fade-in">
                {/* Script Grounding Status Banner */}
                {aiAnalysis?.noRelevantScriptFound ? (
                  <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      No Matching Approved Script Found
                    </div>
                    <p className="text-[11px] text-amber-800 dark:text-amber-300">
                      The AI Copilot generated a safe holding reply. Direct Admin review is recommended before making business commitments.
                    </p>
                  </div>
                ) : aiAnalysis?.matchedScriptTitles && aiAnalysis.matchedScriptTitles.length > 0 ? (
                  <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 text-[11px] flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                      Grounded: {aiAnalysis.matchedScriptTitles[0]}
                    </span>
                    {aiAnalysis.scriptVersion && (
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-mono bg-emerald-100 dark:bg-emerald-900/60 px-1.5 py-0.2 rounded">
                        v{aiAnalysis.scriptVersion}
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Provider Transparency Banner */}
                <div className="flex items-center justify-between p-2 rounded-lg border text-xs bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800">
                  <span className="text-[11px] font-medium text-zinc-500">Provider:</span>
                  {aiAnalysis?.provider === "gemini" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                      <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                      Gemini Generated ({aiAnalysis?.providerModel || "gemini"})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      <ShieldCheck className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                      Senior Consultant Engine
                    </span>
                  )}
                </div>

                {/* Header with message reference and detected intent */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                      Fresh Suggestions (3)
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Senior Consultant Advisory
                    </span>
                  </div>

                  {aiAnalysis?.intentCategory && (
                    <div className="flex items-center gap-1.5 text-[10px] text-purple-700 dark:text-purple-300 font-semibold bg-purple-50/90 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/80 rounded px-2 py-0.5 w-fit">
                      <Sparkles className="w-3 h-3 text-purple-600" />
                      <span>Strategic Focus: {aiAnalysis.intentCategory}</span>
                    </div>
                  )}

                  {activeClientMsg && (
                    <div className="bg-zinc-100/80 dark:bg-zinc-800/60 rounded px-2.5 py-1 text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                      <MessageSquare className="w-3 h-3 text-purple-600 shrink-0" />
                      <span className="truncate">
                        Tailored for:{" "}
                        <strong className="text-zinc-900 dark:text-zinc-200">
                          "{activeClientMsg.content}"
                        </strong>
                      </span>
                    </div>
                  )}
                </div>

                {toneConfig.map((tone) => {
                  const text = suggestions[tone.id];
                  const Icon = tone.icon;
                  const isRecommended = aiAnalysis?.recommendedTone === tone.id;

                  return (
                    <Card
                      key={tone.id}
                      className={`p-3.5 border transition-all space-y-2.5 bg-white dark:bg-zinc-950 ${
                        isRecommended
                          ? "border-purple-300 dark:border-purple-800 shadow-xs"
                          : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className={`p-1 rounded-md ${tone.color}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                            {tone.label}
                          </span>
                        </div>

                        {isRecommended && (
                          <span className="px-1.5 py-0.5 rounded-sm bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 text-[10px] font-bold">
                            AI Recommended
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed line-clamp-4">
                        {text}
                      </p>

                      <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUseSuggestion(text)}
                          disabled={isProcessing}
                          className="flex-1 text-[11px] h-7 px-2 font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900 cursor-pointer"
                        >
                          <Send className="w-3 h-3 mr-1" />
                          Use Reply
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditSuggestion(text)}
                          className="text-[11px] h-7 px-2 text-zinc-600 dark:text-zinc-400 cursor-pointer"
                        >
                          Edit
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(text, tone.id)}
                          className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                          title="Copy to clipboard"
                        >
                          {copiedTone === tone.id ? (
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* STATE: AWAITING CLIENT RESPONSE (Admin manually replied) */}
            {copilotState === "AWAITING_CLIENT" && (
              <div className="space-y-3.5 animate-in fade-in">
                <Card className="p-4 border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
                      <CheckCircle className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        Admin Replied • Awaiting Client Response
                      </h4>
                      <p className="text-[11px] text-zinc-500">
                        You have answered the latest client message.
                      </p>
                    </div>
                  </div>

                  {lastAdminMessage && (
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-xs space-y-1">
                      <span className="text-[10px] uppercase font-bold text-zinc-400 block">
                        Your Last Sent Reply:
                      </span>
                      <p className="text-zinc-800 dark:text-zinc-200 italic line-clamp-3">
                        "{lastAdminMessage.content}"
                      </p>
                    </div>
                  )}

                  <div className="p-2 rounded-lg bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    <span>
                      When the client sends their next message, fresh suggestions will generate automatically.
                    </span>
                  </div>
                </Card>

                {/* Proactive Follow-Up Suggestions for Admin */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      Proactive Follow-Up Options (3)
                    </span>
                    <span className="text-[10px] text-zinc-400">Optional Nudge</span>
                  </div>

                  {toneConfig.map((tone) => {
                    const brand = artifact?.client?.company_name || "your brand";
                    const followUpSuggestions: Record<string, string> = {
                      professional: `Hello, just following up regarding ${brand}. Please let us know if you have any questions on our previous recommendation, and we will proceed with the next phase of your campaign setup.`,
                      friendly: `Hi there! Checking in to see how everything is going with ${brand}. Whenever you're ready, let us know and we'll jump right into the next step! 😊`,
                      detailed: `Hello, following up on our last discussion regarding your campaign strategy for ${brand}. To keep your campaign launch on schedule, please share your thoughts on the next milestone so our team can finalize your targeting and ad creatives.`,
                    };
                    const text = followUpSuggestions[tone.id] || followUpSuggestions.professional;
                    const Icon = tone.icon;

                    return (
                      <Card
                        key={tone.id}
                        className="p-3 border border-zinc-200 dark:border-zinc-800 transition-all space-y-2 bg-white dark:bg-zinc-950"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className={`p-1 rounded-md ${tone.color}`}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                              {tone.label} Follow-Up
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed line-clamp-3">
                          {text}
                        </p>

                        <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onUseSuggestion(text)}
                            disabled={isProcessing}
                            className="flex-1 text-[11px] h-7 px-2 font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900 cursor-pointer"
                          >
                            <Send className="w-3 h-3 mr-1" />
                            Use Follow-Up
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditSuggestion(text)}
                            className="text-[11px] h-7 px-2 text-zinc-600 dark:text-zinc-400 cursor-pointer"
                          >
                            Edit
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* STATE: IDLE */}
            {copilotState === "IDLE" && (
              <div className="p-8 text-center text-xs text-zinc-400 space-y-2">
                <Sparkles className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto" />
                <p>Select a thread or wait for client messages to view fresh AI suggestions.</p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 3: AI CONTROL (Takeover Policies, Countdown, Grace Period)       */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "control" && (
          <div className="space-y-4 animate-in fade-in">
            {/* Card 1: Automatic AI Takeover Policy */}
            <Card className="p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  Automatic AI Takeover Policy
                </h4>
              </div>

              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                If a customer message remains unanswered by a human operator during the waiting window, AI will automatically take over to ensure continuity.
              </p>

              <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Waiting Period Delay</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
                    {countdownSeconds} seconds (Takeover Window)
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Current Thread AI</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      perThreadAiEnabled
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                        : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                    }`}
                  >
                    {perThreadAiEnabled ? "AI Active" : "AI Inactive (Admin Controlled)"}
                  </span>
                </div>
              </div>

              <Button
                variant={perThreadAiEnabled ? "outline" : "default"}
                size="sm"
                onClick={() => onToggleThreadAi(!perThreadAiEnabled)}
                disabled={isTogglingThreadAi}
                className={`w-full text-xs font-semibold h-8 cursor-pointer ${
                  perThreadAiEnabled
                    ? "border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                {isTogglingThreadAi ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : perThreadAiEnabled ? (
                  <BotOff className="w-3.5 h-3.5 mr-1.5" />
                ) : (
                  <Bot className="w-3.5 h-3.5 mr-1.5" />
                )}
                {perThreadAiEnabled ? "Disable AI for This Thread" : "Resume AI Auto-Reply"}
              </Button>
            </Card>

            {/* Card 2: AI Away Mode / Grace Period Delay */}
            <Card className="p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 space-y-3">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  AI Away Mode Response Delay (Grace Period)
                </h4>
              </div>

              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                When in Away mode, AI waits for this delay period before auto-sending responses to the customer, allowing you to intervene if needed.
              </p>

              <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Auto-Send Delay Countdown</span>
                  {hasPendingAiJob && aiWindowSecondsRemaining !== null && aiWindowSecondsRemaining > 0 ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                      Active: {aiWindowSecondsRemaining}s remaining
                    </span>
                  ) : isPendingReply && autoReplySecondsRemaining !== null && autoReplySecondsRemaining > 0 ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                      Dispatching: {autoReplySecondsRemaining}s
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      Idle (Standby)
                    </span>
                  )}
                </div>
              </div>

              {(hasPendingAiJob || isPendingReply) && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onStopCountdown}
                  disabled={isProcessing}
                  className="w-full text-xs font-semibold h-8 bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current mr-1.5" />
                  Stop Pending AI Auto-Reply
                </Button>
              )}
            </Card>

            {/* Card 3: Global System Auto-Reply Master Status */}
            <Card className="p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Power
                    className={`w-4 h-4 ${
                      autoReplyGlobalEnabled ? "text-emerald-500" : "text-zinc-400"
                    }`}
                  />
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Master Auto-Reply Switch
                  </h4>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    autoReplyGlobalEnabled
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200"
                  }`}
                >
                  {autoReplyGlobalEnabled ? "ENABLED" : "DISABLED"}
                </span>
              </div>

              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Platform-wide control governing automatic responses across all campaigns and clients.
              </p>

              {onToggleGlobalAutoReply && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onToggleGlobalAutoReply}
                  className="w-full text-xs font-medium h-8 cursor-pointer"
                >
                  {autoReplyGlobalEnabled ? "Disable Master Auto-Reply" : "Enable Master Auto-Reply"}
                </Button>
              )}
            </Card>

            {/* Card 4: Script Grounding & Safety Guardrail Policy */}
            <Card className="p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 space-y-2.5">
              <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h4 className="text-xs font-bold">Safety & Grounding Guardrails</h4>
              </div>
              <ul className="text-[11px] text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc list-inside">
                <li>AI responses strictly adhere to approved agency scripts in MongoDB.</li>
                <li>Financial quotes and legal claims require explicit Admin review.</li>
                <li>Admin manual replies immediately deactivate AI auto-responses.</li>
              </ul>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

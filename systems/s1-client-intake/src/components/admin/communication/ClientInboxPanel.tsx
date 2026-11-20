"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, User, MessageSquare, Clock } from "lucide-react";

export interface ThreadItem {
  _id: string;
  clientName: string;
  clientEmail: string;
  businessName: string;
  lastMessageSnippet: string;
  lastMessageAt: string;
  lastSender: "client" | "admin" | "ai_auto";
  unreadAdminCount: number;
  threadGeneration: number;
  adminControlled?: boolean;
  aiAutoReplyAllowed?: boolean;
  perThreadAiEnabled?: boolean;
  aiJobScheduledStartAt?: string | null;
  hasPendingAiJob?: boolean;
  campaignId: { _id?: string; name?: string; status?: string };
}

interface ClientInboxPanelProps {
  threads: ThreadItem[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  isLoading: boolean;
}

export function ClientInboxPanel({
  threads,
  selectedThreadId,
  onSelectThread,
  isLoading,
}: ClientInboxPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredThreads = threads.filter((t) => {
    const q = searchQuery.toLowerCase();
    const nameMatch = (t.clientName || "").toLowerCase().includes(q);
    const bizMatch = (t.businessName || "").toLowerCase().includes(q);
    const campaignMatch = (t.campaignId?.name || "").toLowerCase().includes(q);
    return nameMatch || bizMatch || campaignMatch;
  });

  return (
    <div className="flex flex-col h-full border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      {/* Search Header */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-600" />
            Client Inquiries ({threads.length})
          </h3>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-zinc-400" />
          <Input
            placeholder="Search client or business..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
          />
        </div>
      </div>

      {/* Threads List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900">
        {isLoading && threads.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400">Loading client threads...</div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400">
            {searchQuery ? "No matching clients found." : "No client conversations yet."}
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isSelected = selectedThreadId === thread._id;
            const hasUnread = thread.unreadAdminCount > 0;

            return (
              <button
                key={thread._id}
                onClick={() => onSelectThread(thread._id)}
                className={`w-full text-left p-4 transition-colors flex flex-col gap-1.5 relative ${
                  isSelected
                    ? "bg-blue-50/70 dark:bg-blue-950/40 border-l-4 border-l-blue-600"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                      {thread.clientName || "Client"}
                    </span>
                  </div>

                  <span className="text-[10px] text-zinc-400 shrink-0 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(thread.lastMessageAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
                  {thread.businessName || thread.campaignId?.name || "Active Campaign"}
                </div>

                <p className="text-xs text-zinc-600 dark:text-zinc-300 line-clamp-1 pr-4">
                  {thread.lastMessageSnippet || "No message history"}
                </p>

                {/* Status Badges */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {thread.adminControlled ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                      Admin Controlled
                    </span>
                  ) : thread.unreadAdminCount > 0 ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                      Waiting for Admin
                    </span>
                  ) : thread.aiAutoReplyAllowed !== false ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                      AI Auto-Reply Enabled
                    </span>
                  ) : null}
                </div>

                {hasUnread && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shadow-xs">
                    {thread.unreadAdminCount}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

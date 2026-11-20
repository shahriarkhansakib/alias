"use client";

import React from "react";
import { Bot } from "lucide-react";

interface TypingIndicatorProps {
  isVisible: boolean;
  className?: string;
}

/**
 * Unified Dynamic Typing Indicator Component.
 *
 * Renders a consistent three-dot animated bubble for both Admin and AI typing.
 * Strictly avoids revealing whether the response is written by Admin or AI.
 * Contains no text labels ("Admin is typing...", "AI is thinking...").
 * Designed with fixed height and CSS transition to avoid any layout shifting.
 */
export function TypingIndicator({ isVisible, className = "" }: TypingIndicatorProps) {
  if (!isVisible) return null;

  return (
    <div
      aria-live="polite"
      aria-label="New message is being composed"
      className={`flex items-start gap-3 animate-in fade-in duration-200 ${className}`}
    >
      {/* Sender Avatar - consistent agency brand icon */}
      <div className="w-8 h-8 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 flex items-center justify-center shrink-0 shadow-xs">
        <Bot className="w-4 h-4" />
      </div>

      {/* Typing Bubble */}
      <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-xs flex items-center gap-1.5 h-[42px] select-none">
        <span
          className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce"
          style={{ animationDuration: "1000ms", animationDelay: "0ms" }}
        />
        <span
          className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce"
          style={{ animationDuration: "1000ms", animationDelay: "150ms" }}
        />
        <span
          className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce"
          style={{ animationDuration: "1000ms", animationDelay: "300ms" }}
        />
      </div>
    </div>
  );
}

export default TypingIndicator;

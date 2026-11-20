"use client";

import * as React from "react";
import { X } from "lucide-react";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div
        className="fixed inset-0"
        onClick={() => onOpenChange?.(false)}
      />
      {children}
    </div>
  );
}

export function DialogContent({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative z-50 w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-zinc-950 p-6 shadow-xl border border-zinc-200 dark:border-zinc-800 ${className}`}
    >
      {children}
    </div>
  );
}

export function DialogHeader({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`flex flex-col space-y-1.5 pb-4 border-b border-zinc-100 dark:border-zinc-800 ${className}`}>{children}</div>;
}

export function DialogTitle({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <h3 className={`text-base font-semibold leading-none text-zinc-900 dark:text-zinc-100 ${className}`}>{children}</h3>;
}

export function DialogDescription({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <p className={`text-xs text-zinc-500 dark:text-zinc-400 ${className}`}>{children}</p>;
}

'use client';

import React from 'react';
import { User, Sparkles, Cpu, CheckCircle } from 'lucide-react';

export type SourceType = 'CUSTOMER' | 'AI' | 'SYSTEM' | 'CUSTOMER_APPROVED';

interface SourceBadgeProps {
  source: SourceType;
  label?: string;
  className?: string;
}

export function SourceBadge({ source, label, className = '' }: SourceBadgeProps) {
  switch (source) {
    case 'CUSTOMER':
      return (
        <span
          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono tracking-tight ${className}`}
          title="Authoritative asset provided by the customer. Never hallucinated or altered."
        >
          <User className="h-2.5 w-2.5" />
          <span>{label || 'SOURCE: CUSTOMER'}</span>
        </span>
      );
    case 'CUSTOMER_APPROVED':
      return (
        <span
          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono tracking-tight ${className}`}
          title="Factual customer copy verified by the Claim Gate."
        >
          <CheckCircle className="h-2.5 w-2.5" />
          <span>{label || 'CUSTOMER / APPROVED'}</span>
        </span>
      );
    case 'AI':
      return (
        <span
          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono tracking-tight ${className}`}
          title="Synthesized by AI visual generation models."
        >
          <Sparkles className="h-2.5 w-2.5" />
          <span>{label || 'SOURCE: AI'}</span>
        </span>
      );
    case 'SYSTEM':
    default:
      return (
        <span
          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono tracking-tight ${className}`}
          title="Rendered deterministically by system rendering engines."
        >
          <Cpu className="h-2.5 w-2.5" />
          <span>{label || 'SOURCE: SYSTEM'}</span>
        </span>
      );
  }
}

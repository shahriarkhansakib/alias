'use client';

import React from 'react';
import { Lock, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { StageDependencyCheck, WorkflowStage } from '../../lib/types';

interface DependencyCardProps {
  stageName: string;
  stageNumber: number;
  dependencies: StageDependencyCheck[];
  onNavigateStage: (stage: WorkflowStage) => void;
}

export function DependencyCard({
  stageName,
  stageNumber,
  dependencies,
  onNavigateStage,
}: DependencyCardProps) {
  const firstUnsatisfied = dependencies.find((d) => !d.satisfied);

  return (
    <div className="max-w-xl mx-auto my-12 p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-2xl text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/10">
        <Lock className="h-6 w-6" />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-lg font-bold text-white tracking-tight">
          Step {stageNumber}: {stageName} is Locked
        </h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          This stage requires verified upstream pipeline assets before it can be generated or inspected.
        </p>
      </div>

      {/* Dependencies Checklist */}
      <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-left space-y-2.5">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Prerequisite Dependencies:
        </p>
        <div className="space-y-2">
          {dependencies.map((dep) => (
            <div key={dep.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                {dep.satisfied ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                )}
                <span className={dep.satisfied ? 'text-slate-300' : 'text-rose-300 font-medium'}>
                  {dep.name}
                </span>
              </div>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                  dep.satisfied
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                }`}
              >
                {dep.satisfied ? 'Satisfied' : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Action Button to Unblock */}
      {firstUnsatisfied && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => onNavigateStage(firstUnsatisfied.targetStage)}
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer"
          >
            <span>Complete {firstUnsatisfied.name}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

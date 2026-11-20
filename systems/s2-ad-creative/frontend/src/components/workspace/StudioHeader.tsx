'use client';

import React from 'react';
import {
  Check,
  Lock,
} from 'lucide-react';
import { WorkflowStage, StageStatusInfo, TargetPlatform, PlatformDefinition } from '../../lib/types';
import { SourceBadge } from '../common/SourceBadge';

interface StudioHeaderProps {
  activeStage: WorkflowStage;
  onSelectStage: (stage: WorkflowStage) => void;
  stages: Record<WorkflowStage, StageStatusInfo>;
  productAsset?: {
    url?: string;
    name?: string;
    status?: 'PASS' | 'WARNING' | 'FAIL';
  };
  onReplaceProductImage?: () => void;
  currentPlatform: TargetPlatform;
  onSelectPlatform: (platform: TargetPlatform) => void;
  availablePlatforms: PlatformDefinition[];
}

export function StudioHeader({
  activeStage,
  onSelectStage,
  stages,
  productAsset,
  onReplaceProductImage,
  currentPlatform,
  onSelectPlatform,
  availablePlatforms,
}: StudioHeaderProps) {
  const stageList: WorkflowStage[] = ['brief', 'strategy', 'background', 'product', 'composite', 'final_ad'];

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30 shrink-0">
      <div className="px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Left: Compact Workflow Stepper */}
        <div className="flex items-center space-x-1 sm:space-x-2">
          {stageList.map((stageKey, idx) => {
            const info = stages[stageKey];
            const isActive = activeStage === stageKey;
            const isComplete = info.isComplete;
            const isLocked = info.isLocked;

            return (
              <React.Fragment key={stageKey}>
                <button
                  type="button"
                  onClick={() => onSelectStage(stageKey)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30'
                      : isComplete
                      ? 'bg-slate-900/80 text-emerald-400 hover:bg-slate-800 border border-emerald-500/20'
                      : isLocked
                      ? 'bg-slate-900/40 text-slate-500 hover:text-slate-400 border border-slate-800/60'
                      : 'bg-slate-900/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-70">{idx + 1}.</span>
                  <span>{info.label}</span>
                  {isComplete ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : isLocked ? (
                    <Lock className="h-3 w-3 text-slate-600" />
                  ) : isActive ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  ) : null}
                </button>

                {idx < stageList.length - 1 && (
                  <span className="text-slate-600 text-[10px] select-none">→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Center / Right: Platform Switcher Tabs */}
        <div className="flex items-center space-x-3">
          {availablePlatforms.length > 0 && (
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              {availablePlatforms.map((p) => {
                const isSelected = currentPlatform === p.platform;
                return (
                  <button
                    key={p.platform}
                    type="button"
                    onClick={() => onSelectPlatform(p.platform)}
                    className={`px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>{p.name.split(' ')[0]}</span>
                    <span className="ml-1 text-[10px] opacity-70">({p.aspect_ratio})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Persistent Product Context Anchor */}
          {productAsset?.url && (
            <div className="flex items-center space-x-2 pl-3 border-l border-slate-800">
              <div className="relative w-7 h-7 rounded-md bg-slate-900 border border-slate-700/80 overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                <img
                  src={productAsset.url}
                  alt={productAsset.name || 'Product'}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="hidden lg:flex flex-col">
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs font-semibold text-slate-200 truncate max-w-[110px]">
                    {productAsset.name || 'Product'}
                  </span>
                  <SourceBadge source="CUSTOMER" label="CUSTOMER" />
                </div>
                {onReplaceProductImage && (
                  <button
                    type="button"
                    onClick={onReplaceProductImage}
                    className="text-[10px] text-indigo-400 hover:underline self-start cursor-pointer"
                  >
                    Replace Image
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

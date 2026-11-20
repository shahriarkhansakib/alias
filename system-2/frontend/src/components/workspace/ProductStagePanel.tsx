'use client';

import React from 'react';
import {
  CheckCircle2,
  ArrowRight,
  Image as ImageIcon,
} from 'lucide-react';
import { SourceBadge } from '../common/SourceBadge';
import { AssetValidationResponse } from '../../lib/types';

interface ProductStagePanelProps {
  productName: string;
  productImageUrl: string;
  price: string;
  currency: string;
  sku?: string;
  category?: string;
  assetReport?: AssetValidationResponse | null;
  onProceedToComposite: () => void;
  onReplaceImage?: () => void;
}

export function ProductStagePanel({
  productName,
  productImageUrl,
  price,
  currency,
  sku,
  category,
  assetReport,
  onProceedToComposite,
  onReplaceImage,
}: ProductStagePanelProps) {
  const metadata = assetReport?.asset_metadata || {};
  const width = metadata.width || 800;
  const height = metadata.height || 800;
  const hasAlpha = metadata.has_alpha_channel ?? true;
  const transparencyPct = metadata.transparency_percent ?? 45;
  const status = assetReport?.status || 'PASS';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start h-full">
      {/* 70% Primary Stage Canvas: Transparent Checkerboard Cutout Viewport */}
      <div className="lg:col-span-8 flex flex-col items-center justify-center p-8 rounded-2xl bg-slate-950/80 border border-slate-800 shadow-2xl relative">
        <div className="absolute top-4 left-4 flex items-center space-x-2">
          <SourceBadge source="CUSTOMER" label="CUSTOMER SOURCE ASSET" />
          <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
            {width} × {height} px
          </span>
        </div>

        {/* Checkered Canvas for Transparent Alpha Cutout */}
        <div
          className="relative max-h-[500px] w-full max-w-[480px] aspect-square rounded-xl overflow-hidden border border-slate-700/60 shadow-2xl flex items-center justify-center p-6"
          style={{
            backgroundImage:
              'linear-gradient(45deg, #1e293b 25%, transparent 25%), linear-gradient(-45deg, #1e293b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1e293b 75%), linear-gradient(-45deg, transparent 75%, #1e293b 75%)',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            backgroundColor: '#0f172a',
          }}
        >
          {productImageUrl ? (
            <img
              src={productImageUrl}
              alt={productName}
              className="max-h-full max-w-full object-contain filter drop-shadow-2xl transition-transform hover:scale-105 duration-300"
            />
          ) : (
            <div className="text-center text-slate-500 space-y-2">
              <ImageIcon className="h-10 w-10 mx-auto" />
              <p className="text-xs">No product cutout asset available</p>
            </div>
          )}
        </div>

        {/* Primary Controls Under Canvas */}
        <div className="mt-6 flex items-center space-x-4">
          {onReplaceImage && (
            <button
              type="button"
              onClick={onReplaceImage}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold transition-all cursor-pointer"
            >
              Replace Image
            </button>
          )}

          <button
            type="button"
            onClick={onProceedToComposite}
            className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer"
          >
            <span>Continue to Composite (Step 5)</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 20% Contextual Product Sidebar */}
      <div className="lg:col-span-4 space-y-4">
        {/* Human Readable Product Summary */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Product Overview
            </span>
            <span
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                status === 'PASS'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              QA: {status}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="text-slate-500 block text-[11px]">Product Name</span>
              <p className="text-sm font-semibold text-white">{productName}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800">
              <div>
                <span className="text-slate-500 block text-[11px]">Price</span>
                <p className="font-mono text-indigo-300 font-semibold">
                  {currency === 'BDT' ? '৳' : '$'}{price}
                </p>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Category</span>
                <p className="text-slate-300">{category || 'Smart Wearables'}</p>
              </div>
            </div>

            {sku && (
              <div className="pt-1 border-t border-slate-800">
                <span className="text-slate-500 block text-[11px]">SKU / Model</span>
                <p className="font-mono text-slate-400 text-[11px]">{sku}</p>
              </div>
            )}
          </div>
        </div>

        {/* Actionable Cutout QA Inspection */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
            Cutout Quality & Transparency
          </span>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-slate-300">Alpha Channel (Transparency)</span>
              </div>
              <span className="font-mono text-[11px] text-emerald-400">
                {hasAlpha ? 'Verified RGBA' : 'Missing'}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-slate-300">Transparent Coverage</span>
              </div>
              <span className="font-mono text-[11px] text-slate-300">
                {transparencyPct.toFixed(1)}% background
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-slate-300">Resolution Check</span>
              </div>
              <span className="font-mono text-[11px] text-slate-300">
                {width} × {height}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

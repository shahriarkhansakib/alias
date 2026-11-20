'use client';

import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  Eye,
  FileCheck,
  Layers,
} from 'lucide-react';
import { ValidationReport, AssetValidationResponse } from '../../lib/types';

interface ValidationFeedbackPanelProps {
  briefReport?: ValidationReport | null;
  assetReport?: AssetValidationResponse | null;
  validating?: boolean;
}

export const ValidationFeedbackPanel: React.FC<ValidationFeedbackPanelProps> = ({
  briefReport,
  assetReport,
  validating,
}) => {
  if (validating) {
    return (
      <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-8 text-center space-y-3">
        <div className="animate-spin h-7 w-7 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
        <h4 className="text-sm font-semibold text-slate-300">Evaluating Validation Gates...</h4>
        <p className="text-xs text-slate-500">Checking payload schema, type integrity, and asset properties.</p>
      </div>
    );
  }

  if (!briefReport && !assetReport) {
    return (
      <div className="rounded-xl bg-slate-900/40 border border-dashed border-slate-800 p-8 text-center space-y-2">
        <Layers className="h-6 w-6 text-slate-600 mx-auto" />
        <h4 className="text-sm font-medium text-slate-400">Awaiting Gate Verification</h4>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          Submit the brief or run the Asset Gate to inspect structured validation results.
        </p>
      </div>
    );
  }

  const renderStatusBadge = (status: 'PASS' | 'WARNING' | 'FAIL') => {
    switch (status) {
      case 'PASS':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>GATE PASSED</span>
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>WARNINGS DETECTED</span>
          </span>
        );
      case 'FAIL':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <XCircle className="h-3.5 w-3.5" />
            <span>GATE REJECTED</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. Payload Gate Report */}
      {briefReport && (
        <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <FileCheck className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">
                {briefReport.gate_name ? `${briefReport.gate_name} Evaluation` : 'Payload Gate Evaluation'}
              </h3>
            </div>
            {renderStatusBadge(briefReport.status)}
          </div>

          <p className="text-xs text-slate-300 font-medium">{briefReport.summary}</p>

          {/* Blocking Errors */}
          {briefReport.errors && briefReport.errors.length > 0 && (
            <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 space-y-2">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-rose-400">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>Blocking Validation Errors ({briefReport.errors.length})</span>
              </div>
              <ul className="space-y-1 pl-5 list-disc text-xs text-rose-300/90 font-mono">
                {briefReport.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Non-blocking Warnings */}
          {briefReport.warnings && briefReport.warnings.length > 0 && (
            <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-500/30 space-y-2">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Advisory Recommendations ({briefReport.warnings.length})</span>
              </div>
              <ul className="space-y-1 pl-5 list-disc text-xs text-amber-300/90">
                {briefReport.warnings.map((warn, idx) => (
                  <li key={idx}>{warn}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Granular Check Items */}
          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Granular Schema Checks
            </span>
            <div className="space-y-1.5">
              {briefReport.checks.map((chk, idx) => (
                <div
                  key={idx}
                  className="flex items-start justify-between p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/60 text-xs"
                >
                  <div className="flex items-start space-x-2">
                    {chk.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-medium text-slate-200 block">{chk.message}</span>
                      <span className="text-[10px] font-mono text-slate-500">{chk.code}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase shrink-0 ml-2 ${
                      chk.severity === 'ERROR'
                        ? 'bg-rose-500/20 text-rose-300'
                        : chk.severity === 'WARNING'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {chk.severity}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. Asset Gate Report */}
      {assetReport && (() => {
        const assetReportObj: ValidationReport | undefined =
          assetReport.report ||
          (assetReport && 'checks' in assetReport
            ? (assetReport as unknown as ValidationReport)
            : undefined);

        const assetStatus = assetReport.status || assetReportObj?.status || 'FAIL';
        const assetSummary =
          assetReportObj?.summary ||
          (assetReport as unknown as { detail?: string })?.detail ||
          'Asset Gate inspection completed.';
        const assetChecks = assetReportObj?.checks || [];
        const assetErrors = assetReportObj?.errors || [];
        const assetWarnings = assetReportObj?.warnings || [];

        return (
          <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Eye className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Asset Gate Inspection</h3>
              </div>
              {renderStatusBadge(assetStatus)}
            </div>

            {assetSummary && (
              <p className="text-xs text-slate-300 font-medium">{assetSummary}</p>
            )}

            {/* Blocking Errors */}
            {assetErrors.length > 0 && (
              <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 space-y-2">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-rose-400">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>Blocking Validation Errors ({assetErrors.length})</span>
                </div>
                <ul className="space-y-1 pl-5 list-disc text-xs text-rose-300/90 font-mono">
                  {assetErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Non-blocking Warnings */}
            {assetWarnings.length > 0 && (
              <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-500/30 space-y-2">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Advisory Recommendations ({assetWarnings.length})</span>
                </div>
                <ul className="space-y-1 pl-5 list-disc text-xs text-amber-300/90">
                  {assetWarnings.map((warn, idx) => (
                    <li key={idx}>{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Asset Metadata Grid */}
            {assetReport.asset_metadata && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Resolution</span>
                  <span className="text-xs font-semibold text-white">
                    {assetReport.asset_metadata.width && assetReport.asset_metadata.height
                      ? `${assetReport.asset_metadata.width} × ${assetReport.asset_metadata.height}px`
                      : 'N/A'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Cutout Alpha</span>
                  <span
                    className={`text-xs font-semibold ${
                      assetReport.asset_metadata.has_alpha_channel ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {assetReport.asset_metadata.has_alpha_channel
                      ? `${assetReport.asset_metadata.transparency_percent}% transparent`
                      : 'None (Opaque)'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">File Format</span>
                  <span className="text-xs font-semibold text-white font-mono">
                    {assetReport.asset_metadata.detected_mime || 'Unknown'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Aspect Ratio</span>
                  <span className="text-xs font-semibold text-white">
                    {assetReport.asset_metadata.aspect_ratio
                      ? `${assetReport.asset_metadata.aspect_ratio}:1`
                      : 'N/A'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">File Size</span>
                  <span className="text-xs font-semibold text-white font-mono">
                    {assetReport.asset_metadata.file_size_bytes
                      ? `${(assetReport.asset_metadata.file_size_bytes / 1024).toFixed(1)} KB`
                      : 'N/A'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Cutout Bounds</span>
                  <span className="text-xs font-semibold text-slate-300 font-mono text-[11px] truncate block">
                    {assetReport.asset_metadata.cutout_bbox
                      ? `[${assetReport.asset_metadata.cutout_bbox.join(', ')}]`
                      : 'Full canvas'}
                  </span>
                </div>
              </div>
            )}

            {/* Visual Asset Preview with Checkerboard Transparency Grid */}
            {assetReport.is_valid && assetReport.asset_metadata?.url && (
              <div className="space-y-1.5 pt-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Inspected Product Cutout Preview
                </span>
                <div
                  className="relative h-48 rounded-xl border border-slate-700/80 flex items-center justify-center overflow-hidden"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, #1e293b 25%, transparent 25%), linear-gradient(-45deg, #1e293b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1e293b 75%), linear-gradient(-45deg, transparent 75%, #1e293b 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                    backgroundColor: '#0f172a',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetReport.asset_metadata.url}
                    alt="Inspected product"
                    className="max-h-40 max-w-full object-contain filter drop-shadow-lg"
                  />
                </div>
              </div>
            )}

            {/* Asset Checks List */}
            {assetChecks.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {assetChecks.map((chk, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/60 text-xs"
                  >
                    <div className="flex items-start space-x-2">
                      {chk.passed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span className="font-medium text-slate-200 block">{chk.message}</span>
                        <span className="text-[10px] font-mono text-slate-500">{chk.code}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

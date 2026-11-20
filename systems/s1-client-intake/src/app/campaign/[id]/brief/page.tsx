"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Target,
  Users,
  Compass,
  DollarSign,
  Calendar,
  Share2,
  ExternalLink,
  Code,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  Loader2,
  Download,
  Copy,
  Check,
  RefreshCw,
  Layers,
  Terminal,
  Search,
} from "lucide-react";
import Link from "next/link";

function SimpleMarkdownRenderer({ content }: { content: string }) {
  if (!content) {
    return <p className="text-zinc-400 italic">No document content available.</p>;
  }

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];

  const flushTable = (key: string) => {
    if (tableHeader.length > 0 || tableRows.length > 0) {
      elements.push(
        <div key={key} className="my-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-xs border-collapse">
            {tableHeader.length > 0 && (
              <thead className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 border-b border-zinc-200 dark:border-zinc-700">
                <tr>
                  {tableHeader.map((h, i) => (
                    <th key={i} className="p-3 font-semibold">
                      {h.trim()}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-zinc-700 dark:text-zinc-300">
              {tableRows.map((row, ri) => (
                <tr key={ri} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  {row.map((cell, ci) => (
                    <td key={ci} className="p-3">
                      {cell.trim()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableHeader = [];
      tableRows = [];
      inTable = false;
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    // Code block toggle
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <div key={`code-${idx}`} className="my-3 p-4 rounded-xl bg-zinc-900 text-emerald-400 font-mono text-xs overflow-x-auto border border-zinc-800">
            <pre className="whitespace-pre-wrap">{codeBuffer.join("\n")}</pre>
          </div>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    // Table rows
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());

      // Skip markdown separator row like |---|---|
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        return;
      }

      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      return;
    } else if (inTable) {
      flushTable(`tbl-${idx}`);
    }

    // Headings
    if (trimmed.startsWith("# ")) {
      elements.push(
        <h1 key={idx} className="text-2xl md:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100 mt-6 mb-3 border-b border-zinc-200 dark:border-zinc-800 pb-2">
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith("## ")) {
      elements.push(
        <h2 key={idx} className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mt-5 mb-2.5">
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith("### ")) {
      elements.push(
        <h3 key={idx} className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mt-4 mb-2">
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith("> ")) {
      elements.push(
        <blockquote key={idx} className="my-2.5 pl-4 border-l-4 border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 py-2 pr-3 rounded-r-lg text-xs md:text-sm text-zinc-700 dark:text-zinc-300 italic">
          {trimmed.slice(2)}
        </blockquote>
      );
    } else if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("- [x] ")) {
      const isDone = trimmed.startsWith("- [x] ");
      elements.push(
        <div key={idx} className="flex items-center gap-2 text-xs md:text-sm my-1 text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={isDone} readOnly className="rounded text-blue-600 focus:ring-0" />
          <span>{trimmed.slice(6)}</span>
        </div>
      );
    } else if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      elements.push(
        <li key={idx} className="ml-4 list-disc text-xs md:text-sm text-zinc-700 dark:text-zinc-300 my-1 leading-relaxed">
          {trimmed.slice(2)}
        </li>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      const dotIndex = trimmed.indexOf(".");
      elements.push(
        <div key={idx} className="flex items-start gap-2 text-xs md:text-sm text-zinc-700 dark:text-zinc-300 my-1.5 leading-relaxed">
          <span className="font-semibold text-blue-600 dark:text-blue-400 shrink-0">{trimmed.slice(0, dotIndex + 1)}</span>
          <span>{trimmed.slice(dotIndex + 1).trim()}</span>
        </div>
      );
    } else if (trimmed.length > 0) {
      elements.push(
        <p key={idx} className="text-xs md:text-sm text-zinc-700 dark:text-zinc-300 my-2 leading-relaxed">
          {trimmed}
        </p>
      );
    }
  });

  if (inTable) {
    flushTable("final-tbl");
  }

  return <div className="space-y-1">{elements}</div>;
}

export default function MasterBriefPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;

  const [activeTab, setActiveTab] = useState<"brief" | "script" | "audit">("brief");
  const [documents, setDocuments] = useState<{
    masterBriefMarkdown: string;
    executionScriptMarkdown: string;
  } | null>(null);
  const [legacyBrief, setLegacyBrief] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = async () => {
    setIsLoading(true);
    try {
      // 1. Try fetching Markdown documents
      const docsRes = await fetch(`/api/campaigns/${campaignId}/documents`);
      if (docsRes.ok) {
        const docsData = await docsRes.json();
        if (docsData.masterBriefMarkdown || docsData.executionScriptMarkdown) {
          setDocuments({
            masterBriefMarkdown: docsData.masterBriefMarkdown,
            executionScriptMarkdown: docsData.executionScriptMarkdown,
          });
        }
      }

      // 2. Also fetch structured legacy brief if available
      const briefRes = await fetch(`/api/master-brief/${campaignId}`);
      if (briefRes.ok) {
        const briefData = await briefRes.json();
        if (briefData.brief) setLegacyBrief(briefData.brief);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [campaignId]);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/documents`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to regenerate campaign documents");
      }
      const data = await res.json();
      setDocuments({
        masterBriefMarkdown: data.masterBriefMarkdown,
        executionScriptMarkdown: data.executionScriptMarkdown,
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to regenerate documents");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCopyMarkdown = () => {
    const textToCopy =
      activeTab === "brief"
        ? documents?.masterBriefMarkdown || ""
        : activeTab === "script"
        ? documents?.executionScriptMarkdown || ""
        : JSON.stringify(legacyBrief, null, 2);

    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    const isBrief = activeTab === "brief";
    const filename = isBrief ? "MASTER_CAMPAIGN_BRIEF.md" : "CAMPAIGN_EXECUTION_SCRIPT.md";
    const content = isBrief ? documents?.masterBriefMarkdown : documents?.executionScriptMarkdown;
    if (!content) return;

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm text-zinc-500">Loading campaign documents...</p>
        </div>
      </div>
    );
  }

  const activeMarkdown =
    activeTab === "brief"
      ? documents?.masterBriefMarkdown
      : documents?.executionScriptMarkdown;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        {/* Top Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <div className="flex flex-col gap-1">
            <Link
              href={`/campaign/${campaignId}`}
              className="inline-flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors w-fit mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Return to Campaign Chat
            </Link>
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                Phase 1 Deliverables
              </span>
              <span className="text-xs text-zinc-400">•</span>
              <span className="text-xs text-zinc-500 font-mono">v1.0</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
              Autonomous Campaign Deliverables
            </h1>
            <p className="text-xs md:text-sm text-zinc-500">
              Grounded exclusively in confirmed conversation facts and client-approved recommendations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/campaign/${campaignId}/messages`}>
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-blue-600 border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center gap-1.5"
              >
                💬 Agency Support
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={isRegenerating}
              className="text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRegenerating ? "animate-spin" : ""}`} />
              {isRegenerating ? "Regenerating..." : "Regenerate"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyMarkdown}
              className="text-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
              {copied ? "Copied!" : "Copy Markdown"}
            </Button>
            {activeTab !== "audit" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadMarkdown}
                className="text-xs"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" /> Download .md
              </Button>
            )}
            <Link href={`/campaign/${campaignId}/research`}>
              <Button variant="outline" size="sm" className="text-xs text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40">
                <Search className="w-3.5 h-3.5 mr-1.5" /> Research Evidence
              </Button>
            </Link>
            <Link href="/admin">
              <Button variant="outline" size="sm" className="text-xs">
                Admin Panel
              </Button>
            </Link>
          </div>
        </header>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2">
          <button
            onClick={() => setActiveTab("brief")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all cursor-pointer ${
              activeTab === "brief"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <FileText className="w-4 h-4" /> MASTER_CAMPAIGN_BRIEF.md
          </button>

          <button
            onClick={() => setActiveTab("script")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all cursor-pointer ${
              activeTab === "script"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <Terminal className="w-4 h-4" /> CAMPAIGN_EXECUTION_SCRIPT.md
          </button>

          {legacyBrief && (
            <button
              onClick={() => setActiveTab("audit")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all cursor-pointer ${
                activeTab === "audit"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <Code className="w-4 h-4" /> Raw JSON Audit
            </button>
          )}
        </div>

        {/* Tab Content Display */}
        {activeTab === "audit" && legacyBrief ? (
          <Card className="p-6 bg-zinc-900 text-zinc-100 font-mono text-xs overflow-x-auto rounded-2xl">
            <pre className="whitespace-pre-wrap">{JSON.stringify(legacyBrief, null, 2)}</pre>
          </Card>
        ) : (
          <Card className="p-6 md:p-8 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
            {activeMarkdown ? (
              <SimpleMarkdownRenderer content={activeMarkdown} />
            ) : (
              <div className="flex flex-col items-center justify-center p-12 text-center gap-3">
                <FileText className="w-10 h-10 text-zinc-400 stroke-1" />
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Documents have not been generated yet for this campaign.
                </p>
                <Button size="sm" onClick={handleRegenerate} disabled={isRegenerating}>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Generate Documents Now
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

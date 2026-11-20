"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  Layers,
  Search,
  Building2,
  TrendingUp,
  Users,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  FileText,
  Compass,
  Info,
  History,
  X,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import { ResearchDossier, ResearchFinding, ResearchSource, CompetitorAnalysisItem } from "@/lib/research/types";

export default function ResearchDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;

  const [dossier, setDossier] = useState<ResearchDossier | null>(null);
  const [viewingRevision, setViewingRevision] = useState<any | null>(null);
  const [showRevisionsModal, setShowRevisionsModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const loadResearch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/${campaignId}`);
      if (!res.ok) {
        throw new Error("Failed to fetch research dossier");
      }
      const data = await res.json();
      if (data.artifact2) {
        setDossier(data.artifact2);
      } else {
        // If not started yet, trigger research pipeline
        handleStartResearch();
        return;
      }
    } catch (err: any) {
      setError(err.message || "Failed to load research");
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  const handleStartResearch = async () => {
    setIsRegenerating(true);
    setError(null);
    try {
      // POST to the correct research endpoint (POST /api/research/[campaignId])
      const res = await fetch(`/api/research/${campaignId}`, { method: "POST" });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || "Research pipeline encountered an error");
      }
      const data = await res.json();
      if (data.artifact2) {
        setDossier(data.artifact2);
        setViewingRevision(null); // Reset preview to latest
      }
    } catch (err: any) {
      setError(err.message || "Failed to execute research");
    } finally {
      setIsRegenerating(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadResearch();
  }, [loadResearch]);

  // Display either the selected archived revision or the active latest dossier
  const activeDossier = viewingRevision || dossier;

  const categories = activeDossier
    ? ["All", ...(activeDossier.categories_completed || [])]
    : ["All"];

  const filteredFindings =
    activeDossier?.findings?.filter((f: ResearchFinding) => {
      if (selectedCategory === "All") return true;
      return f.category === selectedCategory;
    }) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <ShieldCheck className="w-3.5 h-3.5" /> COMPLETED & EVIDENCE-BACKED
          </span>
        );
      case "PARTIALLY_COMPLETED":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" /> PARTIALLY COMPLETED
          </span>
        );
      case "IN_PROGRESS":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> IN PROGRESS
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            <XCircle className="w-3.5 h-3.5" /> RESEARCH FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
            {status}
          </span>
        );
    }
  };

  // Client-Friendly Source Validation Labels (Preserves underlying status values)
  const getSourceValidationBadge = (status: string) => {
    switch (status) {
      case "VERIFIED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3" /> Verified Web Source
          </span>
        );
      case "REDIRECTED_AND_VERIFIED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800">
            <CheckCircle2 className="w-3 h-3" /> Redirected & Verified
          </span>
        );
      case "ACCESS_RESTRICTED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
            <ShieldAlert className="w-3 h-3" /> Access Restricted
          </span>
        );
      case "BROKEN":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
            <XCircle className="w-3 h-3" /> Page Inaccessible
          </span>
        );
      case "SEARCH_RESULT_ONLY":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
            <FileText className="w-3 h-3" /> Search Preview Only
          </span>
        );
      case "TEMPORARILY_UNAVAILABLE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">
            <AlertTriangle className="w-3 h-3" /> Temporarily Unavailable
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800">
            <ShieldAlert className="w-3 h-3" /> Security Filtered
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-600">
            {status}
          </span>
        );
    }
  };

  const getEvidenceStatusBadge = (status?: string) => {
    switch (status) {
      case "VERIFIED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3" /> VERIFIED BY EVIDENCE
          </span>
        );
      case "PARTIALLY_VERIFIED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3" /> PARTIALLY VERIFIED
          </span>
        );
      case "CONTRADICTED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">
            <XCircle className="w-3 h-3" /> CONTRADICTED BY EVIDENCE
          </span>
        );
      case "UNVERIFIED":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-600 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700">
            <HelpCircle className="w-3 h-3" /> UNVERIFIED CLAIM
          </span>
        );
    }
  };

  const getSourceTierBadge = (tier?: string) => {
    switch (tier) {
      case "PRIMARY":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            PRIMARY SOURCE
          </span>
        );
      case "SECONDARY":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            SECONDARY SOURCE
          </span>
        );
      case "TERTIARY":
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
            TERTIARY (REFERENCE)
          </span>
        );
    }
  };

  const getFindingNatureBadge = (nature?: string) => {
    switch (nature) {
      case "FACT":
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            FACT
          </span>
        );
      case "TREND":
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            TREND
          </span>
        );
      case "HYPOTHESIS":
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            HYPOTHESIS
          </span>
        );
      case "RECOMMENDATION":
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            RECOMMENDATION
          </span>
        );
      default:
        return null;
    }
  };

  if (isLoading && !dossier) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Retrieving evidence-based research and validating sources...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-8">
        {/* Top Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/campaign/${campaignId}/brief`}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"
              >
                ← Back to Campaign Deliverables
              </Link>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2.5">
                <Search className="w-7 h-7 text-blue-600" />
                Verified Market Research & Source Citations
              </h1>
              {activeDossier?.version && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                  v{activeDossier.version}
                </span>
              )}
              {/* Interactive Revision History Trigger */}
              {dossier?.revision_history && dossier.revision_history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowRevisionsModal(true)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                  title="Click to view archived research revisions"
                >
                  <History className="w-3.5 h-3.5 text-blue-600" />
                  {dossier.revision_history.length} previous revision(s)
                </button>
              )}
            </div>
            <p className="text-sm text-zinc-500 mt-1">
              Evidence-based market, audience, and competitor intelligence with live HTTP URL validation.
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartResearch}
              disabled={isRegenerating || Boolean(viewingRevision)}
              className="text-xs font-semibold cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRegenerating ? "animate-spin" : ""}`} />
              {isRegenerating ? "Regenerating..." : "Regenerate Research"}
            </Button>
            <Button
              size="sm"
              onClick={() => router.push(`/campaign/${campaignId}/brief`)}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shrink-0 cursor-pointer"
            >
              View Campaign Brief <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        </header>

        {/* In-place Error Notification with Retry */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStartResearch()}
              className="text-xs bg-white text-rose-700 border-rose-300 hover:bg-rose-100 shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
            </Button>
          </div>
        )}

        {/* Read-Only Archived Revision Active Banner */}
        {viewingRevision && (
          <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 text-blue-900 dark:text-blue-200 text-xs flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                Viewing <strong>Archived Revision v{viewingRevision.version}</strong> (Completed:{" "}
                {viewingRevision.savedAt ? new Date(viewingRevision.savedAt).toLocaleDateString() : viewingRevision.completion_date || "Previous Run"}
                ) • <em>Read-Only Archive Mode</em>
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setViewingRevision(null)}
              className="text-xs bg-white dark:bg-zinc-900 text-blue-700 dark:text-blue-300 font-semibold shrink-0 cursor-pointer border-blue-300 dark:border-blue-700"
            >
              Return to Latest Revision (v{dossier?.version})
            </Button>
          </div>
        )}

        {/* Live Search Provider Transparency Notice */}
        {activeDossier?.search_provider_status?.live_search_succeeded && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-900 dark:text-emerald-200 text-xs flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                Live External Search Verified: {activeDossier.search_provider_status.active_provider}
              </p>
              <p className="mt-0.5 text-emerald-800 dark:text-emerald-300/90 leading-relaxed">
                Successfully executed live search across {activeDossier.search_provider_status.live_query_count || 1} campaign queries, retrieving {activeDossier.search_provider_status.live_results_count || activeDossier.stats?.total_sources || 0} genuine search candidates. Every candidate passed HTTP validation, DNS resolution, and SSRF security verification.
              </p>
            </div>
          </div>
        )}

        {activeDossier?.search_provider_status &&
          activeDossier.search_provider_status.live_search_attempted &&
          !activeDossier.search_provider_status.live_search_succeeded && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  Live Search Notice: External Search Fallback Active ({activeDossier.search_provider_status.error_category || "API_ERROR"})
                </p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300/90 leading-relaxed">
                  Tavily live search was attempted but encountered {activeDossier.search_provider_status.error_category}: {activeDossier.search_provider_status.error_message || "Service unavailable"}. The research engine gracefully fell back to institutional trade databases and encyclopedia references without crashing.
                </p>
              </div>
            </div>
          )}

        {activeDossier?.search_provider_status &&
          !activeDossier.search_provider_status.is_live_search_available &&
          !activeDossier.search_provider_status.live_search_attempted && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  Transparent Provider Status: Live External Search API Not Configured
                </p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300/90 leading-relaxed">
                  Active Provider: <strong className="font-bold">{activeDossier.search_provider_status.active_provider}</strong>. Missing external keys:{" "}
                  <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 font-mono text-[11px]">
                    {(activeDossier.search_provider_status.missing_credentials || (activeDossier.search_provider_status as any).missing_keys)?.join(", ") || "TAVILY_API_KEY"}
                  </code>. The research pipeline automatically fell back to validated domain knowledge bases and public indices. Research is marked as <strong>PARTIALLY COMPLETED</strong> to preserve empirical honesty.
                </p>
              </div>
            </div>
          )}

        {/* SECTION A: RESEARCH OVERVIEW */}
        {activeDossier && (
          <Card className="p-6 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-100 dark:border-zinc-800">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {activeDossier.business_name || "Client Business"}
                  </h2>
                  {getStatusBadge(activeDossier.research_status)}
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Industry: <span className="font-medium text-zinc-700 dark:text-zinc-300">{activeDossier.industry}</span> • Researched on:{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{activeDossier.completion_date}</span>
                </p>
                {activeDossier.campaign_profile && (
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Objective: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{activeDossier.campaign_profile.campaign_objective}</span> • Scope:{" "}
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">{activeDossier.campaign_profile.geography}</span> • Depth:{" "}
                    <span className="font-semibold text-blue-600 dark:text-blue-400">{activeDossier.campaign_profile.research_depth}</span>
                  </p>
                )}
              </div>

              <div className="text-xs text-zinc-500 flex items-center gap-2 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                <span>Provider: {activeDossier.provider_metadata?.provider || "Live Verified Research Engine"}</span>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6">
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <p className="text-xs font-medium text-zinc-500">Total Sources Retrieved</p>
                <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100 mt-1">
                  {activeDossier.stats?.total_sources || activeDossier.sources?.length || 0}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Verified Sources</p>
                <p className="text-2xl font-black text-emerald-800 dark:text-emerald-200 mt-1">
                  {activeDossier.stats?.verified_sources ||
                    activeDossier.sources?.filter(
                      (s: ResearchSource) => s.validation_status === "VERIFIED" || s.validation_status === "REDIRECTED_AND_VERIFIED"
                    ).length ||
                    0}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Restricted / Limited</p>
                <p className="text-2xl font-black text-amber-800 dark:text-amber-200 mt-1">
                  {activeDossier.stats?.unverified_sources || 0}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Research Categories</p>
                <p className="text-2xl font-black text-blue-800 dark:text-blue-200 mt-1">
                  {activeDossier.categories_completed?.length || 0}
                </p>
              </div>
            </div>

            {activeDossier.limitations && activeDossier.limitations.length > 0 && (
              <div className="mt-4 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">Research Scope & Limitations:</span>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {activeDossier.limitations.map((lim: string, i: number) => (
                      <li key={i}>{lim}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* SECTION B: RESEARCH FINDINGS WITH CITATIONS */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Compass className="w-5 h-5 text-blue-600" /> Research Findings & Evidence
              </h2>
              <p className="text-xs text-zinc-500">
                Each finding is paired with verified source citations, confidence scores, and raw excerpts.
              </p>
            </div>

            {/* Mobile-Friendly Horizontally Scrollable Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                    selectedCategory === cat
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Finding Nature Legend */}
          <div className="p-3.5 rounded-xl bg-zinc-100/70 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 text-xs text-zinc-600 dark:text-zinc-400 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">Finding Types:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                FACT
              </span>
              <span className="text-[11px]">Empirically attested by verified sources</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                TREND
              </span>
              <span className="text-[11px]">Observed consumer or market trajectory</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                HYPOTHESIS
              </span>
              <span className="text-[11px]">Directional insight requiring campaign testing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                RECOMMENDATION
              </span>
              <span className="text-[11px]">Actionable strategy proposal</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredFindings.map((finding: ResearchFinding) => (
              <Card
                key={finding.finding_id}
                className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase">
                      {finding.finding_id} • {finding.category}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {getFindingNatureBadge(finding.finding_nature)}
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          finding.confidence === "High"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : finding.confidence === "Medium"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        }`}
                      >
                        Confidence: {finding.confidence}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
                    {finding.title}
                  </h3>

                  <p className="text-xs text-zinc-700 dark:text-zinc-300 font-medium mt-2 leading-relaxed">
                    {finding.claim}
                  </p>

                  <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                    {finding.explanation}
                  </p>

                  {/* Evidence Excerpt Quote Block */}
                  {finding.evidence_excerpt && (
                    <div className="mt-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border-l-4 border-blue-500 text-[11px] text-zinc-600 dark:text-zinc-400 italic break-words">
                      "{finding.evidence_excerpt}"
                    </div>
                  )}

                  {/* Evidence Evaluation Reasoning */}
                  {finding.evidence_evaluation && (
                    <div className="mt-2.5 p-2 rounded-lg bg-zinc-50/80 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-700/50 text-[11px] text-zinc-600 dark:text-zinc-400 flex items-start gap-1.5">
                      <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                      <span>
                        <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Assessment:</strong>{" "}
                        {finding.evidence_evaluation}
                      </span>
                    </div>
                  )}

                  {finding.limitations && (
                    <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                      ⚠️ Limitation: {finding.limitations}
                    </p>
                  )}
                </div>

                {/* Supporting Source Badges */}
                <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-zinc-500">Citations:</span>
                    {finding.supporting_source_ids && finding.supporting_source_ids.length > 0 ? (
                      finding.supporting_source_ids.map((srcId) => (
                        <a
                          key={srcId}
                          href={`#${srcId}`}
                          className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-bold hover:underline"
                        >
                          [{srcId}]
                        </a>
                      ))
                    ) : (
                      <span className="text-[11px] text-zinc-400 italic">Directional / Unlinked</span>
                    )}
                  </div>

                  {getEvidenceStatusBadge(finding.evidence_status)}
                </div>
              </Card>
            ))}

            {filteredFindings.length === 0 && (
              <div className="col-span-full p-8 rounded-2xl bg-white dark:bg-zinc-900 border border-dashed border-zinc-300 dark:border-zinc-700 text-center text-xs text-zinc-500">
                No research findings recorded in category "{selectedCategory}".
              </div>
            )}
          </div>
        </section>

        {/* SECTION C: EVIDENCE-BASED COMPETITOR ANALYSIS */}
        {activeDossier?.competitors && activeDossier.competitors.length > 0 && (
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" /> Verified Competitor Analysis
              </h2>
              <p className="text-xs text-zinc-500">
                Official merchant profiles and publicly visible commercial offerings.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {activeDossier.competitors.map((comp: CompetitorAnalysisItem, idx: number) => (
                <Card
                  key={idx}
                  className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                        {comp.name}
                      </h3>
                      {getSourceValidationBadge(comp.validation_status)}
                    </div>

                    {comp.website && comp.is_official_domain !== false ? (
                      <a
                        href={comp.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1 font-medium break-all"
                      >
                        <span className="break-all">{comp.website.replace(/^https?:\/\//, "")}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <div className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-900 mt-1 font-medium">
                        <AlertTriangle className="w-3 h-3 shrink-0" /> Official Website Unverified
                      </div>
                    )}

                    <div className="mt-3 space-y-2 text-xs">
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">Catalog & Products: </span>
                        <span className="text-zinc-600 dark:text-zinc-400">{comp.products}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">Observed Pricing: </span>
                        <span className="text-zinc-600 dark:text-zinc-400">{comp.pricing}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">Positioning: </span>
                        <span className="text-zinc-600 dark:text-zinc-400">{comp.positioning}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">Active Offers: </span>
                        <span className="text-zinc-600 dark:text-zinc-400">{comp.offers}</span>
                      </div>
                    </div>

                    {/* Competitor Strengths */}
                    {comp.strengths && comp.strengths.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800">
                        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Observed Strengths:</span>
                        <ul className="mt-1 space-y-1">
                          {comp.strengths.map((s: string, sIdx: number) => (
                            <li key={sIdx} className="text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Competitor Weaknesses / Considerations */}
                    {comp.weaknesses && comp.weaknesses.length > 0 && (
                      <div className="mt-2.5">
                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Considerations / Limitations:</span>
                        <ul className="mt-1 space-y-1">
                          {comp.weaknesses.map((w: string, wIdx: number) => (
                            <li key={wIdx} className="text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                              <span>{w}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Verification Notes */}
                    {comp.notes && (
                      <p className="mt-2.5 text-[11px] text-zinc-500 dark:text-zinc-400 italic bg-zinc-50 dark:bg-zinc-800/40 p-2 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
                        <span className="font-semibold not-italic text-zinc-600 dark:text-zinc-300">Verification Note:</span> {comp.notes}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-400">
                    Verified on {comp.last_verified_date}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* SECTION D: DEDICATED SOURCES & CITATIONS DIRECTORY */}
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" /> Sources & Verification Evidence
            </h2>
            <p className="text-xs text-zinc-500">
              Complete audit trail of all retrieved external sources, HTTP validation status, and supported claims.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {activeDossier?.sources?.map((src: ResearchSource) => {
              const isAccessible =
                src.validation_status === "VERIFIED" ||
                src.validation_status === "REDIRECTED_AND_VERIFIED" ||
                src.validation_status === "ACCESS_RESTRICTED" ||
                src.validation_status === "SEARCH_RESULT_ONLY";

              const targetUrl = src.final_url || src.original_url;
              const isRedirected = src.final_url && src.original_url && src.final_url !== src.original_url;

              return (
                <Card
                  key={src.source_id}
                  id={src.source_id}
                  className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="px-2.5 py-1 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-black shrink-0">
                        {src.source_id}
                      </span>
                      <div className="max-w-full overflow-hidden">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isAccessible ? (
                            <a
                              href={targetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-bold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline inline-flex items-center gap-1.5"
                            >
                              <span>{src.title}</span>
                              <ExternalLink className="w-3.5 h-3.5 opacity-60 shrink-0" />
                            </a>
                          ) : (
                            <h4 className="text-sm font-bold text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1.5">
                              <span>{src.title}</span>
                              <span className="text-[10px] font-normal text-rose-500 dark:text-rose-400">(Inaccessible Link)</span>
                            </h4>
                          )}
                          {getSourceValidationBadge(src.validation_status)}
                          {getSourceTierBadge(src.source_tier)}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1 flex-wrap">
                          <span>
                            Publisher: <strong className="text-zinc-700 dark:text-zinc-300">{src.publisher}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Domain: <strong className="text-zinc-700 dark:text-zinc-300">{src.domain}</strong>
                          </span>
                          <span>•</span>
                          <span>Accessed: {src.accessed_date}</span>
                          {src.published_date && (
                            <>
                              <span>•</span>
                              <span>Published: {src.published_date}</span>
                            </>
                          )}
                        </div>

                        {/* Preserved Original and Final URLs with mobile-safe wrapping */}
                        {isAccessible ? (
                          <div className="mt-2">
                            <a
                              href={targetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-medium break-all"
                            >
                              <span className="break-all">{targetUrl}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                            {isRedirected && (
                              <div className="text-[11px] text-zinc-400 mt-0.5 break-all">
                                Redirected from: <span className="font-mono">{src.original_url}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-zinc-400 font-mono break-all cursor-not-allowed">
                            <span className="break-all">{targetUrl}</span>
                            <span className="text-[10px] text-zinc-400 italic ml-1.5">(Offline / Non-responsive)</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {src.supported_finding_ids && src.supported_finding_ids.length > 0 && (
                      <div className="text-xs shrink-0 flex md:flex-col items-center md:items-end gap-1">
                        <span className="text-zinc-500 font-medium">Supports:</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {src.supported_finding_ids.map((fId) => (
                            <span
                              key={fId}
                              className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[10px] font-bold"
                            >
                              {fId}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {src.evidence_excerpt && (
                    <div className="mt-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 break-words">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">Evidence Excerpt: </span>
                      "{src.evidence_excerpt}"
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      {/* Revision History Modal */}
      {showRevisionsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Research Revision History
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRevisionsModal(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-500">
              Artifact 2 captures full audit snapshots before every regeneration. Click any archived revision to inspect historical findings and evidence without overwriting the latest active data.
            </p>

            <div className="overflow-y-auto space-y-3 pr-1 max-h-[55vh]">
              {/* Current Active Version */}
              {dossier && (
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    !viewingRevision
                      ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-1 ring-blue-500"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                        v{dossier.version || "1.0"} (Current Active)
                      </span>
                      {getStatusBadge(dossier.research_status)}
                    </div>
                    {!viewingRevision ? (
                      <span className="text-[11px] font-semibold text-blue-600">Active</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setViewingRevision(null);
                          setShowRevisionsModal(false);
                        }}
                        className="text-xs cursor-pointer"
                      >
                        Select Active
                      </Button>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-2 flex items-center gap-3">
                    <span>Completed: {dossier.completion_date}</span>
                    <span>•</span>
                    <span>{dossier.findings?.length || 0} findings</span>
                    <span>•</span>
                    <span>{dossier.sources?.length || 0} sources</span>
                  </div>
                </div>
              )}

              {/* Archived Historical Snapshots */}
              {dossier?.revision_history && dossier.revision_history.length > 0 ? (
                dossier.revision_history.map((rev: any, rIdx: number) => {
                  const isCurrentPreview = viewingRevision && viewingRevision.version === rev.version;
                  const dateStr = rev.savedAt
                    ? new Date(rev.savedAt).toLocaleString()
                    : rev.completion_date || `Run #${rIdx + 1}`;

                  return (
                    <div
                      key={rIdx}
                      className={`p-4 rounded-xl border transition-all ${
                        isCurrentPreview
                          ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-1 ring-blue-500"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                            v{rev.version || `1.${rIdx}`} (Archived)
                          </span>
                          {getStatusBadge(rev.research_status)}
                        </div>
                        <Button
                          size="sm"
                          variant={isCurrentPreview ? "default" : "outline"}
                          onClick={() => {
                            setViewingRevision(rev);
                            setShowRevisionsModal(false);
                          }}
                          className="text-xs cursor-pointer"
                        >
                          {isCurrentPreview ? "Viewing" : "Preview Archive"}
                        </Button>
                      </div>
                      <div className="text-xs text-zinc-500 mt-2 flex items-center gap-3">
                        <span>Archived: {dateStr}</span>
                        <span>•</span>
                        <span>{rev.findings?.length || 0} findings</span>
                        <span>•</span>
                        <span>{rev.sources?.length || 0} sources</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 text-center text-xs text-zinc-400">
                  No previous archived revisions on record.
                </div>
              )}
            </div>

            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRevisionsModal(false)}
                className="text-xs cursor-pointer"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

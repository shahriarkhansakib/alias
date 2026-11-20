"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Building2,
  Package,
  Target,
  Users,
  Wallet,
  Calendar,
  CheckCircle2,
  Edit3,
  Sparkles,
  ArrowLeft,
  Loader2,
  Lock,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

export default function ConfirmationPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const [artifact, setArtifact] = useState<any>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/artifacts/1/${campaignId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load Artifact 1");
        return res.json();
      })
      .then((data) => {
        if (data.artifact) setArtifact(data.artifact);
      })
      .catch((err) => setError(err.message));
  }, [campaignId]);

  // Verify 6 Core Requirements
  const missingCore: string[] = [];
  if (!artifact?.client?.company_name) missingCore.push("Company / Brand Name");
  if (!artifact?.product_service?.name) missingCore.push("Product / Service Name");
  if (!artifact?.campaign?.objective) missingCore.push("Campaign Objective");
  if (!artifact?.target_audience?.description && !artifact?.target_audience?.location && !artifact?.target_audience?.age_range) {
    missingCore.push("Target Audience");
  }
  const hasBudget = Boolean(artifact?.budget?.amount) || artifact?.budget?.type === "unknown";
  if (!hasBudget) missingCore.push("Marketing Budget");
  if (!artifact?.timeline?.duration) missingCore.push("Timeline Duration");

  const isComplete = missingCore.length === 0;

  const handleConfirm = async () => {
    if (!isComplete) {
      setError(`Cannot confirm yet. Please fill all important requirements first: ${missingCore.join(", ")}.`);
      return;
    }
    setIsConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/1/${campaignId}/confirm`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to confirm Artifact-1");
      }
      const data = await res.json();
      router.push(data.redirectTo || `/campaign/${campaignId}/brief`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to confirm artifact.");
      setIsConfirming(false);
    }
  };

  if (!artifact) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm text-zinc-500">Loading campaign facts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 md:p-12 flex justify-center">
      <div className="max-w-4xl w-full flex flex-col gap-8">
        {/* Navigation & Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between mb-2">
            <Link
              href={`/campaign/${campaignId}`}
              className="inline-flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors w-fit"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to conversation
            </Link>
            <Link
              href={`/campaign/${campaignId}/messages`}
              className="inline-flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline transition-colors"
            >
              💬 Message Agency Admin
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
              Stage 3: Verification
            </span>
            <span className="text-xs text-zinc-400">•</span>
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Lock className="w-3 h-3 text-zinc-400" /> Client-Stated Facts Only
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
            Here's what I understood about your campaign.
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
            Please review the facts captured during our discussion. Once confirmed, this document
            (Artifact-1) will trigger the autonomous Research & Enrichment AI Agent.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-50 text-rose-700 text-sm border border-rose-200">
            {error}
          </div>
        )}

        {!isComplete && (
          <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-200">
                  Essential Requirements Missing ({missingCore.length} items needed)
                </h3>
                <p className="text-xs text-amber-850 dark:text-amber-300/80 mt-1 leading-relaxed">
                  To formulate and run an effective marketing campaign for your company, all core details must be provided first. Missing:{" "}
                  <span className="font-semibold text-amber-950 dark:text-amber-100">{missingCore.join(", ")}</span>.
                </p>
              </div>
            </div>
            <Button
              onClick={() => router.push(`/campaign/${campaignId}`)}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs h-9 px-4 shrink-0 shadow-xs cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Return to Chat
            </Button>
          </div>
        )}

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 1. Client / Business */}
          <Card className="p-5 flex flex-col gap-3 shadow-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-2.5 text-zinc-900 dark:text-zinc-100 font-semibold border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <Building2 className="w-4 h-4 text-blue-600" />
              <span>Business Profile</span>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Company Name:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.client?.company_name || "Not provided"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Industry:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.client?.industry || "Not provided"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Website:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-xs">
                  {artifact.client?.website || "Not provided"}
                </span>
              </div>
            </div>
          </Card>

          {/* 2. Product / Service */}
          <Card className="p-5 flex flex-col gap-3 shadow-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-2.5 text-zinc-900 dark:text-zinc-100 font-semibold border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <Package className="w-4 h-4 text-emerald-600" />
              <span>Product & Offering</span>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Product Name:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.product_service?.name || "Not provided"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Category:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.product_service?.type || "Not provided"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Retail Price:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.product_service?.price
                    ? `BDT ${artifact.product_service.price.toLocaleString()}`
                    : "Not provided"}
                </span>
              </div>
            </div>
          </Card>

          {/* 3. Campaign Goals */}
          <Card className="p-5 flex flex-col gap-3 shadow-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-2.5 text-zinc-900 dark:text-zinc-100 font-semibold border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <Target className="w-4 h-4 text-purple-600" />
              <span>Campaign Objectives</span>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Primary Objective:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.campaign?.objective || "Not provided"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 mt-1">
                <span className="text-zinc-500 text-xs">Desired Result:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.campaign?.desired_result || "Increase sales and brand presence"}
                </span>
              </div>
            </div>
          </Card>

          {/* 4. Target Audience */}
          <Card className="p-5 flex flex-col gap-3 shadow-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-2.5 text-zinc-900 dark:text-zinc-100 font-semibold border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <Users className="w-4 h-4 text-amber-600" />
              <span>Client-Stated Audience</span>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Age Range:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.target_audience?.age_range || "Not specified by client"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Location:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.target_audience?.location || "Not specified by client"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 mt-1">
                <span className="text-zinc-500 text-xs">Audience Description:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.target_audience?.description || "General market"}
                </span>
              </div>
            </div>
          </Card>

          {/* 5. Budget */}
          <Card className="p-5 flex flex-col gap-3 shadow-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-2.5 text-zinc-900 dark:text-zinc-100 font-semibold border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <Wallet className="w-4 h-4 text-teal-600" />
              <span>Budget Allocation</span>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Budget Amount:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.budget?.type === "unknown"
                    ? "Unknown (Client requested recommendation)"
                    : artifact.budget?.amount
                    ? `${artifact.budget.amount.toLocaleString()} ${artifact.budget.currency || "BDT"}`
                    : "Not specified"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Type:</span>
                <span className="font-medium capitalize text-zinc-900 dark:text-zinc-100">
                  {artifact.budget?.type || "unknown"}
                </span>
              </div>
            </div>
          </Card>

          {/* 6. Timeline */}
          <Card className="p-5 flex flex-col gap-3 shadow-xs border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-2.5 text-zinc-900 dark:text-zinc-100 font-semibold border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <Calendar className="w-4 h-4 text-indigo-600" />
              <span>Execution Timeline</span>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Target Duration:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {artifact.timeline?.duration || "1 Month (Standard)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Launch Readiness:</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">Immediate</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-6 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm mt-4">
          <Button
            variant="outline"
            size="lg"
            onClick={() => router.push(`/campaign/${campaignId}`)}
            className="w-full sm:w-auto h-12 px-6"
          >
            <Edit3 className="w-4 h-4 mr-2" /> Return to Conversation
          </Button>

          <Button
            size="lg"
            onClick={handleConfirm}
            disabled={!isComplete || isConfirming}
            className={`w-full sm:w-auto h-12 px-8 font-semibold shadow-md ${
              isComplete
                ? "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 cursor-pointer"
                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed border border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {isConfirming ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Master Brief & Execution Script...
              </>
            ) : !isComplete ? (
              <>
                <Lock className="w-4 h-4 mr-2" /> Incomplete Requirements ({missingCore.length} Missing)
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Confirm & Generate Campaign Documents{" "}
                <Sparkles className="w-4 h-4 ml-1.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

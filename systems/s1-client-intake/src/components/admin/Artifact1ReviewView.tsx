"use client";

import React, { useState } from "react";
import {
  Building2,
  Package,
  Target,
  Users,
  Wallet,
  Calendar,
  Sparkles,
  Compass,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Edit2,
  Check,
  X,
  Lock,
  ArrowLeft,
  Loader2,
  MessageSquare,
  FileCheck,
  RefreshCw,
  Clock,
  Send,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import { ConsultantQuestionGenerator } from "@/lib/ai/consultant-questions";

interface ProvenanceData {
  value: any;
  source?: "client_stated" | "admin_provided" | "ai_inferred";
  confidence?: number;
  verification_status?: "unverified" | "confirmed" | "needs_clarification";
}

interface Artifact1ReviewViewProps {
  artifact: any;
  campaignId: string;
  isAdmin?: boolean;
  onArtifactUpdate?: (updated: any) => void;
  onReturnToConversation?: () => void;
}

export default function Artifact1ReviewView({
  artifact,
  campaignId,
  isAdmin = true,
  onArtifactUpdate,
  onReturnToConversation,
}: Artifact1ReviewViewProps) {
  const [editingField, setEditingField] = useState<{ section: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Clarification Modal State
  const [clarificationModal, setClarificationModal] = useState<{
    section: string;
    key: string;
    label: string;
    suggestedQuestion: string;
  } | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState("");
  const [isSendingClarification, setIsSendingClarification] = useState(false);

  if (!artifact) {
    return (
      <div className="p-8 text-center text-zinc-400">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
        Loading Campaign Brief Artifact...
      </div>
    );
  }

  const sections = artifact.sections || {};
  const version = artifact.version || 1;
  const status = String(artifact.status || "DRAFT").toUpperCase();
  const isConfirmed = status === "CONFIRMED";

  // Helper to extract value and provenance safely
  const getField = (sectionKey: string, fieldKey: string, fallbackLegacyValue?: any): ProvenanceData => {
    const sec = sections[sectionKey] || {};
    const fieldObj = sec[fieldKey];

    if (fieldObj && typeof fieldObj === "object" && "value" in fieldObj) {
      return {
        value: fieldObj.value ?? fallbackLegacyValue ?? null,
        source: fieldObj.source || "client_stated",
        confidence: fieldObj.confidence ?? 1.0,
        verification_status: fieldObj.verification_status || "unverified",
      };
    }

    return {
      value: fallbackLegacyValue ?? null,
      source: "client_stated",
      confidence: 1.0,
      verification_status: "unverified",
    };
  };

  const renderBadge = (field: ProvenanceData) => {
    if (field.verification_status === "needs_clarification") {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
          Needs Clarification
        </span>
      );
    }
    if (field.source === "admin_provided") {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
          Admin Edited
        </span>
      );
    }
    if (field.source === "ai_inferred") {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
          AI Inferred
        </span>
      );
    }
    if (field.value !== null && field.value !== undefined && field.value !== "") {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
          Client Provided
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        Missing
      </span>
    );
  };

  const renderDisplayValue = (val: any) => {
    if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) {
      return <span className="text-zinc-400 italic">Not provided</span>;
    }
    if (Array.isArray(val)) {
      return val.join(", ");
    }
    if (typeof val === "boolean") {
      return val ? "Yes" : "No";
    }
    return String(val);
  };

  const handleStartEdit = (section: string, key: string, currentVal: any) => {
    setEditingField({ section, key });
    if (Array.isArray(currentVal)) {
      setEditValue(currentVal.join(", "));
    } else {
      setEditValue(currentVal !== null && currentVal !== undefined ? String(currentVal) : "");
    }
    setActionError(null);
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleSaveField = async () => {
    if (!editingField) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const { section, key } = editingField;
      let parsedVal: any = editValue.trim();
      if (parsedVal.includes(",") && (key.includes("features") || key.includes("benefits") || key.includes("platforms") || key.includes("competitors") || key.includes("kpis") || key.includes("voice") || key.includes("points") || key.includes("needs"))) {
        parsedVal = parsedVal.split(",").map((s: string) => s.trim()).filter(Boolean);
      } else if (!isNaN(Number(parsedVal)) && (key === "pricing" || key === "total_budget")) {
        parsedVal = Number(parsedVal);
      }

      const updates = {
        sections: {
          [section]: {
            [key]: {
              value: parsedVal,
              source: "admin_provided",
              confidence: 1.0,
              verification_status: "confirmed",
            },
          },
        },
      };

      const res = await fetch(`/api/artifacts/1/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates,
          source: "admin_provided",
          reason: `Admin edited ${section}.${key}`,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to update field");
      }

      const resData = await res.json();
      if (resData.artifact && onArtifactUpdate) {
        onArtifactUpdate(resData.artifact);
      }
      setEditingField(null);
      setActionSuccess(`Updated ${key} successfully.`);
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err: any) {
      setActionError(err.message || "Failed to save field change");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenClarification = (section: string, key: string, label: string) => {
    const question = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: key,
      fieldLabel: label,
      artifact,
    });
    setClarificationModal({
      section,
      key,
      label,
      suggestedQuestion: question,
    });
    setClarificationQuestion(question);
  };

  const handleSendClarification = async () => {
    if (!clarificationModal) return;
    setIsSendingClarification(true);
    try {
      const res = await fetch(`/api/artifacts/1/${campaignId}/request-clarification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: clarificationModal.section,
          fieldKey: clarificationModal.key,
          question: clarificationQuestion,
          requestedBy: "admin",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to request clarification");
      }

      const data = await res.json();
      if (data.artifact && onArtifactUpdate) {
        onArtifactUpdate(data.artifact);
      }
      setClarificationModal(null);
      setActionSuccess(`Clarification question sent to client for ${clarificationModal.label}.`);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to request clarification");
    } finally {
      setIsSendingClarification(false);
    }
  };

  const handleConfirmArtifact = async () => {
    setIsConfirming(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/artifacts/1/${campaignId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedBy: "admin" }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to confirm Artifact-1");
      }

      const resData = await res.json();
      if (resData.artifact && onArtifactUpdate) {
        onArtifactUpdate(resData.artifact);
      }
      setActionSuccess("Artifact-1 Confirmed! Immutable brief snapshot locked for downstream Research & Creative AI pipelines.");
    } catch (err: any) {
      setActionError(err.message || "Failed to confirm artifact");
    } finally {
      setIsConfirming(false);
    }
  };

  // Render a single field row inside a card
  const renderRow = (section: string, key: string, label: string, field: ProvenanceData) => {
    const isEditing = editingField?.section === section && editingField?.key === key;

    return (
      <div key={key} className="py-2.5 border-b border-zinc-100 dark:border-zinc-800/80 last:border-b-0 flex flex-col gap-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 font-medium">{label}:</span>
            {renderBadge(field)}
          </div>
          {isAdmin && !isConfirmed && (
            <div className="flex items-center gap-1">
              {!isEditing && (
                <>
                  <button
                    onClick={() => handleStartEdit(section, key, field.value)}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    title={`Edit ${label}`}
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleOpenClarification(section, key, label)}
                    className="p-1 rounded text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    title={`Request clarification on ${label}`}
                  >
                    <HelpCircle className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 px-2.5 py-1 text-xs rounded border border-blue-400 dark:border-blue-600 bg-white dark:bg-zinc-800 focus:outline-hidden"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveField();
                if (e.key === "Escape") handleCancelEdit();
              }}
            />
            <Button
              size="sm"
              onClick={handleSaveField}
              disabled={isSaving}
              className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelEdit}
              className="h-7 px-2 text-xs"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <div className="text-zinc-900 dark:text-zinc-100 font-medium break-words leading-relaxed">
            {renderDisplayValue(field.value)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
      {/* Header and Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Here&apos;s what I understood about your campaign.
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono">
              v{version}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase ${
                status === "CONFIRMED"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : status === "READY_FOR_REVIEW"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                  : status === "NEEDS_CLARIFICATION"
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-xs text-zinc-500 max-w-2xl">
            Please review the facts captured during our discussion. Once confirmed, this document (Artifact-1)
            will trigger the autonomous Research & Enrichment AI Agent.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onReturnToConversation ? (
            <Button variant="outline" size="sm" onClick={onReturnToConversation} className="text-xs">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Return to Conversation
            </Button>
          ) : (
            <Link href={`/campaign/${campaignId}`}>
              <Button variant="outline" size="sm" className="text-xs">
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Return to Conversation
              </Button>
            </Link>
          )}

          {isAdmin && !isConfirmed && (
            <Button
              size="sm"
              onClick={handleConfirmArtifact}
              disabled={isConfirming}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs shadow-xs"
            >
              {isConfirming ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Confirming...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Confirm & Generate Campaign Documents
                </>
              )}
            </Button>
          )}

          {isConfirmed && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <Lock className="w-3.5 h-3.5" /> Confirmed & Locked for Next Pipeline
            </div>
          )}
        </div>
      </div>

      {actionError && (
        <div className="p-4 rounded-xl bg-rose-50 text-rose-700 text-xs border border-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 text-emerald-700 text-xs border border-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {actionSuccess}
        </div>
      )}

      {/* 2-Column Responsive Card Grid (8 Sections) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Business Profile */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Business Profile</h3>
          </div>
          <div>
            {renderRow("business_profile", "company_name", "Company Name", getField("business_profile", "company_name", artifact.client?.company_name))}
            {renderRow("business_profile", "industry", "Industry", getField("business_profile", "industry", artifact.client?.industry))}
            {renderRow("business_profile", "website", "Website", getField("business_profile", "website", artifact.client?.website))}
            {renderRow("business_profile", "business_description", "Business Description", getField("business_profile", "business_description", artifact.client?.business_description))}
            {renderRow("business_profile", "business_location", "Business Location", getField("business_profile", "business_location", artifact.client?.location || artifact.client?.business_location))}
          </div>
        </Card>

        {/* Card 2: Product & Offering */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Product & Offering</h3>
          </div>
          <div>
            {renderRow("product_offering", "name", "Product Name", getField("product_offering", "name", artifact.product_service?.name))}
            {renderRow("product_offering", "category", "Category", getField("product_offering", "category", artifact.product_service?.type || artifact.product_service?.category))}
            {renderRow("product_offering", "pricing", "Retail Price", getField("product_offering", "pricing", artifact.product_service?.price ? `BDT ${artifact.product_service.price}` : artifact.product_service?.price_range))}
            {renderRow("product_offering", "description", "Description", getField("product_offering", "description", artifact.product_service?.description))}
            {renderRow("product_offering", "usp", "Unique Selling Proposition", getField("product_offering", "usp", artifact.client?.usp || artifact.product_service?.usp))}
            {renderRow("product_offering", "key_features", "Key Features", getField("product_offering", "key_features"))}
            {renderRow("product_offering", "main_benefits", "Main Benefits", getField("product_offering", "main_benefits", artifact.product_service?.offer ? [artifact.product_service.offer] : []))}
          </div>
        </Card>

        {/* Card 3: Campaign Objectives */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-purple-50 dark:bg-purple-950 text-purple-600 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Campaign Objectives</h3>
          </div>
          <div>
            {renderRow("campaign_objectives", "primary_objective", "Primary Objective", getField("campaign_objectives", "primary_objective", artifact.campaign?.objective))}
            {renderRow("campaign_objectives", "desired_results", "Desired Result", getField("campaign_objectives", "desired_results", artifact.campaign?.desired_result))}
            {renderRow("campaign_objectives", "secondary_objectives", "Secondary Objectives", getField("campaign_objectives", "secondary_objectives"))}
            {renderRow("campaign_objectives", "kpis", "Key Performance Indicators", getField("campaign_objectives", "kpis"))}
          </div>
        </Card>

        {/* Card 4: Client-Stated Audience */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-orange-50 dark:bg-orange-950 text-orange-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Client-Stated Audience</h3>
          </div>
          <div>
            {renderRow("target_audience", "age_range", "Age Range", getField("target_audience", "age_range", artifact.target_audience?.age_range))}
            {renderRow("target_audience", "gender", "Gender", getField("target_audience", "gender", artifact.target_audience?.gender))}
            {renderRow("target_audience", "location", "Location", getField("target_audience", "location", artifact.target_audience?.location))}
            {renderRow("target_audience", "description", "Audience Description", getField("target_audience", "description", artifact.target_audience?.description))}
            {renderRow("target_audience", "demographics", "Demographics", getField("target_audience", "demographics", artifact.target_audience?.demographics))}
            {renderRow("target_audience", "pain_points", "Customer Pain Points", getField("target_audience", "pain_points", artifact.target_audience?.pain_points ? [artifact.target_audience.pain_points] : []))}
          </div>
        </Card>

        {/* Card 5: Budget Allocation */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-950 text-teal-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Budget Allocation</h3>
          </div>
          <div>
            {renderRow("budget_allocation", "total_budget", "Budget Amount", getField("budget_allocation", "total_budget", artifact.budget?.amount ? `${artifact.budget.amount.toLocaleString()} ${artifact.budget.currency || "BDT"}` : null))}
            {renderRow("budget_allocation", "currency", "Currency", getField("budget_allocation", "currency", artifact.budget?.currency || "BDT"))}
            {renderRow("budget_allocation", "budget_type", "Type", getField("budget_allocation", "budget_type", artifact.budget?.type || "Range"))}
            {renderRow("budget_allocation", "budget_flexibility", "Flexibility", getField("budget_allocation", "budget_flexibility"))}
          </div>
        </Card>

        {/* Card 6: Execution Timeline */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Execution Timeline</h3>
          </div>
          <div>
            {renderRow("execution_timeline", "duration", "Target Duration", getField("execution_timeline", "duration", artifact.timeline?.duration))}
            {renderRow("execution_timeline", "launch_readiness", "Launch Readiness", getField("execution_timeline", "launch_readiness", artifact.assets?.readiness || "Immediate"))}
            {renderRow("execution_timeline", "expected_launch_date", "Expected Launch Date", getField("execution_timeline", "expected_launch_date", artifact.timeline?.start_date))}
            {renderRow("execution_timeline", "deadlines", "Important Deadlines", getField("execution_timeline", "deadlines"))}
          </div>
        </Card>

        {/* Card 7: Brand Identity */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-pink-50 dark:bg-pink-950 text-pink-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Brand Identity</h3>
          </div>
          <div>
            {renderRow("brand_identity", "brand_voice", "Brand Voice / Tone", getField("brand_identity", "brand_voice", artifact.brand_preferences?.tone))}
            {renderRow("brand_identity", "brand_personality", "Brand Personality", getField("brand_identity", "brand_personality", artifact.client?.brand_personality))}
            {renderRow("brand_identity", "brand_positioning", "Brand Positioning", getField("brand_identity", "brand_positioning", artifact.brand_preferences?.visual_preference))}
            {renderRow("brand_identity", "brand_guidelines", "Brand Guidelines", getField("brand_identity", "brand_guidelines"))}
          </div>
        </Card>

        {/* Card 8: Marketing Preferences */}
        <Card className="p-5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-7 h-7 rounded-lg bg-cyan-50 dark:bg-cyan-950 text-cyan-600 flex items-center justify-center">
              <Compass className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Marketing Preferences</h3>
          </div>
          <div>
            {renderRow("marketing_preferences", "preferred_platforms", "Preferred Platforms", getField("marketing_preferences", "preferred_platforms", artifact.campaign?.channels?.paid))}
            {renderRow("marketing_preferences", "competitors", "Competitor Names", getField("marketing_preferences", "competitors", artifact.client?.competitor_references))}
            {renderRow("marketing_preferences", "content_types", "Content Types", getField("marketing_preferences", "content_types"))}
            {renderRow("marketing_preferences", "previous_experience", "Previous Experience", getField("marketing_preferences", "previous_experience"))}
            {renderRow("marketing_preferences", "other_preferences", "Other Client Preferences", getField("marketing_preferences", "other_preferences"))}
          </div>
        </Card>
      </div>

      {/* Clarification Modal Dialog */}
      {clarificationModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full p-6 border border-zinc-200 dark:border-zinc-800 shadow-xl flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-rose-600" />
                <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                  Request Clarification: {clarificationModal.label}
                </h3>
              </div>
              <button
                onClick={() => setClarificationModal(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-500">
              The following consultative question will be dispatched to the client chat to clarify this requirement:
            </p>

            <textarea
              rows={4}
              value={clarificationQuestion}
              onChange={(e) => setClarificationQuestion(e.target.value)}
              className="w-full text-xs p-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 focus:outline-hidden focus:ring-1 focus:ring-blue-500 leading-relaxed"
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setClarificationModal(null)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSendClarification}
                disabled={isSendingClarification || !clarificationQuestion.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
              >
                {isSendingClarification ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 mr-1.5" /> Send Question to Client
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

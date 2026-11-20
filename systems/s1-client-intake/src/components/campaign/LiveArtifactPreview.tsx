"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  HelpCircle,
  ArrowRight,
  Clock,
  Sparkles,
  Pencil,
  Check,
  X,
  AlertCircle,
  MessageSquarePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { ConsultantQuestionGenerator } from "@/lib/ai/consultant-questions";

interface PreviewItem {
  key: string;
  label: string;
  value: any;
  isUnknown?: boolean;
}

interface PreviewSection {
  title: string;
  data: PreviewItem[];
}

export default function LiveArtifactPreview({
  artifact,
  campaignId,
  onSelectQuestion,
  onArtifactUpdate,
}: {
  artifact: any;
  campaignId: string;
  onSelectQuestion?: (questionText: string, fieldLabel: string) => void;
  onArtifactUpdate?: (updatedArtifact: any) => void;
}) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [generatedToast, setGeneratedToast] = useState<string | null>(null);

  if (!artifact) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-zinc-400 gap-3 text-center">
        <Circle className="w-10 h-10 stroke-1 opacity-20" />
        <p className="text-sm">Listening to conversation...</p>
        <p className="text-xs text-zinc-500 max-w-xs">
          Facts provided in the chat will be structured and displayed here in real time.
        </p>
      </div>
    );
  }

  const sections: PreviewSection[] = [
    {
      title: "Business Information",
      data: [
        { key: "company_name", label: "Company", value: artifact.client?.company_name },
        { key: "industry", label: "Industry", value: artifact.client?.industry },
        { key: "website", label: "Website", value: artifact.client?.website },
      ],
    },
    {
      title: "Product / Service",
      data: [
        { key: "product_name", label: "Product Name", value: artifact.product_service?.name },
        { key: "type", label: "Type", value: artifact.product_service?.type },
        {
          key: "price",
          label: "Price",
          value: artifact.product_service?.price ? `BDT ${artifact.product_service.price}` : null,
        },
      ],
    },
    {
      title: "Campaign Strategy",
      data: [
        { key: "objective", label: "Objective", value: artifact.campaign?.objective },
        { key: "desired_result", label: "Desired Result", value: artifact.campaign?.desired_result },
      ],
    },
    {
      title: "Target Audience (Stated)",
      data: [
        { key: "age_range", label: "Age Range", value: artifact.target_audience?.age_range },
        { key: "location", label: "Location", value: artifact.target_audience?.location },
        { key: "target_audience", label: "Audience Notes", value: artifact.target_audience?.description },
      ],
    },
    {
      title: "Budget",
      data: [
        {
          key: "budget",
          label: "Budget Status",
          value:
            artifact.budget?.type === "unknown"
              ? "Marked as Unknown (will be researched)"
              : artifact.budget?.amount
              ? `${artifact.budget.amount.toLocaleString()} ${artifact.budget.currency || "BDT"} (${artifact.budget.type || "exact"})`
              : null,
          isUnknown: artifact.budget?.type === "unknown",
        },
      ],
    },
    {
      title: "Timeline",
      data: [{ key: "duration", label: "Duration", value: artifact.timeline?.duration }],
    },
    {
      title: "Brand Identity & Creative",
      data: [
        { key: "brand_personality", label: "Personality", value: artifact.client?.brand_personality },
        {
          key: "colors",
          label: "Colors",
          value: Array.isArray(artifact.brand_preferences?.colors) && artifact.brand_preferences.colors.length > 0
            ? artifact.brand_preferences.colors.join(", ")
            : null,
        },
        { key: "visual_preference", label: "Visual Style", value: artifact.brand_preferences?.visual_preference },
      ],
    },
    {
      title: "Campaign Offers & Discounts",
      data: [
        { key: "primary_offer", label: "Primary Offer", value: artifact.offers?.primary_offer },
        { key: "secondary_offer", label: "Secondary Offer", value: artifact.offers?.secondary_offer },
      ],
    },
    {
      title: "Operations & Logistics",
      data: [
        { key: "delivery_partner", label: "Courier Partner", value: artifact.operations?.delivery_partner },
        { key: "response_time", label: "Response Time", value: artifact.operations?.response_time },
      ],
    },
  ];

  // Count collected fields
  let totalFields = 0;
  let collectedFields = 0;
  sections.forEach((sec) => {
    sec.data.forEach((item) => {
      totalFields++;
      if (item.value) collectedFields++;
    });
  });

  const completionPct = totalFields > 0 ? Math.round((collectedFields / totalFields) * 100) : 0;

  // Verify 6 Core Requirements
  const missingCoreRequirements: string[] = [];
  if (!artifact?.client?.company_name) missingCoreRequirements.push("Company Name");
  if (!artifact?.product_service?.name) missingCoreRequirements.push("Product / Service");
  if (!artifact?.campaign?.objective) missingCoreRequirements.push("Campaign Objective");
  if (!artifact?.target_audience?.description && !artifact?.target_audience?.location && !artifact?.target_audience?.age_range) {
    missingCoreRequirements.push("Target Audience");
  }
  const hasBudget = Boolean(artifact?.budget?.amount) || artifact?.budget?.type === "unknown";
  if (!hasBudget) missingCoreRequirements.push("Marketing Budget");
  if (!artifact?.timeline?.duration) missingCoreRequirements.push("Timeline Duration");

  const isReadyForConfirmation = missingCoreRequirements.length === 0;

  const handleConfirm = () => {
    if (!isReadyForConfirmation) return;
    router.push(`/campaign/${campaignId}/confirmation`);
  };

  /**
   * Generates a senior marketing consultant question for a missing field and loads into composer
   */
  const handleGenerateQuestion = (item: PreviewItem) => {
    const question = ConsultantQuestionGenerator.generateQuestion({
      fieldKey: item.key,
      fieldLabel: item.label,
      artifact,
    });

    if (onSelectQuestion) {
      onSelectQuestion(question, item.label);
    }

    setGeneratedToast(item.label);
    setTimeout(() => {
      setGeneratedToast((prev) => (prev === item.label ? null : prev));
    }, 4500);
  };

  /**
   * Starts inline editing for manually filling an answer
   */
  const startEditing = (item: PreviewItem) => {
    setEditingKey(item.key);
    const existingVal = item.value ? String(item.value).replace(/^BDT\s*/i, "") : "";
    setEditValue(existingVal);
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setEditValue("");
  };

  /**
   * Saves manually filled answer to Artifact-1
   */
  const saveEditing = async (item: PreviewItem) => {
    if (!campaignId) return;
    setIsSaving(true);
    try {
      const { section, field } = ConsultantQuestionGenerator.getSectionPath(item.key, item.label);
      let parsedValue: any = editValue.trim();

      if (field === "price" || field === "amount") {
        const num = parseFloat(parsedValue.replace(/[^0-9.]/g, ""));
        parsedValue = isNaN(num) ? null : num;
      }

      const res = await fetch(`/api/artifacts/1/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: {
            [section]: {
              [field]: parsedValue,
            },
          },
        }),
      });

      const data = await res.json();
      if (data.success && data.artifact) {
        if (onArtifactUpdate) {
          onArtifactUpdate(data.artifact);
        }
        setEditingKey(null);
        setEditValue("");
      }
    } catch (err) {
      console.error("Failed to save artifact update:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Toast Notification when Consultant Question is Generated */}
      {generatedToast && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center justify-between shadow-xs animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              Consultant question for <strong>{generatedToast}</strong> loaded into reply composer!
            </span>
          </div>
          <button
            type="button"
            onClick={() => setGeneratedToast(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 font-bold ml-2 text-sm"
          >
            ×
          </button>
        </div>
      )}

      {/* Header Badge */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
          <span className="text-xs font-semibold text-blue-900 dark:text-blue-300 uppercase tracking-wider">
            Artifact-1: Client Facts
          </span>
        </div>
        <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
          {collectedFields}/{totalFields} Captured ({completionPct}%)
        </span>
      </div>

      {/* Structured Sections */}
      <div className="flex flex-col gap-4">
        {sections.map((section, idx) => (
          <div
            key={idx}
            className="flex flex-col gap-2.5 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/40"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                {section.title}
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {section.data.map((item, i) => {
                const hasValue = Boolean(item.value);
                const isEditingThis = editingKey === item.key;

                if (isEditingThis) {
                  return (
                    <div
                      key={i}
                      className="p-3 rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20 flex flex-col gap-2 animate-in fade-in"
                    >
                      <span className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                        Manually Fill {item.label}:
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditing(item);
                            if (e.key === "Escape") cancelEditing();
                          }}
                          placeholder={`Enter ${item.label}...`}
                          className="flex-1 h-8 px-2.5 text-xs rounded-lg border border-blue-400 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => saveEditing(item)}
                          className="h-8 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer flex items-center gap-1 shadow-2xs"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isSaving ? "Saving..." : "Save"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="h-8 px-2 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                }

                // Complete Field (Green checkmark)
                if (hasValue) {
                  return (
                    <div
                      key={i}
                      className="group flex items-center justify-between p-2 rounded-lg hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50 transition-colors text-xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        {item.isUnknown ? (
                          <HelpCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        )}
                        <div className="flex flex-col leading-tight min-w-0">
                          <span className="text-zinc-500 font-medium">{item.label}</span>
                          <span
                            className={`truncate ${
                              item.isUnknown
                                ? "text-amber-700 dark:text-amber-400 font-medium"
                                : "text-zinc-900 dark:text-zinc-100 font-semibold"
                            }`}
                          >
                            {item.value}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded transition-opacity"
                        title="Edit / update answer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                }

                // Incomplete / Missing Field (Flagged, Clickable to generate question)
                return (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-50/90 dark:hover:bg-amber-950/40 hover:border-amber-400 transition-all shadow-2xs flex items-center justify-between gap-2 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => handleGenerateQuestion(item)}
                      className="flex items-start gap-2.5 text-left flex-1 min-w-0 cursor-pointer"
                      title="Click to generate senior consultant question for client"
                    >
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex flex-col leading-tight min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-zinc-800 dark:text-zinc-200 font-semibold">
                            {item.label}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                            Needs Info
                          </span>
                        </div>
                        <span className="text-zinc-400 italic text-[11px] mt-0.5">
                          Not provided yet — Click to ask client
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleGenerateQuestion(item)}
                        className="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-2xs flex items-center gap-1 transition-all cursor-pointer hover:shadow-xs active:scale-95"
                        title="Generate ready-to-send question for client"
                      >
                        <Sparkles className="w-3 h-3 text-blue-200" />
                        <span>Ask Client</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        className="p-1 px-2 text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg transition-colors cursor-pointer"
                        title="Manually fill client's answer"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation Call to Action (Gated by Core Requirements) */}
      {!isReadyForConfirmation ? (
        <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 shadow-xs flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Intake in Progress ({6 - missingCoreRequirements.length}/6 Core Requirements Captured)</span>
          </div>
          <p className="text-[11px] text-amber-800/90 dark:text-amber-300/80 leading-relaxed">
            All essential requirements must be discussed in the conversation before this brief can be confirmed and passed to the research agent.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider self-center">Still needed:</span>
            {missingCoreRequirements.map((req, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-100/90 dark:bg-amber-900/60 text-amber-950 dark:text-amber-200 border border-amber-200 dark:border-amber-800"
              >
                {req}
              </span>
            ))}
          </div>
          <Button
            disabled
            variant="outline"
            className="w-full h-11 text-xs font-medium text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 cursor-not-allowed mt-1"
          >
            Complete Remaining Details in Chat to Unlock
          </Button>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex flex-col gap-3 animate-in fade-in">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>All 6 core requirements captured! Ready for verification.</span>
          </div>
          <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
            Artifact-1 will be finalized and locked to launch autonomous market research.
          </p>
          <Button
            onClick={handleConfirm}
            className="w-full h-11 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
          >
            Review & Confirm Artifact-1 <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}

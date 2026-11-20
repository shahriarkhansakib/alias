"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Edit2,
  Trash2,
  Sparkles,
  Save,
  Tag,
  AlertCircle,
} from "lucide-react";
import { SCRIPT_CATEGORIES, ScriptCategory } from "@/models/AdminScript";

export interface ScriptItem {
  _id: string;
  title: string;
  category: ScriptCategory;
  content: string;
  keywords: string[];
  relevantSituations: string[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ScriptManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ScriptManagementModal({ isOpen, onClose }: ScriptManagementModalProps) {
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingScript, setEditingScript] = useState<Partial<ScriptItem> | null>(null);
  const [formKeywords, setFormKeywords] = useState("");

  const fetchScripts = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/communication/scripts");
      const data = await res.json();
      if (data.success && data.scripts) {
        setScripts(data.scripts);
      }
    } catch (err) {
      console.error("Failed to load scripts:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchScripts();
    }
  }, [isOpen]);

  const handleStartCreate = () => {
    setEditingScript({
      title: "",
      category: "Greeting",
      content: "",
      keywords: [],
      relevantSituations: [],
      isActive: true,
    });
    setFormKeywords("");
  };

  const handleStartEdit = (script: ScriptItem) => {
    setEditingScript(script);
    setFormKeywords((script.keywords || []).join(", "));
  };

  const handleSave = async () => {
    if (!editingScript?.title || !editingScript?.content || !editingScript?.category) return;
    setIsSaving(true);

    const keywordsArray = formKeywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    try {
      if (editingScript._id) {
        // Update
        const res = await fetch(`/api/admin/communication/scripts/${editingScript._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editingScript.title,
            category: editingScript.category,
            content: editingScript.content,
            keywords: keywordsArray,
            isActive: editingScript.isActive,
          }),
        });
        const data = await res.json();
        if (data.success) {
          await fetchScripts();
          setEditingScript(null);
        }
      } else {
        // Create
        const res = await fetch("/api/admin/communication/scripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editingScript.title,
            category: editingScript.category,
            content: editingScript.content,
            keywords: keywordsArray,
            isActive: editingScript.isActive,
          }),
        });
        const data = await res.json();
        if (data.success) {
          await fetchScripts();
          setEditingScript(null);
        }
      }
    } catch (err) {
      console.error("Failed to save script:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/communication/scripts/${id}/toggle`, {
        method: "PATCH",
      });
      const data = await res.json();
      if (data.success) {
        setScripts((prev) =>
          prev.map((s) => (s._id === id ? { ...s, isActive: data.script.isActive } : s))
        );
      }
    } catch (err) {
      console.error("Failed to toggle script:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this approved script?")) return;
    try {
      const res = await fetch(`/api/admin/communication/scripts/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setScripts((prev) => prev.filter((s) => s._id !== id));
      }
    } catch (err) {
      console.error("Failed to delete script:", err);
    }
  };

  const filteredScripts = scripts.filter((s) => {
    const matchesCategory = selectedCategory === "ALL" || s.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      s.title.toLowerCase().includes(q) ||
      s.content.toLowerCase().includes(q) ||
      (s.keywords || []).some((k) => k.toLowerCase().includes(q));
    return matchesCategory && matchesSearch;
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white dark:bg-zinc-950">
        <DialogHeader className="p-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Approved Script & Knowledge Base Manager
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-500">
                  Manage agency-approved response templates, pricing facts, and strategy scripts. The AI Copilot and Auto-Reply engine strictly ground all suggestions in these records.
                </DialogDescription>
              </div>
            </div>

            <Button
              size="sm"
              onClick={handleStartCreate}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              New Script
            </Button>
          </div>

          {/* Search & Category Filter */}
          <div className="flex items-center gap-3 mt-4">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-400" />
              <Input
                placeholder="Search scripts by title, content, or keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 text-xs bg-zinc-50 dark:bg-zinc-900"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-8 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-2 text-zinc-700 dark:text-zinc-300"
            >
              <option value="ALL">All Categories ({scripts.length})</option>
              {SCRIPT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </DialogHeader>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {editingScript ? (
            <div className="p-5 border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/20 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  {editingScript._id ? `Edit Script (v${editingScript.version || 1})` : "Create New Approved Script"}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingScript(null)}
                  className="text-xs"
                >
                  Cancel
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Script Title *
                  </label>
                  <Input
                    placeholder="e.g., Performance Pricing Policy"
                    value={editingScript.title || ""}
                    onChange={(e) =>
                      setEditingScript((prev) => ({ ...prev, title: e.target.value }))
                    }
                    className="text-xs h-8"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Category *
                  </label>
                  <select
                    value={editingScript.category || "Greeting"}
                    onChange={(e) =>
                      setEditingScript((prev) => ({
                        ...prev,
                        category: e.target.value as ScriptCategory,
                      }))
                    }
                    className="w-full h-8 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-2"
                  >
                    {SCRIPT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Approved Content / Policy Text *
                </label>
                <Textarea
                  placeholder="Enter the exact approved business script text, facts, or policy terms..."
                  value={editingScript.content || ""}
                  onChange={(e) =>
                    setEditingScript((prev) => ({ ...prev, content: e.target.value }))
                  }
                  rows={4}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Keywords (comma separated)
                </label>
                <Input
                  placeholder="e.g. pricing, cost, fee, কত টাকা, খরচ"
                  value={formKeywords}
                  onChange={(e) => setFormKeywords(e.target.value)}
                  className="text-xs h-8"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingScript.isActive ?? true}
                    onChange={(e) =>
                      setEditingScript((prev) => ({ ...prev, isActive: e.target.checked }))
                    }
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Active (enabled for AI Copilot grounding)</span>
                </label>

                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving || !editingScript.title || !editingScript.content}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSaving ? "Saving..." : "Save Approved Script"}
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="py-12 text-center text-xs text-zinc-400">Loading approved scripts...</div>
          ) : filteredScripts.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-400">
              No approved scripts found matching your filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredScripts.map((script) => (
                <div
                  key={script._id}
                  className={`p-4 rounded-xl border transition-all ${
                    script.isActive
                      ? "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-2xs"
                      : "bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200/60 dark:border-zinc-800/60 opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100">
                          {script.title}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                          {script.category}
                        </span>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          v{script.version || 1}
                        </span>
                        {script.isActive ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 font-medium">
                            <XCircle className="w-3 h-3" /> Inactive
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed mt-1">
                        {script.content}
                      </p>

                      {script.keywords && script.keywords.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-2">
                          <Tag className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
                          {script.keywords.map((kw, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-mono"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleActive(script._id)}
                        className="text-[11px] h-7 px-2"
                      >
                        {script.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(script)}
                        className="text-[11px] h-7 w-7 p-0 text-zinc-600 hover:text-blue-600"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(script._id)}
                        className="text-[11px] h-7 w-7 p-0 text-zinc-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Users,
  FolderKanban,
  MessageSquare,
  Search,
  FileCheck2,
  Database,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

export default function AdminDashboard() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    totalClients: 0,
    totalCampaigns: 0,
    activeConversations: 0,
    completedResearch: 0,
    completedBriefs: 0,
  });
  const [storageMode, setStorageMode] = useState<string>("demo_fallback");
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const loadData = () => {
    setIsLoading(true);
    fetch("/api/admin/campaigns")
      .then((res) => res.json())
      .then((data) => {
        if (data.campaigns) setCampaigns(data.campaigns);
        if (data.stats) setStats(data.stats);
        if (data.storageMode) setStorageMode(data.storageMode);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const statCards = [
    { label: "Total Clients", val: stats.totalClients, icon: Users, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/50" },
    { label: "Total Campaigns", val: stats.totalCampaigns, icon: FolderKanban, color: "text-purple-600 bg-purple-50 dark:bg-purple-950/50" },
    { label: "Active Conversations", val: stats.activeConversations, icon: MessageSquare, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/50" },
    { label: "Completed Research", val: stats.completedResearch, icon: Search, color: "text-teal-600 bg-teal-50 dark:bg-teal-950/50" },
    { label: "Completed Briefs", val: stats.completedBriefs, icon: FileCheck2, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50" },
  ];

  return (
    <div className="flex flex-col gap-8 max-w-7xl mx-auto">
      {/* Top Banner with Storage & System Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Agency Observability Dashboard
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Monitor client conversational intake, artifact generation, research progress, and master briefs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
            <Database className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-zinc-500">Storage:</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200 uppercase">
              {storageMode === "mongodb" ? "MongoDB Atlas" : "Demo Fallback Store"}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Link href="/admin/communication">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs">
              <MessageSquare className="w-3.5 h-3.5" />
              Client Messages
            </Button>
          </Link>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {statCards.map((sc, i) => {
          const Icon = sc.icon;
          return (
            <Card key={i} className="p-4 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500">{sc.label}</span>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${sc.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                {sc.val}
              </span>
            </Card>
          );
        })}
      </div>

      {/* Main Campaigns Table */}
      <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden rounded-2xl">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Clients & Campaigns</h3>
            <p className="text-xs text-zinc-500">Click any row to inspect conversation history and artifacts</p>
          </div>
          <span className="text-xs font-medium text-zinc-400">{campaigns.length} campaigns</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/40 text-xs font-semibold text-zinc-500 uppercase border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <th className="px-6 py-3.5">Client</th>
                <th className="px-6 py-3.5">Campaign Name</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5">Created At</th>
                <th className="px-6 py-3.5">Last Updated</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {campaigns.map((c) => (
                <tr
                  key={c._id}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer"
                  onClick={() => router.push(`/admin/campaigns/${c._id}`)}
                >
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {c.clientId?.name || "Demo Client"}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {c.clientId?.email || "client@example.com"}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium text-zinc-800 dark:text-zinc-200">
                    {c.name}
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <span
                      className={`px-2.5 py-1 rounded-full font-medium capitalize ${
                        c.status === "completed"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : c.status === "researching" || c.status === "research_completed"
                          ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                          : c.status === "confirmed" || c.status === "ready_for_confirmation"
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {c.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-zinc-500">
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "Today"}
                  </td>
                  <td className="px-6 py-4 text-xs text-zinc-500">
                    {c.updatedAt ? new Date(c.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/admin/campaigns/${c._id}`);
                      }}
                      className="text-xs"
                    >
                      Inspect <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-zinc-400">
                    No campaigns created yet. Click "Start New Campaign" to create the first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

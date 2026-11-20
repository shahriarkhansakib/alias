"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Circle,
  Clock,
  ArrowLeft,
  Bot,
  User,
  Sparkles,
  Code,
  FileText,
  Search,
  Compass,
  Building2,
  Package,
  Target,
  Users,
  Wallet,
  Calendar,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import Artifact1ReviewView from "@/components/admin/Artifact1ReviewView";

export default function AdminCampaignDetail() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState("overview");
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/campaigns/${campaignId}`)
      .then((res) => res.json())
      .then((resData) => {
        setData(resData);
      })
      .catch(console.error);
  }, [campaignId]);

  if (!data) return <div className="p-8 text-center text-zinc-500">Loading campaign audit...</div>;

  const campaign = data.campaign;
  const isConfirmed = campaign?.status === "confirmed" || campaign?.status === "researching" || campaign?.status === "research_completed" || campaign?.status === "completed";
  const isResearchDone = campaign?.status === "research_completed" || campaign?.status === "completed";
  const isBriefDone = campaign?.status === "completed";

  const lifecycleStages = [
    { title: "Campaign Created", done: true, desc: "Session initialized" },
    { title: "Conversation Started", done: (data.messages?.length || 0) > 0, desc: `${data.messages?.length || 0} messages logged` },
    { title: "Artifact-1 Generated", done: Boolean(data.artifact1), desc: "Client facts captured" },
    { title: "Client Confirmed", done: isConfirmed, desc: isConfirmed ? "Confirmed by client" : "Pending client confirmation" },
    { title: "Campaign Deliverables Generated", done: isBriefDone || Boolean(campaign?.masterBriefMarkdown), desc: (isBriefDone || Boolean(campaign?.masterBriefMarkdown)) ? "Brief & Execution Script ready" : "Awaiting client confirmation" },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="flex flex-col gap-1">
          <Link
            href="/admin"
            className="inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors w-fit mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to campaigns
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {campaign?.name || "Campaign Details"}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 uppercase">
              {campaign?.status?.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Client: <span className="font-medium text-zinc-700 dark:text-zinc-300">{campaign?.clientId?.name || "Demo Client"}</span> ({campaign?.clientId?.email}) • ID: <span className="font-mono">{campaign?._id}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowJson(!showJson)}
            className="text-xs"
          >
            <Code className="w-3.5 h-3.5 mr-1" /> {showJson ? "Structured View" : "Debug JSON"}
          </Button>
          <Link href={`/campaign/${campaignId}/brief`}>
            <Button size="sm" className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
              <FileText className="w-3.5 h-3.5 mr-1" /> View Deliverables
            </Button>
          </Link>
          <Link href={`/campaign/${campaignId}`}>
            <Button variant="outline" size="sm" className="text-xs">
              Open Client View <ExternalLink className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-1 overflow-x-auto text-xs sm:text-sm">
        {[
          { key: "overview", label: "Overview & Lifecycle" },
          { key: "chat", label: `Conversation (${data.messages?.length || 0})` },
          { key: "artifact-1", label: "Artifact-1 (Client Facts)" },
          { key: "artifact-2", label: "Artifact-2 (Research)" },
          { key: "master-brief", label: "Master Campaign Brief" },
        ].map((t) => (
          <button
            key={t.key}
            className={`px-4 py-2 font-medium rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
              tab === t.key
                ? "border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/30"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showJson ? (
        <Card className="p-6 bg-zinc-900 text-zinc-100 font-mono text-xs overflow-x-auto rounded-2xl">
          <pre className="whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
        </Card>
      ) : (
        <div>
          {/* TAB 1: OVERVIEW & LIFECYCLE */}
          {tab === "overview" && (
            <div className="flex flex-col gap-6">
              <Card className="p-6 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                  Campaign Observability & Lifecycle
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {lifecycleStages.map((stage, i) => (
                    <div
                      key={i}
                      className={`p-4 rounded-xl border flex items-start gap-3 ${
                        stage.done
                          ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900"
                          : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 opacity-60"
                      }`}
                    >
                      {stage.done ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" />
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {stage.title}
                        </span>
                        <span className="text-xs text-zinc-500">{stage.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* TAB 2: CHAT TRANSCRIPT WITH EXTRACTION BADGES */}
          {tab === "chat" && (
            <Card className="p-6 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Client & AI Interaction Timeline
                </h3>
                <span className="text-xs text-zinc-500">{data.messages?.length || 0} messages</span>
              </div>
              <div className="flex flex-col gap-4">
                {data.messages?.map((m: any, i: number) => (
                  <div
                    key={i}
                    className={`p-4 rounded-xl text-sm border flex flex-col gap-2 ${
                      m.sender === "user"
                        ? "bg-blue-50/50 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/40 ml-6"
                        : m.sender === "ai"
                        ? "bg-zinc-50 border-zinc-200 dark:bg-zinc-800/40 dark:border-zinc-800 mr-6"
                        : "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900 mx-4"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <div className="flex items-center gap-1.5 capitalize text-zinc-600 dark:text-zinc-400">
                        {m.sender === "user" ? <User className="w-3.5 h-3.5 text-blue-600" /> : <Bot className="w-3.5 h-3.5 text-zinc-600" />}
                        <span>{m.sender === "user" ? "Client" : m.sender === "ai" ? "Marketing Agent" : "System Notification"}</span>
                      </div>
                      <span className="text-zinc-400 font-normal">
                        {m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                    </div>

                    <div className="leading-relaxed text-zinc-900 dark:text-zinc-100">{m.content}</div>

                    {m.extractedFields && Object.keys(m.extractedFields).length > 0 && (
                      <div className="mt-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs">
                        <span className="font-semibold text-emerald-800 dark:text-emerald-300 block mb-1">
                          ✓ Facts Extracted & Saved to Artifact-1:
                        </span>
                        <pre className="font-mono text-emerald-900 dark:text-emerald-200 whitespace-pre-wrap">
                          {JSON.stringify(m.extractedFields, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
                {(!data.messages || data.messages.length === 0) && (
                  <p className="text-zinc-400 text-center py-8">No messages recorded in this conversation yet.</p>
                )}
              </div>
            </Card>
          )}

          {/* TAB 3: ARTIFACT 1 */}
          {tab === "artifact-1" && (
            <div className="flex flex-col gap-4">
              <Artifact1ReviewView
                artifact={data.artifact1}
                campaignId={campaignId}
                isAdmin={true}
                onArtifactUpdate={(updated) => {
                  setData((prev: any) => ({ ...prev, artifact1: updated }));
                }}
              />
            </div>
          )}

          {/* TAB 4: ARTIFACT 2 */}
          {tab === "artifact-2" && (
            <Card className="p-6 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Artifact-2: Research & Enrichment Findings
                  </h3>
                  <span className="px-2 py-0.5 rounded text-xs uppercase font-medium bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                    Status: {data.artifact2?.status || "pending"}
                  </span>
                </div>
              </div>

              {data.artifact2 ? (
                <div className="flex flex-col gap-6 text-sm">
                  <div>
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Market Overview</h4>
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs leading-relaxed">
                      {data.artifact2.market_research?.overview}
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Competitors Benchmarked</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {data.artifact2.competitor_research?.map((comp: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border text-xs">
                          <span className="font-bold text-zinc-900 dark:text-zinc-100">{comp.name}</span>
                          <p className="text-zinc-500 mt-1">Price: {comp.price_range}</p>
                          <p className="text-zinc-500">{comp.positioning}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Audience Research Insights</h4>
                    <ul className="list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                      {data.artifact2.audience_research?.pain_points?.map((pp: string, i: number) => (
                        <li key={i}>Pain Point: {pp}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-400 py-6 text-center">Artifact-2 has not been generated yet.</p>
              )}
            </Card>
          )}

          {/* TAB 5: MASTER CAMPAIGN BRIEF */}
          {tab === "master-brief" && (
            <Card className="p-6 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Master Campaign Brief
                  </h3>
                  <span className="px-2 py-0.5 rounded text-xs uppercase font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Status: {data.masterBrief?.status || "pending"}
                  </span>
                </div>
              </div>

              {data.masterBrief ? (
                <div className="flex flex-col gap-5 text-sm">
                  <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50">
                    <span className="text-xs font-semibold uppercase text-blue-700 dark:text-blue-300">
                      Core Strategic Message
                    </span>
                    <p className="font-medium text-base text-zinc-900 dark:text-zinc-100 mt-1">
                      "{data.masterBrief.strategic_direction?.key_message}"
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border text-xs">
                      <span className="font-semibold uppercase text-zinc-500">Offer & Pricing Recommendation</span>
                      <p className="mt-1 text-zinc-800 dark:text-zinc-200">
                        {data.masterBrief.offer_and_pricing?.recommended_offer_direction}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border text-xs">
                      <span className="font-semibold uppercase text-zinc-500">Creative Content Direction</span>
                      <ul className="mt-1 space-y-1 text-zinc-800 dark:text-zinc-200">
                        {data.masterBrief.strategic_direction?.content_direction?.map((cd: string, i: number) => (
                          <li key={i}>• {cd}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-400 py-6 text-center">Master Campaign Brief has not been generated yet.</p>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

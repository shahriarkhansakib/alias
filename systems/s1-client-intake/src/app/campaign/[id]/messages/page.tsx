import React from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { ClientMessageView } from "@/components/campaign/ClientMessageView";
import { Repository } from "@/lib/db/repo";

export default async function CampaignMessagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";
  const campaign = await Repository.getCampaignById(campaignId).catch(() => null);

  return (
    <div className="min-h-screen bg-zinc-50/50 dark:bg-zinc-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href={`/campaign/${campaignId}/brief`}
            className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Campaign Overview
          </Link>

          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {campaign?.name || "Campaign Communication"}
            </span>
          </div>
        </div>

        {/* Messaging Interface */}
        <ClientMessageView campaignId={campaignId} campaignName={campaign?.name} />
      </div>
    </div>
  );
}

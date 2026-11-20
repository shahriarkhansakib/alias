"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewCampaignPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const initCampaign = useCallback(async () => {
    setIsInitializing(true);
    setError(null);

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Marketing Campaign" }),
      });

      if (!res.ok) {
        let errMsg = `Server responded with status ${res.status}`;
        try {
          const errData = await res.json();
          if (errData?.details) {
            errMsg = errData.details;
          } else if (errData?.error) {
            errMsg = errData.error;
          }
        } catch {
          // not json
        }
        setError(errMsg);
        setIsInitializing(false);
        return;
      }

      const data = await res.json();
      if (data?.campaignId) {
        router.push(`/campaign/${data.campaignId}`);
      } else {
        setError("No campaignId returned from server");
        setIsInitializing(false);
      }
    } catch (err: any) {
      console.error("[NewCampaign] Failed to initialize campaign:", err);
      setError(err.message || "Failed to initialize campaign session.");
      setIsInitializing(false);
    }
  }, [router]);

  useEffect(() => {
    initCampaign();
  }, [initCampaign]);

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="flex flex-col items-center max-w-sm text-center gap-5 p-8 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        {isInitializing ? (
          <>
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Starting AI Session
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Setting up your campaign workspace and initializing the marketing consultant agent...
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-600">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Setup Issue
              </h2>
              <p className="text-xs text-rose-600 dark:text-rose-400 mt-1 font-mono bg-rose-50 dark:bg-rose-950/30 p-2 rounded">
                {error}
              </p>
            </div>
            <div className="flex gap-2 w-full mt-2">
              <Button onClick={() => initCampaign()} className="flex-1">
                <RefreshCw className="w-4 h-4 mr-2" /> Try Again
              </Button>
              <Link href="/" className="flex-1">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Home
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

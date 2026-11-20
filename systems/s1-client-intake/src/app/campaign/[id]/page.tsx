"use client";

import { useEffect, useState } from "react";
import ChatInterface from "@/components/chat/ChatInterface";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";

export default function CampaignPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = (params.id as string) || "";
  const campaignId = rawId ? rawId.replace(/^[./\\]+|[./\\;,:]+$/g, "") : "";

  const [artifact, setArtifact] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // If campaignId is missing or resolves to "new", auto-create session and redirect
  useEffect(() => {
    if (!campaignId || campaignId.toLowerCase() === "new") {
      fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Marketing Campaign" }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.campaignId) {
            router.replace(`/campaign/${data.campaignId}`);
          } else {
            router.replace("/campaign/new");
          }
        })
        .catch(() => {
          router.replace("/campaign/new");
        });
    }
  }, [campaignId, router]);

  // Verify campaign existence and load initial artifact
  useEffect(() => {
    if (!campaignId || campaignId.toLowerCase() === "new") return;

    let isMounted = true;
    async function verifyAndLoad() {
      setIsVerifying(true);
      try {
        const checkRes = await fetch(`/api/campaigns/${campaignId}`);
        if (!checkRes.ok) {
          if (checkRes.status === 404 && isMounted) {
            setNotFound(true);
          }
          return;
        }

        const artRes = await fetch(`/api/artifacts/1/${campaignId}`);
        if (artRes.ok) {
          const data = await artRes.json();
          if (isMounted && data && data.artifact) {
            setArtifact(data.artifact);
          }
        }
      } catch (err) {
        console.warn("[CampaignPage] Verification error:", err);
      } finally {
        if (isMounted) setIsVerifying(false);
      }
    }

    verifyAndLoad();
    return () => {
      isMounted = false;
    };
  }, [campaignId]);

  // Loading state when auto-redirecting /new. or /new
  if (!campaignId || campaignId.toLowerCase() === "new") {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center max-w-sm text-center gap-4 p-8 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm animate-in fade-in">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Initializing Campaign Session...
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Preparing your AI marketing consultant workspace...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Not found state
  if (notFound) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center max-w-sm text-center gap-5 p-8 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm animate-in fade-in">
          <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Campaign Session Not Found
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              This campaign does not exist or may have expired. Start a new marketing campaign to begin chatting with the AI consultant.
            </p>
          </div>
          <div className="flex gap-2 w-full mt-2">
            <Button onClick={() => router.push("/campaign/new")} className="flex-1">
              Start New Campaign
            </Button>
            <Link href="/" className="flex-1">
              <Button variant="outline" className="w-full">
                Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Verifying campaign session state
  if (isVerifying) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center max-w-sm text-center gap-4 p-8 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm animate-in fade-in">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Loading Campaign Session...
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Connecting to workspace and loading conversation facts...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* Main Conversational Workspace (Full Width & Clean Focus) */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Top Header */}
        <header className="px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between shadow-2xs z-10 shrink-0">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Return to Home"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                AI Marketing Consultant
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                  Intake Active
                </span>
              </h1>
              <p className="text-xs text-zinc-500">
                Interactive strategic intake • Discuss your brand & campaign objectives
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="text-xs text-zinc-500 h-8 px-2.5">
                Admin
              </Button>
            </Link>
          </div>
        </header>

        {/* Chat Area (Centered, Clean Focus) */}
        <div className="flex-1 overflow-hidden relative flex justify-center">
          <div className="w-full max-w-4xl h-full flex flex-col">
            <ChatInterface
              campaignId={campaignId}
              onArtifactUpdate={(newArtifact) => setArtifact(newArtifact)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Behind the Alias gateway, apps/web has already verified a platform admin before any
// /intake/admin request reaches this app (apps/web/src/proxy.ts), so the separate
// NextAuth login is skipped when NEXT_PUBLIC_TRUST_GATEWAY_AUTH=true.
const TRUST_GATEWAY_AUTH = process.env.NEXT_PUBLIC_TRUST_GATEWAY_AUTH === "true";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (TRUST_GATEWAY_AUTH) {
      return;
    }
    if (status === "unauthenticated") {
      router.push("/api/auth/signin"); // default next auth signin
    } else if (status === "authenticated" && (session?.user as any)?.role !== "admin") {
      // Demo logic: allow client to bypass for MVP ease of testing, 
      // but ideally restrict to role === 'admin'
      console.warn("User is not admin, but allowing for demo purposes.");
    }
  }, [status, session, router]);

  if (!TRUST_GATEWAY_AUTH && status === "loading") {
    return <div className="p-10">Checking permissions...</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex flex-col">
      <header className="bg-white dark:bg-zinc-900 border-b p-4 flex justify-between items-center">
        <h1 className="font-bold text-xl">Admin Dashboard</h1>
        <button className="text-sm text-blue-600" onClick={() => { window.location.href = TRUST_GATEWAY_AUTH ? "/admin" : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`; }}>Exit Admin</button>
      </header>
      <main className="flex-1 p-8">
        {children}
      </main>
    </div>
  );
}

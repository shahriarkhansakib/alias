import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24 bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900">
      <main className="flex flex-col items-center text-center max-w-3xl gap-8">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl text-zinc-900 dark:text-white">
          Autonomous <span className="text-blue-600">Marketing</span> Agency
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Transform your business with our AI-powered marketing strategy workflow. Let our autonomous agents gather your requirements, conduct deep market research, and build your master campaign brief.
        </p>
        <div className="flex gap-4">
          <Link href="/campaign/new">
            <Button size="lg" className="h-12 px-8 text-md">
              Start New Campaign
            </Button>
          </Link>
          <Link href="/admin">
            <Button size="lg" variant="outline" className="h-12 px-8 text-md">
              Admin Dashboard
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

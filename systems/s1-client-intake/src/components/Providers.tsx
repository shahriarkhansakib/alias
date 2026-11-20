"use client";

import { SessionProvider } from "next-auth/react";
import { BASE_PATH } from "@/lib/gateway/base-path-fetch";
import { BasePathFetch } from "./BasePathFetch";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath={`${BASE_PATH}/api/auth`}>
      <BasePathFetch />
      {children}
    </SessionProvider>
  );
}

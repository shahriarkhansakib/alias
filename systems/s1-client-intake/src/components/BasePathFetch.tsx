"use client";

import { installBasePathFetch } from "@/lib/gateway/base-path-fetch";

// Patch fetch during render (not in an effect) so it is in place before children fetch.
installBasePathFetch();

export function BasePathFetch() {
  return null;
}

/**
 * Next.js basePath prefixes <Link>, router.push and redirect(), but NOT plain
 * fetch("/api/..."). Behind the Alias gateway this app lives under /intake, so
 * this shim rewrites same-origin "/api/..." requests to "/intake/api/...".
 * Installed once on the client by <BasePathFetch /> in the root layout.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/intake";

export function withBasePath(input: string): string {
  if (!BASE_PATH || !input.startsWith("/") || input.startsWith("//")) return input;
  if (input === BASE_PATH || input.startsWith(`${BASE_PATH}/`)) return input;
  return input.startsWith("/api/") || input === "/api" ? `${BASE_PATH}${input}` : input;
}

let installed = false;

export function installBasePathFetch(): void {
  if (installed || typeof window === "undefined" || !BASE_PATH) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return originalFetch(withBasePath(input), init);
    }
    if (input instanceof URL && input.origin === window.location.origin) {
      const rewritten = withBasePath(input.pathname);
      if (rewritten !== input.pathname) {
        return originalFetch(new URL(`${rewritten}${input.search}`, input.origin), init);
      }
    }
    return originalFetch(input, init);
  };
}

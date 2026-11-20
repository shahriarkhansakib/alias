# Single-URL gateway (Phase A)

## What it does

Every part of Alias is reached through **one address, `http://localhost:3000`**, started with **one
command, `pnpm dev:all`**. Users never see another port.

| Path on :3000                                        | Forwarded to                           | Who may open it                         |
| ---------------------------------------------------- | -------------------------------------- | --------------------------------------- |
| `/`, `/login`, `/register`, `/dashboard`, `/admin`   | `apps/web` itself                      | everyone (pages check their own access) |
| `/intake/campaign/*` and other System 1 client pages | System 1 (Next.js, internal :3005)     | signed-in clients and admins            |
| `/intake/admin/*`, `/intake/api/admin/*`             | System 1 operator console              | admins only                             |
| `/studio/*`                                          | System 2 web (Next.js, internal :3001) | admins only                             |
| `/publish/*`                                         | System 3 web (Vite, internal :5173)    | admins only                             |
| `/svc/creative/*`                                    | System 2 API (FastAPI, internal :8000) | admins only                             |
| `/svc/publishing/*`                                  | System 3 API (Express, internal :3002) | admins only                             |

Clients see one action on `/dashboard`: **Chat with Alias** (`/intake/campaign/new`).
Admins see a **Systems & agents** section at the top of `/admin`.

## How it works

1. `apps/web/src/proxy.ts` (Next.js 16's renamed middleware) runs first for every gated path. It asks
   the platform API `/api/v1/access-context` who the caller is (`anonymous`, `client` or `admin`).
2. `apps/web/src/lib/gateway-policy.ts` decides: allow, redirect (to `/login` or `/dashboard`), or
   `403` for API paths. Unit tests: `gateway-policy.unit.test.ts` (happy paths, edge cases, error cases).
3. If allowed, the `beforeFiles` rewrites in `apps/web/next.config.ts` forward the request to the
   system's internal address. Internal addresses can be overridden with `ALIAS_S1_INTERNAL_URL`,
   `ALIAS_S2_WEB_INTERNAL_URL`, `ALIAS_S2_API_INTERNAL_URL`, `ALIAS_S3_WEB_INTERNAL_URL`,
   `ALIAS_S3_API_INTERNAL_URL`. `proxyTimeout` is 120 s because AI calls can be slow.
4. Each system knows it lives under a sub-path:
   - System 1: `basePath: '/intake'`. Next.js does not prefix plain `fetch('/api/...')`, so
     `src/lib/gateway/base-path-fetch.ts` patches `window.fetch` once (tested). NextAuth uses
     `SessionProvider basePath` and `NEXTAUTH_URL=http://localhost:3000/intake/api/auth`.
     `NEXT_PUBLIC_TRUST_GATEWAY_AUTH=true` skips its own admin login because the gateway already
     verified the admin.
   - System 2 web: `basePath: '/studio'`, API at `NEXT_PUBLIC_API_URL=/svc/creative` (same origin, no CORS).
   - System 3 web: Vite `base: '/publish/'`, React Router `basename`, API at `VITE_API_BASE_URL=/svc/publishing`.
5. `scripts/dev-all.mjs` starts all six processes with labelled output; `scripts/setup-systems.mjs`
   installs everything once and creates missing `.env` files from their `.env.example`.

## Why this design

- The three systems use different stacks (Next.js + MongoDB, FastAPI + Next.js, Express + Vite), so they
  cannot become one process quickly. A path-based gateway gives one URL, one login gate and role
  separation now, without rewriting them.
- The access rules live in one pure, tested function, so they can be reviewed and extended in one place.
- Systems are only reachable after the platform has authenticated the user, which is the foundation for
  Phase B (one identity, one database, one orchestrator).

## Known limits (follow-ups for Phase B)

- System 3 still shows its own login (owner setup, then sign-in) behind the gateway.
- System 2 shows its own developer-organisation picker; its first dev login can return a one-off 500
  (a race when two first-time logins create the same user), and the retry succeeds.
- System 1 needs `MONGODB_URI`; without it every request waits ~30 s before an in-memory fallback.
- Internal ports are still reachable on the developer machine; in production only :3000 should be exposed.
- Hot reload of System 3 (Vite) does not pass through the gateway; refresh the page after edits.

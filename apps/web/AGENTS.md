# AGENTS.md — apps/web

Next.js 16 App Router frontend. Read the root `AGENTS.md` first; this file adds rules for the web app.

## What it does

One app, one URL, three experiences chosen by role after login:

- **Client** (`/dashboard`, later the chat) — talks to Alias.
- **Operator and super admin** (`/admin`) — inbox, campaigns, systems, settings.
- **Public** (`/`, `/login`, `/register`) — landing and authentication.

`src/app/api/[...path]` forwards `/api/*` to the API (`API_INTERNAL_URL`), so the browser only ever
talks to the web app's own address and login cookies stay first-party.

## Rules

- Never import from `apps/api`. Shared types come only from `@alias/contracts`.
- Fetch data on the server (Server Components, route handlers) where possible; never expose secrets
  to client components (only `NEXT_PUBLIC_*` variables reach the browser).
- Route protection is a convenience; the API is the real authority. Never trust the client for roles.
- Every user-facing string should be ready for Bangla and English; do not hard-code layout to one
  language's text length.
- Accessibility: every interactive element is reachable by keyboard and has an accessible name.

## Tests

End-to-end tests live in `e2e/` and run with `pnpm --filter @alias/web test:e2e` (Playwright). Cover
each role's main path: sign in, land in the right area, sign out.

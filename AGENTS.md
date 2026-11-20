# AGENTS.md — Alias

Instructions for every AI coding agent working in this repository (Claude Code, Antigravity,
Cursor, Codex, Copilot, Gemini CLI and others). Humans: this is also the fastest onboarding read.

This file is the **single source of truth** for agent instructions. Tool-specific files
(`CLAUDE.md`, `.claude/`) are generated from it and from `.agents/` — never edit them by hand.
See `docs/agents/README.md` for how each tool finds these files.

## What Alias is

Alias is an AI marketing agency product for small businesses. A client chats with Alias; AI agents
plan, create, publish and measure campaigns; an Alias operator approves every step.

- **Client** — sees a chat with Alias, and optionally their brief, budget plan, creatives, results.
- **Operator** (`platform_admin`) — unified inbox, campaigns, all systems and agents.
- **Super admin** (`super_admin`) — everything, plus staff, security policy and settings.

Systems: S1 intake & support chat → AG-4 budget planner → S2 creative → S3 publishing & insights.
The full plan lives in the "Alias — Product & Engineering Master Plan" doc.

## Repository map

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 16 (App Router). Client chat, operator panel, super admin. Proxies `/api/*` to the API. |
| `apps/api` | Hono + OpenAPI backend. Modular monolith under `src/modules/<module>/`. |
| `packages/contracts` | Zod v4 schemas shared by web and API. The only shared types. |
| `packages/config` | TypeScript presets and ESLint architecture-boundary rules. |
| `docs/adr` | Architecture Decision Records. |
| `.agents/` | Canonical agent rules and skills (source of truth). |

## Commands

Use **pnpm** only (never npm or yarn). Node >= 22.14.

```sh
docker compose up -d --wait   # Postgres 18 + Mailpit
pnpm install
pnpm db:migrate               # apply migrations and seed roles
pnpm dev                      # web + api
pnpm lint                     # Biome + architecture boundaries
pnpm typecheck
pnpm test                     # unit + integration
pnpm test:e2e                 # Playwright
pnpm format                   # Biome format
pnpm agents:sync              # regenerate tool-specific agent files after editing .agents/
```

Before saying a task is done, run `pnpm lint`, `pnpm typecheck` and the tests for what you changed,
and report the results honestly — including failures.

## How to work here

1. **Plan first for anything non-trivial.** Read the relevant code, write a short plan (files to
   change, approach, tests), and get it approved before editing.
2. **Read the nearest `AGENTS.md`.** Before editing files in a folder, read the `AGENTS.md` closest
   to that folder (e.g. `apps/api/AGENTS.md`). It overrides this file for that area.
3. **Small, reviewable changes.** One concern per branch and pull request.
4. **Keep docs true.** If your change alters what a module does or how, update that module's
   `AGENTS.md` in the same pull request. Record significant decisions as an ADR (`write-adr` skill).
5. **Never invent.** Do not invent APIs, env vars, table names or library features. Check the code
   or the official docs; if unsure, say so.

## Architecture rules (enforced by `pnpm lint:arch`)

- API modules have four layers: `domain/` (pure logic) ← `application/` (use cases) ←
  `infrastructure/` (DB, external services) and `http/` (routes). Inner layers never import outer.
- Other code imports a module only through its `index.ts`.
- `apps/web` never imports from `apps/api`; both share types only through `packages/contracts`.
- Every row belonging to a customer carries its tenant id; every query filters by it.
- Every LLM output is validated against a schema before it is used or stored.

## Testing

Every API test suite is organised in three clearly separated sections, in this order:
**happy paths**, then **edge cases**, then **error cases** (`describe` blocks with those names).
Use the `api-test-suite` skill. Integration tests use a real Postgres, not mocks.

## Git

- Never commit to or push `main` directly. Branch as `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Conventional commit messages: `feat(intake): add message history endpoint`.
- Open a pull request; CI must be green before merge.

## Security

- **Never read, print or commit `.env`, `.env.local` or any secret.** Use `.env.example` to learn
  which variables exist. Never paste real keys into code, tests, logs or chat.
- Never run destructive commands (`db:reset`, `rm -rf`, force-push) without explicit approval.
- `db:reset` is for localhost only.

## Skills available (in `.agents/skills/`)

| Skill | Use it to |
| --- | --- |
| `new-api-module` | Scaffold a new API module with layers, barrel, `AGENTS.md` and tests |
| `api-test-suite` | Write or extend tests in happy / edge / error sections |
| `db-migration` | Change the database schema safely with Drizzle |
| `write-adr` | Record an architecture decision |
| `pre-pr-check` | Run every check and prepare a pull request description |

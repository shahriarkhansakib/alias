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
docker compose up -d --wait   # Postgres 18 + Mailpit (compose project "alias")
pnpm install
pnpm db:migrate               # apply migrations and the mandatory seed data
pnpm dev                      # web + api, Turborepo terminal UI
pnpm dev:stream               # web + api, plain copyable output
pnpm dev:doctor               # check .env, Postgres, Mailpit and free ports
pnpm lint                     # Biome + architecture boundaries
pnpm typecheck
pnpm test                     # unit + integration
pnpm test:e2e                 # Playwright
pnpm test:scripts             # tests for scripts/ (agent config sync, doctor)
pnpm format                   # Biome format
pnpm agents:sync              # regenerate tool-specific agent files after editing .agents/
```

Destructive, local only, ask the user first (see Security):

```sh
pnpm db:reset                 # delete this project's containers and volumes, start fresh,
                              # migrate, mandatory seed; asks "Type yes" (--yes skips)
pnpm db:reset:schema          # drop and recreate the schemas in the running Postgres, migrate,
                              # mandatory seed; used by the E2E tests
```

Mandatory seed data (system roles and permissions) is listed in
`apps/api/src/db/mandatory-seeds.ts`. Demo data never goes there.

Before saying a task is done, run `pnpm lint`, `pnpm typecheck` and the tests for what you changed,
and report the results honestly — including failures.

## How to work here

1. **Plan first for anything non-trivial.** Read the relevant code, write a short plan (files to
   change, approach, tests), and get it approved before editing.
2. **Read the nearest `AGENTS.md`.** Before editing files in a folder, read the `AGENTS.md` closest
   to that folder (e.g. `apps/api/AGENTS.md`). It overrides this file for that area.
3. **Small, reviewable changes.** One concern per commit (see Git).
4. **Keep docs true.** If your change alters what a module does or how, update that module's
   `AGENTS.md` in the same pull request. Record significant decisions as an ADR (`write-adr` skill).
5. **Never invent.** Do not invent APIs, env vars, table names or library features. Check the code
   or the official docs; if unsure, say so.

## Architecture rules

API modules have up to four layers: `domain/` (pure logic) ← `application/` (use cases) ←
`infrastructure/` (DB, external services) and `http/` (routes). See `apps/api/AGENTS.md`.

### Enforced by lint (`pnpm lint:arch`, `packages/config/eslint-arch.mjs`)

- `domain/` and `application/` never import `infrastructure/`, `http/`, `src/db`, `shared/http`,
  `shared/email`, or Hono, Drizzle, `pg`, Better Auth, nodemailer, pino or Scalar.
- A module imports another module only through its `index.ts`. This covers modules listed in
  `MODULES` in `eslint-arch.mjs`; add new modules there.
- `authn` never imports any other module.
- A module's `infrastructure/schema.ts` may import another module only through that module's
  `infrastructure/schema.ts` (for foreign keys).
- `apps/web` never imports from `apps/api` or server libraries (Drizzle, `pg`, Hono, server-side
  Better Auth, nodemailer, pino).
- `packages/contracts` imports only `zod`.

### Conventions (not enforced; reviewers check them)

- Both apps share types only through `packages/contracts`.
- Routes parse input with contract schemas and call a use case; no business rules in routes.
- Code outside `src/modules/` (for example `src/scripts/`) should also use module barrels; the
  lint rules do not cover it.
- Planned, no tenant concept exists yet: once tenancy exists, every customer-owned row carries
  its tenant id and every query filters by it. Do not invent a tenant model in the meantime.
- Planned, no LLM calls exist yet: every LLM output is validated against a schema before it is
  used or stored.

## Testing

Every **new or changed** test suite has three clearly separated sections, in this order:
**happy paths**, then **edge cases**, then **error cases**:

- Vitest (API, scripts): `describe('happy paths')`, `describe('edge cases')`,
  `describe('error cases')`.
- Playwright (`apps/web/e2e/`): `test.describe('happy paths')`, and so on.

Suites written before this rule are known exceptions and are moved to the three sections when they
are next changed. API unit tests (`*.unit.test.ts`) sit next to the code; API integration tests
(`*.integration.test.ts`) live in `apps/api/src/test/` and use a real Postgres, not mocks. Use the
`api-test-suite` skill.

## Git

- All Phase 0 work is committed on the long-lived branch `phase-zero`, in small commits. Each
  commit passes `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and the tests relevant to it.
- Conventional commit messages: `feat(intake): add message history endpoint`.
- There is one draft pull request from `phase-zero` into `main`. Every pushed commit is reviewed.
- Agents may push to `phase-zero` only after the checks pass and after confirming the diff contains
  no secrets and no `.env` content (`pre-pr-check` skill).
- Agents never push to `main`, never force-push, never rewrite pushed history, and never merge
  pull requests. Only the owner merges.

## Security

- **Never read, print or commit any env file other than `.env.example`, or any secret.** Use
  `.env.example` to learn which variables exist. Never paste real keys into code, tests, logs or
  chat. Claude Code also denies these reads in `.claude/settings.json`; see
  `docs/agents/README.md` for what that does and does not block.
- Never run destructive commands (`db:reset`, `db:reset:schema`, `docker compose down -v`,
  `rm -rf`, dropping tables) without explicit approval. Force-pushing is never allowed (see Git).
- `db:reset` deletes the local Docker volume, so all local database data. Never pass `--yes` on
  the user's behalf without their approval. Both resets refuse `NODE_ENV=production` and any
  non-local `DATABASE_URL` host.

## Skills available (in `.agents/skills/`)

| Skill | Use it to |
| --- | --- |
| `new-api-module` | Scaffold a new API module with layers, barrel, `AGENTS.md` and tests |
| `api-test-suite` | Write or extend tests in happy / edge / error sections |
| `db-migration` | Change the database schema safely with Drizzle |
| `write-adr` | Record an architecture decision |
| `pre-pr-check` | Run the CI steps in order and confirm a commit is safe to push to `phase-zero` |

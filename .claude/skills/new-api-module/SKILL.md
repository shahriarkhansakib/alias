---
name: new-api-module
description: Scaffold a new backend module in apps/api (domain, application, infrastructure, http layers, index.ts barrel, AGENTS.md, tests). Use when adding a new product capability such as intake, budget, campaigns or publishing.
---

# New API module

Creates `apps/api/src/modules/<name>/` following the same shape as `platform-admin` and `authz`.

## Before writing code

1. Read `apps/api/AGENTS.md` and one existing module (`platform-admin` is the smallest).
2. Write a short plan and get it approved: the module's job in one sentence, its use cases, the
   tables it owns, the endpoints it exposes, the permissions each endpoint needs, and the contracts
   it uses from `@alias/contracts`.

## Steps

1. Create the folders `domain/`, `application/`, `infrastructure/`, `http/`.
2. `domain/types.ts`: the module's pure types and rules.
3. `application/<action>.ts`: one `create<Action>UseCase(deps)` factory per use case. Ports come in
   through `deps`; no Hono or Drizzle imports.
4. `infrastructure/schema.ts` (if it owns tables) and repository implementations. Re-export the
   tables from `apps/api/src/db/schema.ts`, then follow the `db-migration` skill.
5. `http/routes.ts`: Hono OpenAPI routes using request and response schemas from
   `@alias/contracts`. Protect each route with `requireAuth` and the needed permission.
6. `index.ts`: a `create<Name>Module(deps)` factory that wires use cases and returns the router, plus
   type-only exports other modules may need. Mount the router in `src/app.ts`.
7. Add the module's directory to the module-name list in `packages/config/eslint-arch.mjs` so the
   boundary rules cover it.
8. `AGENTS.md` in the module folder with three sections: **What it does**, **How it works**
   (use cases, tables, endpoints, permissions), **Why** (key decisions, links to ADRs).
9. Tests with the `api-test-suite` skill: unit tests for domain and application, integration tests
   for routes.
10. Run `pnpm agents:sync`, then the `pre-pr-check` skill.

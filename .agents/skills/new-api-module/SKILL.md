---
name: new-api-module
description: Scaffold a new backend module in apps/api (domain, application, infrastructure, http layers, index.ts barrel, AGENTS.md, tests). Use when adding a new product capability such as intake, budget, campaigns or publishing.
---

# New API module

Creates `apps/api/src/modules/<name>/`. Use `authz` as the template: it is the only module with all
four layers (`platform-admin` has no `infrastructure/`; `authn` wraps Better Auth).

## Before writing code

1. Read `apps/api/AGENTS.md`, `apps/api/src/modules/authz/AGENTS.md` and the `authz` code.
2. Write a short plan and get it approved: the module's job in one sentence, its use cases, the
   tables it owns, the endpoints it exposes, the permission each endpoint needs, and the contracts
   it uses from `@alias/contracts`.

## Steps

1. Add the module name to `MODULES` in `packages/config/eslint-arch.mjs`. The boundary rules are
   built from that list; a module missing from it is not covered.
2. Create the folders `domain/`, `application/`, `infrastructure/`, `http/`.
3. `domain/types.ts` for the module's types, `domain/ports.ts` for the interfaces the application
   needs (repositories and so on; methods take an optional `tx?: TransactionContext`), and pure
   rules in their own files (like `authz/domain/policies.ts`).
4. `application/<action>.ts`: one `create<Action>UseCase(deps)` factory per use case, receiving
   its ports through `deps`. Writes that matter run in `deps.unitOfWork.runInTransaction` and
   append an audit entry through `AuditLogPort` (exported by `authz`) with the same `tx`.
5. `infrastructure/schema.ts` (if it owns tables) and Drizzle repositories implementing the ports.
   Re-export the tables from `apps/api/src/db/schema.ts`, then follow the `db-migration` skill.
6. `http/routes.ts`: a `create<Name>Router(deps)` built with `createOpenAPIApp()` from
   `shared/http/openapi.ts`, using `createRoute` and request/response schemas from
   `@alias/contracts`. Paths start with `/api/v1/`. Guards are not imported; they come in through
   `deps`:
   - `requireAuth`: built in `src/app.ts` with `createRequireAuthMiddleware(authn.sessionResolver)`
     (from `authn`).
   - Platform permission: `requirePlatformPermission(permission)`, which `src/app.ts` builds with
     `createRequirePlatformPermissionMiddleware(authz.authorizationEngine, permission)` (from
     `authz`). See how `createPlatformAdminModule` receives it.
   - Customer-only routes: `requireCustomerAccess`, built with
     `createRequireCustomerAccessMiddleware(authz.authorizationEngine)`.
   Apply them with `router.use(path, deps.requireAuth, ...)` before `router.openapi(...)`.
7. `index.ts`: export a factory that wires repositories, use cases and the router (see
   `createAuthzInfrastructure` and `createPlatformAdminModule`), plus type-only exports other
   modules may need. Call it in `createApiApp` in `src/app.ts` and mount the router with
   `app.route('/', router)`.
8. If the module needs a new permission, add it to `PlatformPermission` in
   `authz/domain/types.ts` and to the roles in `src/db/seed-roles.ts`.
9. `AGENTS.md` in the module folder with three sections: **What it does**, **How it works**
   (use cases, tables, endpoints, permissions, ports), **Why** (key decisions, links to ADRs).
10. Tests with the `api-test-suite` skill: unit tests for domain and application next to the code,
    integration tests for routes in `apps/api/src/test/`.
11. Run `pnpm agents:sync` (it creates the module's `CLAUDE.md`), then the `pre-pr-check` skill.

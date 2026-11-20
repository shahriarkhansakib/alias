# AGENTS.md — apps/api

Hono + OpenAPI backend, built as a modular monolith. Read the root `AGENTS.md` first; this file adds
rules for the API.

## What it does

Serves `/api/v1/*` for the web app (which proxies `/api/*` to it). Owns authentication, authorization,
the platform admin control plane, and — as the product grows — intake (S1), budget (AG-4),
campaigns and publishing (S3).

## Layout

```
src/
  app.ts, server.ts      app wiring and HTTP server
  db/                    connection, migrate, reset
  modules/<module>/
    index.ts             the ONLY public entry point of the module
    domain/              pure business rules; no framework, ORM or I/O imports
    application/         use cases; orchestrates domain + ports; no Hono, Drizzle or SDKs
    infrastructure/      Drizzle repositories, schema.ts, external adapters
    http/                Hono OpenAPI routes; parse input, call application, map errors
    AGENTS.md            what the module does, how, and why
  shared/                cross-cutting adapters (http helpers, email)
  test/                  test helpers
```

## Current modules

| Module | Responsibility |
| --- | --- |
| `authn` | Better Auth sessions and identity: email/password, verification, Google OAuth, TOTP 2FA, rate limits. Never imports `authz` or `platform-admin`. |
| `authz` | `AuthorizationEngine` backed by Postgres: roles, permissions, platform role assignments, security settings, audit logs. |
| `platform-admin` | Platform control plane endpoints, guarded security policy, `super_admin` bootstrap CLI. |

## Rules

- Validate every request with Zod schemas from `@alias/contracts` via `@hono/zod-openapi`.
- Errors use the shared error shape in `packages/contracts/src/errors.ts`; never leak stack traces.
- Authorization is checked server-side in the application layer, never only in the web app.
- State changes that matter (approvals, role changes, policy changes) write an `audit_logs` row in the
  same transaction.
- Schema changes go through the `db-migration` skill; never edit an applied migration.

## Tests

`pnpm --filter @alias/api test:unit` and `pnpm --filter @alias/api test:integration` (needs
`docker compose up`). Suites use happy / edge / error sections.

# AGENTS.md — apps/api

Hono + OpenAPI backend, built as a modular monolith. Read the root `AGENTS.md` first; this file adds
rules for the API. Each module has its own `AGENTS.md`; read it before changing that module.

## What it does

Serves the web app, which proxies `/api/*` to it:

- `/api/auth/*`: Better Auth (sign-up, sign-in, verification, password reset, 2FA, Google).
- `/api/v1/*`: the application API.
- `/health`, `/api/openapi.json` (OpenAPI 3.1) and `/api/docs` (Scalar API reference).

Owns authentication, authorization and the platform admin control plane today. Planned: intake
(S1), budget (AG-4), campaigns and publishing (S3).

## Layout

```
src/
  app.ts                 createApiApp: middleware (request id, CSRF origin check), routers, errors
  server.ts              loads env, creates the database and logger, starts the HTTP server
  db/
    client.ts            pg pool, Drizzle instance and the UnitOfWork implementation
    schema.ts            aggregator: re-exports every module's tables (drizzle-kit reads this)
    migrate.ts           pnpm db:migrate: apply migrations, then seed roles
    seed-roles.ts        system roles and their permissions
    reset.ts             pnpm db:reset: local databases only
  modules/<module>/
    index.ts             the ONLY public entry point of the module
    domain/              pure business rules; no framework, ORM or I/O imports
    application/         use cases; orchestrates domain + ports; no Hono, Drizzle or SDKs
    infrastructure/      Drizzle repositories, schema.ts, external adapters
    http/                Hono OpenAPI routes and middleware; parse input, call application
    AGENTS.md            what the module does, how, and why
  scripts/
    bootstrap-admin.ts   pnpm bootstrap:admin -- --email <email>: create the first super_admin
  shared/
    env.ts               loadEnv(): validated environment config; read env vars through it
    errors.ts            AppError and its subclasses: ValidationError, UnauthorizedError,
                         ForbiddenError, NotFoundError, ConflictError, RateLimitError, InternalError
    id.ts                generateId(): UUIDv7 primary keys
    logger.ts            pino logger with redaction of cookies, tokens, passwords and secrets
    ports.ts             MailerPort, UnitOfWork, TransactionContext
    email/               nodemailer MailerPort adapter
    http/                createOpenAPIApp() and the Hono AppEnv type
  test/                  integration tests (*.integration.test.ts) and their helpers
```

## Current modules

| Module | Responsibility |
| --- | --- |
| `authn` | Better Auth sessions and identity: email/password, verification, Google OAuth, TOTP 2FA, rate limits. Never imports `authz` or `platform-admin`. |
| `authz` | `AuthorizationEngine` backed by Postgres: roles, permissions, platform role assignments, security settings, audit logs. Has all four layers. |
| `platform-admin` | Platform control plane endpoints, guarded security policy, `super_admin` bootstrap CLI. Owns no tables (no `infrastructure/`). |

Module names are listed in `MODULES` in `packages/config/eslint-arch.mjs`; the boundary rules cover
only modules listed there.

## Rules

- Validate every request with Zod schemas from `@alias/contracts` via `@hono/zod-openapi`.
- Throw the `AppError` subclasses from `shared/errors.ts`. `app.ts` turns them into the shared error
  envelope (`ApiErrorEnvelopeSchema` in `packages/contracts/src/errors.ts`) with a `requestId`;
  unknown errors become a 500 without a stack trace.
- Authorization is checked on the server: route middleware from `authz` checks the role and
  permission, and use cases check business rules such as the role hierarchy. The web app's checks
  are only for the experience.
- State changes that matter (role changes, policy changes; planned: approvals) write an
  `audit_logs` row in the same `UnitOfWork` transaction. Rejected attempts are audited too, after
  the rollback (see `platform-admin`'s `runWithRejectionAudit`).
- Schema changes go through the `db-migration` skill; never edit an applied migration.

## Tests

`pnpm --filter @alias/api test:unit` and `pnpm --filter @alias/api test:integration` (needs
`docker compose up -d --wait` and `pnpm db:migrate`). New or changed suites use happy / edge /
error sections (`api-test-suite` skill).

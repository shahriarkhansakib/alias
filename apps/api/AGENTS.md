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
    migrate.ts           pnpm db:migrate: applyMigrations(), then the mandatory seeds
    mandatory-seeds.ts   MANDATORY_SEEDS: data the app cannot run without (idempotent;
                         never demo data). Add new mandatory seeds here
    seed-roles.ts        system roles and their permissions (a mandatory seed)
    reset-schema.ts      pnpm db:reset:schema: drop/recreate schemas, migrate, seed (local only;
                         used by E2E); assertSafeLocalReset()
    rebuild.ts           pnpm db:reset: docker compose down -v / up, migrate, seed (local only,
                         asks "Type yes", --yes skips)
    connection-error.ts  describeDatabaseError(): one readable line for connection failures
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
    env.ts               loadEnv(): validated environment config; read env vars through it.
                         parseEnv() / formatEnvError() for the readable error report
    errors.ts            AppError and its subclasses: ValidationError, UnauthorizedError,
                         ForbiddenError, NotFoundError, ConflictError, RateLimitError, InternalError
    id.ts                generateId(): UUIDv7 primary keys
    logger.ts            createLogger(level, { pretty }): pino with redaction of cookies,
                         tokens, passwords and secrets
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

## Running and logging

Run steps: `docker compose up -d --wait`, copy `.env.example` to `.env` (root), `pnpm db:migrate`,
`pnpm dev` (API on `API_PORT`, default 4000). See the root `README.md`.

- **Environment.** `loadEnv()` validates with the Zod schema in `shared/env.ts`. If anything is
  missing or invalid it prints one line per problem (`z.prettifyError`) and a hint to copy
  `.env.example`, then exits with code 1, without a stack trace. Add new variables to the schema,
  to `.env.example`, and to `globalPassThroughEnv` in `turbo.json` (Turborepo strips variables it
  does not know about).
- **Logging.** Server code uses the injected `Logger` (pino), not `console.*`; the one-shot CLI
  scripts (`db/migrate.ts`, `db/reset.ts`, `scripts/bootstrap-admin.ts`) print with `console`. `server.ts`
  pretty-prints only when `NODE_ENV=development` (pino-pretty: one coloured line,
  `HH:MM:ss.l LEVEL [requestId] message {fields}`); production and test print JSON lines.
  `LOG_LEVEL` sets the level. `app.ts` logs every request once on completion with its
  `requestId`, method, path, status and duration. Pass personal data only in fields covered by
  `REDACT_PATHS`, and never log it at `info` or above.

## Tests

`pnpm --filter @alias/api test:unit` and `pnpm --filter @alias/api test:integration` (needs
`docker compose up -d --wait` and `pnpm db:migrate`). New or changed suites use happy / edge /
error sections (`api-test-suite` skill).

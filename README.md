# Alias

Modular-monolith TypeScript foundation built with pnpm workspaces, Turborepo, Next.js 16 (App Router), Hono OpenAPI, Drizzle ORM + PostgreSQL 18, Better Auth, and Mailpit.

## Architecture Overview

- `apps/web` — Next.js 16 frontend presentation layer with a same-origin `/api/[...path]` proxy to `apps/api`.
- `apps/api` — Hono OpenAPI REST backend enforcing strict inward modular boundaries (`domain/`, `application/`, `infrastructure/`, `http/`, single `index.ts` barrel per module).
  - `modules/authn`: Better Auth session & identity lifecycle (email/password, email verification, Google OAuth, TOTP `twoFactor`, DB-backed `rate_limit`). Never imports `authz` or `platform-admin`.
  - `modules/authz`: Server-side `AuthorizationEngine` backed by PostgreSQL (`roles`, `role_permissions`, `platform_role_assignments`, `platform_security_settings`, `audit_logs`).
  - `modules/platform-admin`: Platform control plane endpoints, guarded security policy management, and advisory-locked `super_admin` CLI bootstrap.
- `packages/contracts` — Pure Zod v4 schemas and DTOs.
- `packages/config` — Shared TypeScript presets and ESLint architectural boundary rules (`pnpm lint:arch`).

## Local Development Setup

Requires Node.js >= 22.14, pnpm (the version in `package.json` `packageManager`) and Docker.

1. Start PostgreSQL 18 and Mailpit:

   ```sh
   docker compose up -d --wait
   ```

   Mailpit's inbox, where verification and password-reset emails arrive, is at
   http://localhost:8025 by default. If your `.env` sets `MAILPIT_HTTP_PORT` (or
   `POSTGRES_PORT`, `MAILPIT_SMTP_PORT`), the ports differ; find the real ones with:

   ```sh
   docker compose ps             # PORTS column, e.g. 0.0.0.0:18025->8025/tcp
   docker compose port mailpit 8025   # just the Mailpit web UI address, e.g. 0.0.0.0:18025
   ```
2. Install workspace dependencies:

   ```sh
   pnpm install
   ```
3. Create `.env` in the repository root by copying `.env.example`, then fill in the values.
   `BETTER_AUTH_SECRET` must be at least 32 random characters. If a required variable is missing
   or invalid, every API command (`dev`, `db:migrate`, `bootstrap:admin`, …) stops with a short
   list of the problems and exits with code 1:

   ```text
   Invalid environment configuration (1 problem):

   ✖ Missing: set it to your Postgres connection URL
     → at DATABASE_URL

   Copy .env.example to .env in the repository root and fill in the values, or set the variables in your shell.
   ```
4. Apply reviewed forward-only SQL migrations and the mandatory seed data (system roles and
   permissions):

   ```sh
   pnpm db:migrate
   ```

   To start over from an empty database, see [Starting over](#starting-over-pnpm-dbreset).
5. Start development servers (web on http://localhost:3000, API on http://localhost:4000).
   There are two output modes; both skip replaying cached build logs (`--output-logs=new-only`):

   | Command           | Output                                                                                                                                                                    |
   | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `pnpm dev`        | Turborepo's terminal UI: one pane per app. Use the arrow keys to pick a pane, `Ctrl+C` to stop everything. Text inside panes is hard to select and copy.                  |
   | `pnpm dev:stream` | Plain lines prefixed with the app name (`@alias/api:dev: …`), all apps interleaved. Easy to copy, search and paste into an issue. Use it when you need to share an error. |

   Without a terminal (CI, piped output) `pnpm dev` also falls back to plain lines.

   If something does not start, run `pnpm dev:doctor` (see below).

### Checking your setup: `pnpm dev:doctor`

```sh
pnpm dev:doctor
```

Prints one line per check and exits with code 1 if any fails:

```text
✓ .env found
✗ Postgres not reachable at localhost:5432 (ECONNREFUSED)
    → Is Postgres running? Start the services with: docker compose up -d --wait
✓ Mailpit SMTP answering at 127.0.0.1:1025
✓ Mailpit web UI ready at http://127.0.0.1:8025
✓ Port 3000 (web) is free
✓ Port 4000 (API) is free
```

It checks that `.env` exists, that Postgres answers `SELECT 1` (`DATABASE_URL`), that Mailpit's
SMTP server greets (`SMTP_HOST`/`SMTP_PORT`), that the Mailpit web UI is ready
(`MAILPIT_API_URL`), and that ports 3000 (web) and `API_PORT` (default 4000) are free. It reads
`.env` and your shell environment but never prints their values. If you change Docker's ports
(`MAILPIT_SMTP_PORT`, `MAILPIT_HTTP_PORT`, `POSTGRES_PORT`), also change `SMTP_PORT`,
`MAILPIT_API_URL` and `DATABASE_URL` to match, otherwise the API talks to the wrong port.

It is `dev:doctor` and not `doctor` because `pnpm doctor` is a built-in pnpm command (it checks
pnpm's own installation) and runs instead of a script with that name.

### Starting over: `pnpm db:reset`

`pnpm db:reset` rebuilds your local database from scratch. It deletes this project's Docker
containers and volume (all local database data), starts fresh ones, applies the migrations and
seeds the mandatory data (system roles and permissions, never demo data):

```text
✓ Target is a local database (localhost:5432)
✓ Docker is running (server 29.0.1)
This deletes everything in the Docker Compose project "alias":
  containers: alias-postgres-1, alias-mailpit-1
  volumes:    alias_postgres_data (all local database data)
Type yes to continue: yes
✓ Confirmed
✓ Removed containers and volumes
✓ Started Postgres and Mailpit
✓ Postgres accepts connections
✓ Applied migrations
✓ Seeded system roles and permissions

✓ Done. Local database rebuilt.
  Postgres      localhost:5432
  Mailpit SMTP  localhost:1025
  Mailpit web   http://localhost:8025
  Seeded        mandatory data only (system roles and permissions)
```

- It refuses when `NODE_ENV=production` or when `DATABASE_URL` does not point at `localhost`,
  `127.0.0.1` or `::1`, and stops with a clear message if Docker is not running.
- Only the Compose project `alias` (pinned with `name:` in `docker-compose.yml`) is affected,
  whatever the folder is called.
- `pnpm db:reset --yes` skips the question. Without a terminal it refuses unless `--yes` is given.
- The summary shows the ports Docker really uses and warns if `DATABASE_URL`, `SMTP_PORT` or
  `MAILPIT_API_URL` point elsewhere.

`pnpm db:reset:schema` is the lighter version: it keeps the containers, drops and recreates the
schemas in the running Postgres, then migrates and seeds. The E2E tests use it.

After a reset there are no users. Register again, or create the first super admin as described in
[Initial Super Admin Bootstrap](#initial-super-admin-bootstrap).

### Logging

The API logs with pino, at the level set by `LOG_LEVEL` (default `info`):

- `NODE_ENV=development`: one coloured line per entry through pino-pretty, for example
  `[14:03:07.183] INFO: [01a1fadf-…] HTTP request completed {"method":"GET","path":"/api/v1/me","status":401,"durationMs":13}`.
  The request id in brackets matches the `x-request-id` response header.
- `NODE_ENV=production` and `test`: one JSON object per line, for log collectors.

Every request is logged once when it completes. Cookies, authorization headers, passwords,
tokens and secrets are redacted (`[REDACTED]`) in both formats.

## Initial Super Admin Bootstrap

Register and verify a user account first, then promote it via the advisory-locked CLI bootstrap:

```sh
pnpm bootstrap:admin -- --email admin@example.com
```

## Environment-Aware Platform 2FA Policy

Platform administrator MFA enforcement is controlled by the `platform_security_settings` singleton table (`id = 'default'`) combined with a safe environment default when no database override row exists:

- **`development`:** Defaults to **OFF** (`requirePlatformMfa = false`) for frictionless local development and database resets until an administrator turns it on.
- **`production` and `test`:** Defaults to **ON** (`requirePlatformMfa = true`), requiring personal TOTP enrollment and verification before accessing `/admin` or `/api/v1/platform/*`.

A `super_admin` can toggle the policy at runtime from **Platform Security & 2FA** inside `/admin` (`PATCH /api/v1/platform/security-settings`):

- Turning **ON** requires the calling `super_admin` to have personal 2FA enabled and verified (`409 MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT` otherwise) to prevent self-lockout.
- Turning **OFF** requires `super_admin` authorization (including MFA verification when the policy is currently ON).
- Every toggle writes an immutable `platform.security.mfa_policy_updated` entry to `audit_logs` inside the same database transaction.

## Verification Commands

- Format & lint: `pnpm format:check && pnpm lint`
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test:unit`
- PostgreSQL 18 integration tests: `pnpm test:integration`
- Production build: `pnpm build`
- Playwright E2E tests: `pnpm test:e2e`

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

1. Start PostgreSQL 18 and Mailpit:

   ```sh
   docker compose up -d --wait
   ```
2. Install workspace dependencies:

   ```sh
   pnpm install
   ```
3. Configure `.env` from `.env.example` (already provisioned locally if created during bootstrap).
4. Apply reviewed forward-only SQL migrations and seed system roles:

   ```sh
   pnpm db:migrate
   ```

   (Or run `pnpm db:reset` on localhost to drop/recreate schemas, apply all migrations, and seed system roles.)
5. Start development servers:

   ```sh
   pnpm dev
   ```

## Demo Accounts

For local demos and judging, create two verified accounts (no email inbox needed):

```bash
pnpm db:migrate
pnpm seed:demo
```

| Role                 | Email               | Password           | Lands on                            |
| -------------------- | ------------------- | ------------------ | ----------------------------------- |
| Client               | `demo@alias.local`  | `AliasDemo#2026!`  | `/dashboard` (links to Systems 1–3) |
| Platform super admin | `admin@alias.local` | `AliasAdmin#2026!` | `/admin`                            |

The command is idempotent and refuses to run when `NODE_ENV=production`. These are local test
credentials only. The three systems themselves run as separate apps; see `systems/README.md`.

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

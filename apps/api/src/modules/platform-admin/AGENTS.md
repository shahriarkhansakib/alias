# AGENTS.md — modules/platform-admin

The platform control plane. Read `apps/api/AGENTS.md` first.

## What it does

Lets platform administrators see platform status and the admin roster, lets the `super_admin`
add `platform_admin` users and switch the platform-wide 2FA requirement, and provides the CLI that
creates the first `super_admin`.

## How it works

The module has `domain/`, `application/` and `http/` but **no `infrastructure/`**: it owns no
tables. It works through ports from `authz` (`AuthorizationRepositoryPort`, `AuditLogPort`) and
`authn` (`AuthUserLookupPort`), passed in by `createPlatformAdminModule(deps)` in `index.ts`, plus
`UnitOfWork` from `shared/ports.ts`.

**Use cases** (`application/`, each a `create<Action>UseCase(deps)` factory):

| Use case | What it does |
| --- | --- |
| `createGetPlatformStatusUseCase` | Active admin count, current 2FA policy, the calling admin. |
| `createListPlatformAdminsUseCase` | Role assignments joined with user records. |
| `createProvisionPlatformAdminUseCase` | Makes a verified, registered user a `platform_admin` in one transaction with a success audit row. |
| `createUpdatePlatformSecuritySettingsUseCase` | Upserts `require_platform_mfa` and appends `platform.security.mfa_policy_updated` in one transaction. Refuses to turn the policy on if the caller has no 2FA (409 `MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT`). |
| `createBootstrapSuperAdminUseCase` | Makes the first `super_admin` under a Postgres advisory lock. Idempotent for the same user; rejects a second `super_admin`. |

**Rejection auditing.** `application/audit-rejection.ts` (`AuditRejectedError`,
`runWithRejectionAudit`): a use case throws `AuditRejectedError` inside the transaction; after the
rollback, the rejection audit row is written outside it, so failed attempts are still recorded.

**Endpoints** (`http/routes.ts`; all need `requireAuth` and a platform permission, checked by
`authz`'s `assertPlatformAccess`):

| Route | Permission |
| --- | --- |
| `GET /api/v1/platform/status` | `platform:status:read` |
| `GET /api/v1/platform/admins` | `platform:status:read` |
| `POST /api/v1/platform/admins` | `platform:admins:manage`, and the role hierarchy (`canManagePlatformRole`) |
| `PATCH /api/v1/platform/security-settings` | `platform:admins:manage` |

Only `super_admin` holds `platform:admins:manage`. The provision request accepts only
`roleKey: 'platform_admin'` (`ProvisionPlatformAdminRequestSchema`).

**CLI.** `pnpm bootstrap:admin -- --email <verified-user-email>` runs
`src/scripts/bootstrap-admin.ts`, which calls `createBootstrapSuperAdminUseCase`.

**Audit actions:** `platform.admin.provision.succeeded` / `.rejected`,
`platform.super_admin.bootstrap.succeeded` / `.idempotent` / `.rejected`,
`platform.security.mfa_policy_updated`.

## Why

- No tables of its own: roles and settings belong to `authz`, users to `authn`. This module only
  orchestrates them.
- Every change and every rejected attempt leaves an audit row.
- The advisory lock and the "single active `super_admin`" unique index stop two bootstraps from
  racing.
- Turning the 2FA policy on requires the caller's own 2FA, so the `super_admin` cannot lock
  themselves out. See [ADR 0001](../../../../../docs/adr/0001-platform-2fa-policy.md).

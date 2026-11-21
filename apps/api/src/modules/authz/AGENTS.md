# AGENTS.md — modules/authz

Authorization: what the caller may do. Read `apps/api/AGENTS.md` first. This module has all four
layers and is the template for new modules.

## What it does

Decides whether a signed-in user acts as a customer (`principalType: 'user'`) or a platform
administrator (`principalType: 'admin'`), which platform permissions they hold, and whether the
platform 2FA policy applies to them. Stores roles, permissions, role assignments, the platform
security settings and the audit log.

## How it works

**Wiring.** `index.ts` exports `createAuthzInfrastructure(db, { defaultRequirePlatformMfa })`,
which returns `authorizationRepository`, `auditLogRepository` and `authorizationEngine`. It also
exports the middleware factories, `createAccessContextRouter`, `canManagePlatformRole` and the
domain types.

**Domain** (`domain/policies.ts`, pure functions):

- `resolveAccessContext`: an active role assignment makes the user an admin; `mfaRequired` is true
  when the policy is on and the admin has no 2FA.
- `assertCustomerAccess`: platform admins may not use customer resources
  (403 `PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED`).
- `assertPlatformAccess`: requires an active admin, a verified email (`USER_NOT_VERIFIED`), 2FA
  when the policy is on (`PLATFORM_MFA_REQUIRED`), and the required permission.
- `canManagePlatformRole`: an actor may manage only roles ranked below their own
  (`super_admin` 100 > `platform_admin` 50).

**Application.** `createAuthorizationEngine(repository, options)` (`AuthorizationEnginePort`):
`isPlatformMfaRequired` (the stored setting, or `defaultRequirePlatformMfa` when no row exists),
`resolveAccessState`, `resolveAccessContext`, `authorize`, `requireCustomerAccess`,
`requirePlatformAccess`.

**Ports** (`domain/ports.ts`): `AuthorizationRepositoryPort`, `AuditLogPort` (`append(entry, tx?)`),
`AuthorizationEnginePort`. Repository methods accept an optional `TransactionContext` so callers can
run them inside `UnitOfWork`.

**Tables** (`infrastructure/schema.ts`):

| Table | Holds |
| --- | --- |
| `roles` | `super_admin`, `platform_admin` with `hierarchy_rank`. Seeded by `src/db/seed-roles.ts` during `pnpm db:migrate`. |
| `role_permissions` | `platform:status:read` (both roles), `platform:admins:manage` (`super_admin` only). |
| `platform_role_assignments` | One active assignment per user; at most one active `super_admin` (partial unique indexes). |
| `platform_security_settings` | Single row `id = 'default'` with `require_platform_mfa`. |
| `audit_logs` | `actor_user_id`, `actor_type`, `action`, `outcome` (`success` / `rejected` / `noop`), `target_type`, `target_id`, `request_id`, `metadata`. |

**Endpoints**

| Route | Guard | Purpose |
| --- | --- | --- |
| `GET /api/v1/access-context` | `requireAuth` | Principal type, role and MFA state (`AccessContextResponseSchema`). |
| `GET /api/v1/customer/workspace` | `requireAuth`, `requireCustomerAccess` | Customer workspace shell; 403 for platform admins. |

**Middleware** (built in `src/app.ts` and passed to routers):
`createRequireCustomerAccessMiddleware(engine)` and
`createRequirePlatformPermissionMiddleware(engine, permission)`. Both must run after `requireAuth`
(they read `c.get('auth')`, else 401) and set `c.get('accessContext')` for the route.

## Why

- Authorization is decided on the server from Postgres, never from the web app.
- The 2FA policy is a stored setting with an environment-aware default: when no row exists, it is
  off in `development` and on in `test` and `production` (`src/app.ts` passes
  `nodeEnv !== 'development'`). See [ADR 0001](../../../../../docs/adr/0001-platform-2fa-policy.md).

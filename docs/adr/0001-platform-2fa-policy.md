# ADR 0001: Environment-Aware Platform 2FA Policy & Super Admin Toggle

## Status

Accepted

## Context

In the initial scaffold, platform administrators (`super_admin` and `platform_admin`) were always blocked by a hardcoded `mfaEnabled === true` requirement before accessing `/admin` or `/api/v1/platform/*`. While strict MFA enforcement is mandatory for production security, requiring TOTP enrollment immediately after every local database reset introduces unnecessary friction during local development unless intentionally enabled.

At the same time, authentication (`modules/authn` / Better Auth) and authorization (`modules/authz`) must remain strictly separated: Better Auth manages TOTP enrollment (`twoFactor` plugin) and credential verification, whereas authorization policies belong in `AuthorizationEngine` backed by PostgreSQL.

## Decision

1. **Singleton Policy Table (`platform_security_settings`):**
   - Persist the platform-wide toggle in `platform_security_settings` (`id = 'default'`, `require_platform_mfa`, `updated_by_user_id` FK to `user(id)`, `updated_at`) inside `modules/authz`.
2. **Environment-Aware Default (`NODE_ENV !== 'development'`):**
   - When no row exists in `platform_security_settings`, `AuthorizationEngine.isPlatformMfaRequired()` defaults to `false` in `development` and `true` in `production` and `test`.
   - `resolveAccessContext()` returns both `requirePlatformMfa` (the effective policy) and `mfaRequired` (`requirePlatformMfa && !identity.mfaEnabled` for platform admins; always `false` for regular customer users).
3. **Guarded `super_admin` Endpoint (`PATCH /api/v1/platform/security-settings`):**
   - Restricted to `platform:admins:manage` (`super_admin` only; `platform_admin` receives `403 FORBIDDEN`).
   - Blocks turning enforcement **ON** if the calling `super_admin` has not enabled personal 2FA (`409 MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT`) to prevent self-lockout.
   - Atomically upserts `platform_security_settings` and appends a `platform.security.mfa_policy_updated` audit log entry (`previousRequirePlatformMfa`, `nextRequirePlatformMfa`) in a single `UnitOfWork` transaction.
4. **In-Console Personal 2FA Controls (`/admin`):**
   - Platform admins can enroll/verify TOTP directly inside `/admin` even when the policy is OFF, and may only disable personal 2FA while `requirePlatformMfa === false`.

## Consequences

- Fresh `development` databases allow immediate `/admin` access after `bootstrap:admin` while surfacing a clear warning banner and personal 2FA setup controls.
- `production` and `test` environments remain fail-closed (`requirePlatformMfa = true`) out of the box.
- Policy changes are reversible only by an authenticated (and MFA-verified when ON) `super_admin` and leave an immutable audit trail.

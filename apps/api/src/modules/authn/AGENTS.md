# AGENTS.md — modules/authn

Authentication: who the caller is. Read `apps/api/AGENTS.md` first.

## What it does

Wraps Better Auth to provide sign-up and sign-in with email and password, email verification,
password reset, optional Google sign-in, TOTP two-factor authentication and database-backed rate
limiting. Turns a session cookie into an `AuthenticatedIdentity` for the rest of the API. It decides
nothing about permissions; that is `authz`.

## How it works

**Wiring.** `index.ts` exports `createAuthnInfrastructure(config)`, which builds Better Auth
(`infrastructure/better-auth.ts`) and returns:

- `sessionResolver` (`SessionResolverPort`): reads the session from request headers via
  `auth.api.getSession` and maps it to `AuthenticatedIdentity` (`userId`, `sessionId`, `email`,
  `name`, `emailVerified`, `mfaEnabled`).
- `userLookup` (`AuthUserLookupPort`): `findByEmail` and `findByIds` over the `user` table, used by
  `platform-admin`.
- `handleAuthRequest`: Better Auth's request handler.

It also exports `createRequireAuthMiddleware(sessionResolver)` and `createAuthRouter(deps)`.

**Use cases.** `application/get-current-user.ts` (`getCurrentUserProfile`) shapes the `/me`
response. All other auth flows are Better Auth's own.

**Ports** (`domain/ports.ts`): `SessionResolverPort`, `AuthUserLookupPort`.

**Tables** (`infrastructure/schema.ts`, Better Auth's model): `user` (with `two_factor_enabled`),
`session`, `account`, `verification`, `two_factor`, `rate_limit`. IDs come from `generateId()`
(UUIDv7).

**Endpoints**

| Route | Guard | Purpose |
| --- | --- | --- |
| `GET/POST/PUT/PATCH/DELETE/OPTIONS /api/auth/*` | Better Auth | All Better Auth flows (sign-up, sign-in, verify, reset, 2FA, Google). |
| `GET /api/v1/me` | `requireAuth` | Current user (`MeResponseSchema`). |

`requireAuth` (built in `src/app.ts` from `createRequireAuthMiddleware`) returns 401 without a
valid session and sets `c.get('auth')`. The header `x-alias-disable-refresh: true` reads the
session without refreshing it.

**Configuration** (from `shared/env.ts`): email verification is required to sign in; reset emails
and verification emails go through `MailerPort`; Google sign-in is on only when both Google client
variables are set; rate limiting (100 requests per 60 s, stored in `rate_limit`) is on when
`AUTH_RATE_LIMIT_ENABLED` is true; cookies are `httpOnly`, `sameSite=lax`, and `secure` in
production.

**Permissions.** None. Every signed-in user passes `requireAuth`.

**Known exception.** `src/scripts/bootstrap-admin.ts` imports
`infrastructure/user-lookup-repository.ts` directly instead of going through `index.ts` (ESLint
does not check `src/scripts/`).

## Why

- Authentication and authorization are kept apart: `authn` must never import `authz` or
  `platform-admin` (enforced by `pnpm lint:arch`). Better Auth owns credentials and TOTP enrollment;
  policies such as "platform admins need 2FA" live in `authz`. See
  [ADR 0001](../../../../../docs/adr/0001-platform-2fa-policy.md).
- Other modules see only the ports (`SessionResolverPort`, `AuthUserLookupPort`), never Better
  Auth itself.

---
name: api-test-suite
description: Write or extend Vitest tests for the API organised into happy paths, edge cases and error cases. Use whenever adding or changing an endpoint, use case or domain rule.
---

# API test suite

## Where tests go

- **Unit tests** (`*.unit.test.ts`) sit next to the code they test, for domain rules and use cases.
  No database: fake the ports. Examples: `modules/authz/domain/policies.unit.test.ts`,
  `modules/authz/application/authorization-engine.unit.test.ts`, `shared/id.unit.test.ts`.
- **Integration tests** (`*.integration.test.ts`) live in `apps/api/src/test/`. They build the
  real app with `createApiApp` from `src/app.ts` and call it over HTTP against real Postgres
  (`docker compose up -d --wait`, then `pnpm db:migrate`). They reset the local database first.
  Read `apps/api/src/test/auth-platform.integration.test.ts` and the helpers next to it
  (`totp.ts`) before writing new helpers.

## Shape of every new or changed suite

```ts
import { describe, expect, it } from 'vitest';

describe('<unit under test>', () => {
  describe('happy paths', () => {
    // the intended use, one test per distinct successful outcome
  });
  describe('edge cases', () => {
    // empty input, limits, Unicode and Bangla text, duplicates, concurrency, ordering, time zones
  });
  describe('error cases', () => {
    // invalid input (400), unauthenticated (401), forbidden role (403),
    // not found (404), conflicts (409), upstream failure
  });
});
```

Suites written before this rule do not have these sections yet. They are known exceptions: when
you change one, move its tests into the three sections in the same pull request.

## Checklist

- Every endpoint: one test per role that may call it and one per role that may not
  (customer user, `platform_admin`, `super_admin`, unauthenticated).
- Planned: once tenancy exists, a user from organisation A can never read or change organisation
  B's data. There is no tenant concept yet.
- Writes: assert the database state and the `audit_logs` row, not just the response.
- Errors: assert `error.code` from the shared error envelope (`ApiErrorEnvelopeSchema`), not
  only the status.
- Test names read as sentences: `it('rejects provisioning by a platform_admin')`.
- Run `pnpm --filter @alias/api test:unit` and `pnpm --filter @alias/api test:integration`;
  report real results.

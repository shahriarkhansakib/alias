---
name: api-test-suite
description: Write or extend Vitest tests for the API organised into happy paths, edge cases and error cases. Use whenever adding or changing an endpoint, use case or domain rule.
---

# API test suite

## Where tests go

- `*.unit.test.ts` next to the code for domain rules and use cases (no database, ports faked).
- `*.integration.test.ts` for HTTP routes against real Postgres (`docker compose up -d --wait`).
  Look at `apps/api/src/test/` for the existing helpers before writing new ones.

## Shape of every suite

```ts
describe('<unit under test>', () => {
  describe('happy paths', () => {
    // the intended use, one test per distinct successful outcome
  });
  describe('edge cases', () => {
    // empty input, limits, Unicode and Bangla text, duplicates, concurrency, ordering, time zones
  });
  describe('error cases', () => {
    // invalid input (400), unauthenticated (401), forbidden role or tenant (403),
    // not found (404), conflicts (409), upstream failure
  });
});
```

## Checklist

- Every endpoint: one test per role that may call it and one per role that may not.
- Tenant isolation: a user from organisation A can never read or change organisation B's data.
- Writes: assert the database state and the audit log row, not just the response.
- Errors: assert the error code from the shared error shape, not only the status.
- Test names read as sentences: `it('rejects a brief approval from a client user')`.
- Run `pnpm --filter @alias/api test:unit` and `test:integration`; report real results.

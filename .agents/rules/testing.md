---
trigger: glob
globs: "**/*.test.ts, **/*.spec.ts, apps/web/e2e/**"
description: "How tests are structured in this repository."
---

# Testing conventions

- File names: `*.unit.test.ts` (no I/O) and `*.integration.test.ts` (real Postgres via
  `docker compose`). Playwright end-to-end tests live in `apps/web/e2e/`.
- Every suite has three top-level sections, in this order:
  `describe('happy paths')`, `describe('edge cases')`, `describe('error cases')`.
- Happy paths: the intended use. Edge cases: empty, limits, Unicode and Bangla text, duplicates,
  concurrency, time zones. Error cases: invalid input, unauthenticated, forbidden (wrong role or
  wrong tenant), missing records, upstream failures.
- Every endpoint gets at least one test per role that can and cannot call it.
- Assert on behaviour (status, body, database state, audit rows), not on implementation details.
- Never mock the database in integration tests. Never call real third-party APIs in tests.

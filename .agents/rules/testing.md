---
trigger: glob
globs:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "apps/web/e2e/**"
  - "scripts/**/*.test.mjs"
description: "How tests are structured in this repository."
---

# Testing conventions

- Where tests live:
  - API unit tests: `*.unit.test.ts` next to the code (no I/O; ports faked).
  - API integration tests: `apps/api/src/test/*.integration.test.ts`, against real Postgres
    (`docker compose up -d --wait`, then `pnpm db:migrate`). They reset the local database.
  - Playwright end-to-end tests: `apps/web/e2e/*.spec.ts`, helpers in `apps/web/e2e/helpers/`.
  - Repo scripts: `scripts/*.test.mjs` (`pnpm test:scripts`).
- **New or changed suites** have three top-level sections, in this order: happy paths, edge cases,
  error cases.
  - Vitest: `describe('happy paths')`, `describe('edge cases')`, `describe('error cases')`.
  - Playwright: `test.describe('happy paths')`, `test.describe('edge cases')`,
    `test.describe('error cases')`.
- Existing suites written before this rule are known exceptions (the four API suites and the two
  Playwright specs). Move a suite to the three sections when you change it.
- Happy paths: the intended use. Edge cases: empty, limits, Unicode and Bangla text, duplicates,
  concurrency, time zones. Error cases: invalid input, unauthenticated, forbidden (wrong role),
  missing records, upstream failures.
- Every endpoint gets at least one test per role that can and cannot call it.
- Assert on behaviour (status, body, database state, audit rows), not on implementation details.
- Never mock the database in integration tests. Never call real third-party APIs in tests.

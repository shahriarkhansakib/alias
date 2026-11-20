---
name: pre-pr-check
description: Run every check the CI runs, in the CI's order, then confirm the diff is safe to commit and push to phase-zero. Use before saying a task is finished, before committing, and before pushing.
---

# Pre-PR check

## 1. Run the CI steps

These are the steps of `.github/workflows/ci.yml`, in the same order. If CI changes, follow
`ci.yml`, and update this list. Run them from the repository root and report each result
honestly, including failures. Stop at the first failure, fix it, and start again.

Steps 8, 9 and 12 need the local services: `docker compose up -d --wait` (Postgres 18 + Mailpit).

| # | CI step | Command |
| --- | --- | --- |
| 1 | Install dependencies | `pnpm install --frozen-lockfile` |
| 2 | Check formatting | `pnpm format:check` (fix with `pnpm format`) |
| 3 | Lint with Biome | `pnpm lint:biome` |
| 4 | Lint architectural boundaries | `pnpm lint:arch` |
| 5 | Check agent config is in sync | `pnpm agents:check` (if it fails, run `pnpm agents:sync` and commit the result) |
| 6 | Typecheck | `pnpm typecheck` |
| 7 | Run unit tests | `pnpm test:unit` |
| 8 | Run database migrations | `pnpm db:migrate` |
| 9 | Run PostgreSQL integration tests | `pnpm test:integration` (resets the local database) |
| 10 | Build packages and apps | `pnpm build` |
| 11 | Install Playwright Chromium | `pnpm --filter @alias/web exec playwright install chromium` (once per machine; CI adds `--with-deps`) |
| 12 | Run Playwright E2E tests | `pnpm test:e2e` |

Not in CI yet: if you changed `scripts/`, also run `pnpm test:scripts`.

## 2. Confirm before committing

- You are on `phase-zero`, never `main`.
- Every changed module's `AGENTS.md` still describes what the code does.
- New or changed test suites use happy / edge / error sections.
- `git diff --staged` contains no `.env` file, no `.env` content, no secret, key, token or
  password, and no personal data. Never open a `.env` file to check; check the diff.
- The commit is small, covers one concern, and has a conventional message
  (`feat(intake): add message history endpoint`).

## 3. Before pushing

Agents may push to `phase-zero` only when steps 1 and 2 passed for every commit being pushed.
Never push to `main`, never force-push, never rewrite pushed history (no rebase, amend or reset of
pushed commits), and never merge pull requests. Only the owner merges.

All Phase 0 work goes into one draft pull request from `phase-zero` into `main`. When you report
the work, include: **What** (one paragraph), **Why**, **How to test** (exact commands or clicks),
**Risks** (migrations, breaking contract changes), and the check results from step 1.

---
name: pre-pr-check
description: Run every check the CI runs and prepare a pull request description. Use before saying a task is finished or before opening a pull request.
---

# Pre-PR check

Run these from the repository root and report each result honestly:

1. `pnpm format:check` (fix with `pnpm format`)
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test` (needs `docker compose up -d --wait`)
5. `pnpm agents:check` — if it fails, run `pnpm agents:sync` and commit the result.
6. If you touched `apps/web`: `pnpm test:e2e`.

Then confirm:

- The branch is not `main`.
- Every changed module's `AGENTS.md` still describes what the code does.
- No `.env` file, secret or personal data is in the diff (`git diff --staged`).
- New behaviour has tests in happy / edge / error sections.

Write the pull request description with: **What** (one paragraph), **Why**, **How to test**
(exact commands or clicks), **Risks** (migrations, breaking contract changes), and the check results.

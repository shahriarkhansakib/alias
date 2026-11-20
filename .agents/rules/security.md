---
trigger: always_on
description: "Secrets, environment files and destructive commands."
---

# Security

- Never read, print, copy or commit `.env`, `.env.local`, `.env.*.local` or any file holding secrets.
  Learn which variables exist from `.env.example`.
- Never hard-code keys, tokens, passwords or connection strings in code, tests, fixtures or logs.
  Read them from the environment through the existing config loader.
- Never log personal data (emails, phone numbers, chat content) at `info` level or above.
- Ask before running anything destructive or irreversible: `pnpm db:reset`, dropping tables,
  `rm -rf`, `git push --force`, deleting branches, or any command against a non-local database.
- Never weaken authentication, authorization, rate limiting or 2FA to make a test pass.

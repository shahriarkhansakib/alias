---
trigger: glob
globs: "apps/web/**"
description: "Next.js web app conventions."
---

# Web app conventions

- Never import from `apps/api`; shared types come only from `@alias/contracts`.
- Call the backend through the same-origin `/api/*` proxy; never hard-code the API's address.
- Only `NEXT_PUBLIC_*` variables may reach client components; never pass secrets to the browser.
- Page-level role checks improve the experience, but the API is the authority on permissions.
- Layout guideline: leave room for longer text (planned Bangla translations); avoid fixed widths
  and layouts that only fit short English strings. There is no i18n mechanism yet, so do not
  invent one; strings are plain English for now.
- Interactive elements are keyboard-reachable and have accessible names.

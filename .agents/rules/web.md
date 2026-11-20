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
- Text must work in Bangla and English; avoid layouts that assume short English strings.
- Interactive elements are keyboard-reachable and have accessible names.

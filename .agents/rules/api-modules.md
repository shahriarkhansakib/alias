---
trigger: glob
globs: "apps/api/src/modules/**"
description: "Layering and conventions for API modules."
---

# API module conventions

- Layers: `domain/` ← `application/` ← `infrastructure/` and `http/`. Inner layers never import outer
  ones; `pnpm lint:arch` enforces this.
- `domain/` is pure TypeScript: no Hono, Drizzle, `pg`, Better Auth, nodemailer or pino.
- `application/` exports factories named `create<Action>UseCase(deps)` that receive their ports
  (repositories, unit of work, audit log) as arguments. No framework imports.
- `infrastructure/` implements the ports (Drizzle repositories, `schema.ts`, external adapters).
- `http/routes.ts` parses input with `@alias/contracts` schemas, calls a use case, maps the result.
  No business rules in routes.
- Other modules import only from the module's `index.ts`.
- Local imports use the `.js` extension (`./application/foo.js`), as the rest of the codebase does.
- Writes that matter (approvals, role or policy changes) run inside `UnitOfWork` and append an audit
  log entry in the same transaction.
- When a module's behaviour changes, update its `AGENTS.md` in the same pull request.

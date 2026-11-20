---
trigger: glob
globs: "apps/api/src/db/**, apps/api/drizzle/**, **/infrastructure/schema.ts"
description: "Database schema and migration rules."
---

# Database rules

- Schema changes go through Drizzle: edit `schema.ts`, run `pnpm db:generate`, review the SQL,
  commit both. Use the `db-migration` skill.
- Never edit or delete a migration that has been merged to `main`; add a new one instead.
- Migrations are forward-only and must be safe on a database that already has data.
- Customer-owned tables carry the tenant id and index it; queries always filter by it.
- Store money as integer minor units plus a currency code, never floats.
- New tables use the shared UUIDv7 generator (`apps/api/src/shared/id.ts`) (`generateId()`) for primary keys.

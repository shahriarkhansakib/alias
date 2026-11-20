---
name: db-migration
description: Change the PostgreSQL schema safely with Drizzle (edit schema.ts, generate SQL, review, migrate, test). Use for any new table, column, index or constraint.
---

# Database migration

1. Edit the owning module's `infrastructure/schema.ts`. If you add a table, export it from
   `apps/api/src/db/schema.ts`.
2. Follow the database rules: tenant id on customer-owned tables, `generateId()` primary keys,
   integer money, indexes for every foreign key and every column you filter on.
3. Run `pnpm db:generate`. Open the new file in `apps/api/drizzle/` and read the SQL:
   - Is it forward-only and safe on a table that already has rows?
   - Does adding a `NOT NULL` column provide a default or a backfill?
   - Will it lock a large table for long?
4. Never edit a migration already merged to `main`. If the generated SQL is wrong, fix `schema.ts`
   and regenerate before merging.
5. Run `pnpm db:migrate` locally, then the integration tests.
6. Describe the migration and its risk in the pull request.

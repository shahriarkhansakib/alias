---
trigger: glob
globs: "packages/contracts/**"
description: "Rules for shared Zod contracts."
---

# Contract rules

- Only `zod` as a dependency; no I/O, framework imports or business logic.
- Name the schema `<Name>Schema` and export its inferred type as `<Name>`:
  `export const MeResponseSchema = z.object(...)` then
  `export type MeResponse = z.infer<typeof MeResponseSchema>`.
- Re-export new files from `src/index.ts`; consumers import from `@alias/contracts`.
- From now on: `.describe()` on every non-obvious field (existing schemas have none yet).
- From now on: contracts between systems are versioned (`CampaignBriefV1Schema`); a breaking
  change adds a new version. None exist yet.
- A contract change updates every producer, consumer and their tests in the same pull request.

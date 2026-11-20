# AGENTS.md — packages/contracts

Pure Zod v4 schemas and the TypeScript types inferred from them. Read the root `AGENTS.md` first.

## What it does

Defines the shape of every object that crosses a boundary: web ↔ API today, and API ↔ creative
service (Python) and between systems (brief, budget plan, creative, publish request, performance
report) as the product grows. If two parts of the system exchange it, its schema lives here.

## Rules

- No runtime dependencies other than `zod`. No I/O, no framework imports, no business logic.
- Export the schema and its inferred type together: `export const X = z.object(...)`,
  `export type X = z.infer<typeof X>`.
- Cross-system contracts are **versioned** (`CampaignBriefV1`). A breaking change adds a new version;
  never change an existing version's meaning.
- Every field has a clear name and, where not obvious, a `.describe()` explaining it.
- Changing a contract means updating every producer and consumer in the same pull request, and their
  tests.

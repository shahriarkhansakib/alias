# AGENTS.md — packages/contracts

Pure Zod v4 schemas and the TypeScript types inferred from them. Read the root `AGENTS.md` first.

## What it does

Defines the shape of every object that crosses the web ↔ API boundary today: auth (`auth.ts`),
access context (`access.ts`), customer workspace (`customer.ts`), platform admin (`platform.ts`),
errors (`errors.ts`), health (`health.ts`) and pagination (`pagination.ts`), all re-exported from
`src/index.ts`. Planned: contracts between systems (brief, budget plan, creative, publish request,
performance report) and with the Python creative service. If two parts of the system exchange it,
its schema lives here.

## Rules

- No runtime dependencies other than `zod`. No I/O, no framework imports, no business logic
  (`pnpm lint:arch` rejects any other import).
- Name the schema `<Name>Schema` and export its inferred type as `<Name>` right after it:

  ```ts
  export const PlatformAdminItemSchema = z.object({ ... });
  export type PlatformAdminItem = z.infer<typeof PlatformAdminItemSchema>;
  ```

- Endpoint bodies are usually named `<Action>RequestSchema` / `<Action>ResponseSchema`
  (`ProvisionPlatformAdminRequestSchema`, `MeResponseSchema`). Errors use `ApiErrorEnvelopeSchema`.
- Re-export every new file from `src/index.ts`. Consumers import from `@alias/contracts` only.
- From now on, give every field whose meaning is not obvious a `.describe()` explaining it. Existing
  schemas do not use `.describe()` yet; add it when you touch a field.
- From now on, contracts between systems are **versioned** (`CampaignBriefV1Schema` /
  `CampaignBriefV1`). A breaking change adds a new version; never change an existing version's
  meaning. No versioned contracts exist yet; the web ↔ API contracts above are not versioned.
- Changing a contract means updating every producer and consumer in the same pull request, and their
  tests.

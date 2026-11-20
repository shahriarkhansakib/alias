---
trigger: glob
globs: "packages/contracts/**"
description: "Rules for shared Zod contracts."
---

# Contract rules

- Only `zod` as a dependency; no I/O, framework imports or business logic.
- Export each schema with its inferred type under the same name.
- Cross-system contracts are versioned (`CampaignBriefV1`); breaking changes add a new version.
- A contract change updates every producer, consumer and their tests in the same pull request.

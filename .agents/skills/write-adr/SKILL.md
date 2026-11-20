---
name: write-adr
description: Record an architecture decision as a numbered ADR in docs/adr. Use when choosing or changing a technology, a module boundary, a data ownership rule or a security policy.
---

# Write an ADR

1. List `docs/adr/` and take the next number (`0002`, `0003`, …).
2. Create `docs/adr/<number>-<short-kebab-title>.md` with these sections, matching
   `0001-platform-2fa-policy.md`:
   - **Status**: Proposed, Accepted, or Superseded by ADR-xxxx.
   - **Context**: the problem and constraints, with facts, not opinions.
   - **Options considered**: each with its main pro and con.
   - **Decision**: what we chose, stated plainly.
   - **Consequences**: what gets easier, what gets harder, what we must now do.
3. Keep it to about one page. Link it from the affected module's `AGENTS.md`.
4. To reverse a decision, write a new ADR that supersedes the old one and update the old one's
   status. Never rewrite history.

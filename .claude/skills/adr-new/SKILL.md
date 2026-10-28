---
name: adr-new
description: Create a new Architecture Decision Record as Proposed from the template. Use when a design choice needs a written decision for the author to accept.
---

# adr-new

Claude only ever writes `Proposed` ADRs. The author decides.

1. List `docs/adr/`. The next number is the highest `NNNN` (ignoring `0000`) plus one, zero-padded to four digits.
2. Pick a kebab-case slug from the title. Copy the template instead of retyping it:
   `cp docs/adr/0000-template.md docs/adr/NNNN-slug.md`
3. Edit the copy:
   - heading `# ADR-NNNN: <Title>`
   - `- **Status:** Proposed`
   - `- **Date:** <today, YYYY-MM-DD>`
   - fill Context, Options, Decision (state it as a recommendation), Consequences, Evidence.
4. Evidence cites ids from `docs/research/` (`S###`, `A###`) and nothing uncited. Public-facing numbers need `main-reread` sources.
5. Leave the `## Decider's note` heading and the placeholder line under it exactly as the template has them. Never write in it, never set the status to `Accepted`.
6. Run `uv run --frozen python scripts/check_docs.py --all` and fix every FAIL.
7. Tell the author which ADR is waiting for a decision (file path and one-line question).

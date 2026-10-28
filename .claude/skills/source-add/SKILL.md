---
name: source-add
description: Add one source to docs/research/sources.yaml with every field and an honest verification level. Use when a claim or number needs a citable source id.
---

# source-add

1. Read `docs/research/sources.yaml`. The next id is the highest `S###` plus one.
2. Append exactly one entry under `sources:` with all fields:
   `id`, `title`, `publisher`, `url`, `accessed` (today, YYYY-MM-DD), `type`, `supports` (the claim it backs, one line), `verification`, `used_in` (list of files, `[]` if none yet).
3. `verification` is `snippet` unless the page was actually opened and read:
   - `snippet`: only a search result or abstract was seen.
   - `agent-read`: a subagent opened and read the page.
   - `main-reread`: the main session re-read the relevant passage itself after an agent read it.
   Never raise the level without doing the reading. Public numbers use `main-reread` only.
4. A text snapshot of the page, if wanted, goes under `docs/private/snapshots/` only (gitignored). Never copy it into a tracked file.
5. Run `uv run --frozen python scripts/check_docs.py --all` and fix every FAIL.
6. Report the new id, its verification level and what it still needs to become `main-reread`.

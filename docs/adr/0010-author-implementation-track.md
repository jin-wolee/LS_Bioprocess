# ADR-0010: The author's implementation track and user-owned file protection
- **Status:** Proposed
- **Date:** 2026-10-28

## Context

Most of the repository is built with AI assistance, and the project says so. The portfolio value, however, depends on parts the author can build, explain and defend without help. Three artefacts sit at the centre of the data-management story: the canonical schema, the core SQL queries and a reference implementation of the simulation's core loop.

## Options

1. **The author writes three artefacts; AI writes specifications, fixtures, acceptance tests and reviews.** The artefacts are the canonical DDL (`sql/schema.sql`), three SQL queries (`sql/queries/*.sql`: an as-of window join of results to process context, a recursive lineage query, and a bridging correction) and the SimPy core loop (`reference/sim_core.py`). These paths are listed in `.claude/user_owned.txt`; an edit guard blocks AI writes there, and reviews go to `docs/user_track/reviews/`.
   - Pro: the author owns and can explain the core; the boundary is real and checkable; AI reviewers can only point out problems and ask questions.
   - Con: schedule risk and a learning cost (recursive CTEs and as-of joins take practice); the AI path has to proceed without waiting.
2. **AI writes everything; the author reviews.**
   - Pro: fastest.
   - Con: the author's contribution becomes review only, which does not support the claims the project wants to make about the author's own work.
3. **The author writes all code.**
   - Pro: unambiguous authorship.
   - Con: very slow, and it gives up the AI-assisted workflow the project is also demonstrating.
4. **Pair-write the same files with commit trailers.**
   - Pro: flexible.
   - Con: blurs exactly the boundary this record is meant to keep.

## Decision

Proposed: option 1, with these rules.

- AI must not write or modify any file listed in `.claude/user_owned.txt`, and must not route around the edit guard with `bash`, `cp`, `sed` or heredocs.
- The two build paths have separate gates. The AI path is judged by invariants, hand-calculated fixtures and an M/M/c-only mode (ADR-0003). The author path has its own non-blocking gates: SimPy parity and DDL acceptance (`pytest -m user_track`) in session S1, and SQL results equal to fixture answers in S2. A late author artefact never blocks the AI path.
- The specifications the author implements are `docs/design/data_model.md` and `docs/design/simulation_spec.md`. Acceptance tests live in `tests/user_track/`.
- Before any public claim about authorship, the author runs and explains a private short script unaided (session S5).

## Consequences

- Positive: a defensible boundary between the author's work and AI-built parts; learning is part of the plan, not an afterthought.
- Negative: SimPy parity and SQL checks may lag the TypeScript engine; until they exist, parity is unproven, and documents must not say it is.
- The README and any resume wording follow the boundary as recorded here; nothing claims more than the commit history shows.

## Evidence

- `prompts/00_master_build.md` (sections 3, 11 and 12), `.claude/user_owned.txt`, `CLAUDE.md` (invariant 5).
- No domain number is involved.

## Author statement (verbatim, if any)

> Chose "DDL·SQL 3종·Python 기준 구현 핵심" (chat, 2026-10-28)

## Decider's note

_(author only — Claude never writes here)_

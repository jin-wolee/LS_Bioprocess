# ADR-0022: The author's implementation track written by AI, clean-room from the specification
- **Status:** Accepted
- **Date:** 2026-11-03
## Context

ADR-0010 (accepted 2026-10-29) reserves five files for the author: the canonical DDL (`reference/sql/schema.sql`), three SQL queries (`reference/sql/queries/asof_join.sql`, `lineage_recursive.sql`, `bridging_offset.sql`) and the SimPy core loop (`reference/simpy/sim_core.py`). They are listed in `.claude/user_owned.txt`, an edit guard keeps AI tools out of them, and their acceptance tests in `tests/user_track/` skip while the files are absent. None of the files exists yet, so the parity of an independent implementation with the TypeScript engine is unproven, and the README says so.

On 2026-11-03 the author asked for the files to be written by AI because there is no time to write them now. An external adversarial audit of 2026-11-02 named the absence of an independent second implementation as a gap, and named the author's own SQL and SimPy as the strongest evidence of technical ownership a portfolio could show. The two pull in different directions: the request closes the parity gap; it gives up the authorship claim of ADR-0010.

## Options

1. **Keep ADR-0010; the author writes the files later.**
   - Pro: the authorship claim stays possible.
   - Con: parity stays unproven until the author has the time; the request is declined.
2. **AI writes the five files clean-room from the specification, and every text says so.** An executor writes them from `docs/design/data_model.md`, `docs/design/simulation_spec.md`, the schemas, the hand fixtures and the existing acceptance tests only, without reading the TypeScript engine's source (`engine/src/`), so that a defect of the engine is not copied into the second implementation. The tests of `tests/user_track/` are not edited to make the files pass.
   - Pro: parity can be measured now; the second implementation is independent of the engine's code, if not of its author's model family.
   - Con: the files are not the author's; the README, the explainer and every authorship statement must say they were written by AI from the specification; ADR-0010's rule that a private unaided script precedes any authorship claim no longer has a subject for these files.
3. **AI writes a skeleton (tables, function signatures); the author fills the core.**
   - Pro: keeps part of the authorship.
   - Con: the parity still waits for the author; little time is saved.

## Decision

Proposed: option 2, chosen by the author in chat on 2026-11-03.

- The five files leave `.claude/user_owned.txt` once this record is accepted, and not before; the author edits that list, or tells the orchestrator to.
- The executor works clean-room: it may read the design documents, the schemas, `tests/fixtures/`, `tests/golden/parity/` and `tests/user_track/`, and must not read `engine/src/` or `src/`. The brief says so and the report names what was read.
- The tests of `tests/user_track/` stay as they are; a test that is wrong is reported to the author, not edited to pass.
- README, the explainer and the progress log say that the SQL and SimPy track was written by AI from the specification, clean-room from the engine's code, and that the author did not write it. Nothing claims more.
- ADR-0010 keeps its history and its rules for every other file; only its assignment of these five files to the author is superseded.

## Consequences

- Positive: the parity of a second implementation with the TypeScript engine and the SQL answers against the fixtures can be measured; a gap the audit named closes.
- Negative: the portfolio loses the claim that the author wrote the schema, the queries and the core loop; the second implementation shares the model family of the first, so it is independent of the engine's code but not of how the specification was read.
- The author can still write their own version later and replace these files; the acceptance tests would judge it the same way.

## Evidence

- ADR-0010 (the author's track and the edit guard), `.claude/user_owned.txt`, `tests/user_track/` (the acceptance tests, written by the AI path and not edited to make the author's code pass), the README's section on how the work is done.
- No domain number is involved.

## Author statement (verbatim, if any)

> "시간이 없어서 그런데 SQL·SimPy 도 너가 작성해줘." (chat, 2026-11-03); chose "AI가 작성, 클린룸 + 명시 (Recommended)" (chat, 2026-11-03)

## Decider's note
Decided by the author in chat on 2026-11-03: chose "AI가 작성, 클린룸 + 명시 (Recommended)", then "응 그렇게 하도록 해" to accepting this record and removing the five files from .claude/user_owned.txt.

# ADR-0007: Source and assumption ledgers; grades and verification levels
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

A simulator built from public sources and assumptions is only as honest as its bookkeeping. Readers need to see which numbers were measured by someone, which were borrowed from another domain, which were computed, and which are guesses. The research itself is partly done by AI agents, so the record also has to say how closely each source was checked.

## Options

1. **Two YAML ledgers with stable ids.** `docs/research/sources.yaml` holds sources (`S###`); `docs/research/assumptions.yaml` holds every parameter (`A###`) with default, range, unit, grade and sources. Documents cite by id; a script checks that every id exists.
   - Pro: machine-checkable; one place to correct a number; grades and verification levels are data, not prose.
   - Con: upkeep effort; ids are opaque to a casual reader unless the UI expands them.
2. **Inline citations and footnotes in each document.**
   - Pro: familiar.
   - Con: the same fact is cited in several places and drifts; no machine check; grades have nowhere to live.
3. **Reference manager export plus a prose assumptions table.**
   - Pro: standard tooling for citations.
   - Con: the assumptions table is still unchecked prose; parameter-level grading is awkward.
4. **A database or CSV.**
   - Pro: queryable.
   - Con: poor diffs and review; more machinery than the size warrants.

## Decision

Proposed: option 1.

- **Grades for parameters:** S (bioprocess primary source), P (proxy borrowed from another domain), D (derived by arithmetic from sourced numbers, with the arithmetic in the notes), A (assumption without a source). A profile bundle takes the grade of its weakest component. An observed value and the value the simulator applies are separate entries (for example A038 observed, A040 applied).
- **Verification levels for sources:** `snippet` (seen only as an excerpt or second-hand), `agent-read` (opened and read by the research executor), `main-reread` (re-read by the orchestrator, who searched the text for the quoted phrases). Public numbers in the README and the infographic may cite only `main-reread` sources; `scripts/check_docs.py` enforces that and also rejects unknown ids in other documents once the bootstrap marker exists.
- **Privacy:** raw AI research reports, review transcripts and plan copies stay in the gitignored `docs/private/`. Public files carry the ledgers and short dispositions, never the raw material.

## Consequences

- Positive: every public number can be traced to a source or flagged as assumed; stale or weak sources are visible by their verification level; reviewers can ask for a specific id.
- Negative: `main-reread` means the quoted text was found again, not that its interpretation is right; some useful figures stay provisional because their sources could not be re-opened as text; a reader cannot audit the private research process, only its ledger output.
- Design documents may cite sources below `main-reread` for context, but any figure from them is provisional until promoted.

## Evidence

- `docs/research/README.md` (grades, verification, working rules), `scripts/check_docs.py` (id and verification checks).
- Worked examples of the observed-versus-applied split: A038, A039, A040 (S012). Example of a weakest-part bundle grade: A070.

## Author statement (verbatim, if any)

_None recorded._

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".

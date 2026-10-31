# Architecture decision records

Each record states a context, at least two real options, a proposed decision, its consequences and the evidence behind it. `0000-template.md` is the format; the `adr-new` skill drafts new records from it.

## Rule: who writes what

- Claude writes records with status `Proposed` only. Claude never writes the decider's note and never sets another status.
- The author reads a record, writes the decider's note (in any language), flips the status, and commits that change personally, without a co-author trailer.
- Git history therefore separates human decisions (commits by the author, with a note) from AI drafts (commits carrying the AI trailer). The format check in `scripts/check_docs.py` verifies structure only; it is not proof of who decided what.
- Verbatim statements of the author that shaped a record are quoted in its "Author statement" section, with channel and date.

## Index

| Number | Title | Status |
|---|---|---|
| [0001](0001-generic-synthetic-scenario-public-sources.md) | Generic synthetic scenario, public sources only | Accepted |
| [0002](0002-adr-contribution-boundary.md) | Decision records mark the author's contribution boundary | Accepted |
| [0003](0003-stack-ts-engine-simpy-reference-duckdb.md) | Stack: TypeScript engine in a Web Worker, SimPy reference, DuckDB for SQL | Accepted |
| [0004](0004-truth-world-recorded-world-experiments.md) | Truth world versus recorded world, observation contract, experiments 1 and 2 | Accepted |
| [0005](0005-data-architecture-as-feature-flags.md) | Data architecture as feature flags; presets A, B and C | Accepted |
| [0006](0006-language-english-first-korean-toggle.md) | Language: English first with a Korean toggle | Accepted |
| [0007](0007-source-and-assumption-ledgers.md) | Source and assumption ledgers; grades and verification levels | Accepted |
| [0008](0008-licence-mit-code-cc-by-docs.md) | Licence: MIT for code, CC BY 4.0 for documents | Accepted |
| [0009](0009-default-scenario-24-reactors-2-analyzers.md) | Default scenario: 24 reactors in two bays, 2 analyzers, N by M adjustable | Accepted |
| [0010](0010-author-implementation-track.md) | The author's implementation track and user-owned file protection | Accepted |
| [0011](0011-infographic-themes-and-story-mode.md) | Infographic themes and scroll story mode | Accepted |
| [0012](0012-profiles-over-combinatorial-parameters.md) | Profiles over combinatorial parameters | Accepted |
| [0013](0013-scope-extensions-cell-lines-modes-breakout-events.md) | Scope extensions: cell-line profiles, operating modes and break-out events | Accepted |
| [0014](0014-equipment-output-adapters-from-public-docs.md) | Equipment output adapters modeled on public documentation | Accepted |
| [0015](0015-mixed-fleets-profiles-per-bay-and-analyzer.md) | Mixed fleets: profiles per bay and per analyzer | Accepted |
| [0016](0016-runtime-flag-against-v8-miscompile.md) | Runtime flag against a V8 miscompile that breaks determinism | Accepted |
| [0017](0017-ninth-flag-material-lot-links.md) | Ninth flag: material lot links (amends ADR-0005) | Accepted |
| [0018](0018-lab-ui-stack-preact.md) | Lab UI stack: Preact, with the engine in a Web Worker | Accepted |
| [0019](0019-deterministic-math-across-js-engines.md) | Deterministic maths across JavaScript engines | Accepted |
| [0020](0020-tenth-flag-equipment-links.md) | Tenth flag: equipment links (amends ADR-0005) | Accepted |
| [0021](0021-interactive-3d-virtual-plant.md) | The lab centres on an interactive 3D virtual plant | Proposed |

Keep this table in step with the files. A status other than `Proposed` appears here only after the author's own commit.

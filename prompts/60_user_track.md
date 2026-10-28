# 60 — Author implementation track

Five pieces of this project are written by the author, by hand: the canonical DDL, three core SQL queries, and the SimPy core loop. AI roles write the specification, the fixtures, the acceptance tests and, on request, reviews. AI roles never write, patch, reformat or "fix" these files. The author can explain them line by line; that is the point.

Read `prompts/00_master_build.md` first. This file is for (a) the author, (b) S1/S2 executors, who build the acceptance tests named here, and (c) any AI asked to review the author's work.

## Working principles (mandatory for AI roles; the author may adopt them)

Principles: see `prompts/PRINCIPLES.md`; the author may adopt them. Stage combination: SDD + TDD + BDD + EDD + HITL; always KISS, AHA, SRP, Small Batches.
The author's implementation track is itself a HITL gate (PRINCIPLES.md section 1): AI roles write specs, fixtures, acceptance tests and reviews, never the implementation. Rails: PRINCIPLES.md section 6.

## Ownership

| Path | Owner | Acceptance test (AI writes, author's code must pass) | Gate |
|---|---|---|---|
| `sql/schema.sql` | author | `tests/user_track/test_schema_sql.py` (S1) | non-blocking |
| `sql/queries/asof_join.sql`, `lineage_recursive.sql`, `bridging_offset.sql` | author | `tests/user_track/test_queries.py` (S2) | non-blocking |
| `reference/sim_core.py` | author | `tests/user_track/test_sim_core_parity.py` (S1) | non-blocking |

Run them with `uv run pytest -m user_track -q`. Tests skip with a message while a file is absent and fail once it exists but is wrong. The default `uv run pytest -q` excludes them, so the AI path is never blocked by the author's schedule. Each file starts with a comment block of your non-obvious decisions and what you rejected; that block is the raw material for the explanation script in S5.

## Task cards

### Card A — canonical DDL, `sql/schema.sql` (about 3-4 h including reading)

- **Goal:** one schema that holds the recorded world for the C architecture and can also hold A and B data with gaps, so the same queries run on all three. DuckDB dialect, written in standard SQL so it ports to Postgres.
- **Inputs:** `docs/design/data_model.md` (entities, state machines, time fields, validation catalogue), `schemas/event.schema.json`, `docs/adr/` (stack).
- **Hard constraints from the design:** `(request_id, analyte, version)` unique in `result`; `measured_at` and `run_id` `NOT NULL` in `result`; `sampled_at` exists only in `sample`; time columns `TIMESTAMP`; versions append-only (no update path in the model); five time meanings kept apart: `sampled_at`, `measured_at`, `ingested_at`, `reviewed_at`, `available_at`.
- **Names the acceptance test requires** (everything else is yours to design): tables `reactor`, `batch`, `operator`, `instrument`, `instrument_state`, `sample`, `aliquot`, `analysis_request`, `run`, `result`, `derivation_edge`, `historian_value`, `reactor_tag`. Columns: `sample(sample_id, reactor_id, batch_id, sampled_at, operator_id)`; `analysis_request(request_id, sample_id, requested_at, control_id NULL)`; `run(run_id, instrument_id, started_at, ended_at, method_version)`; `result(request_id, analyte, version, run_id, value, unit, measured_at, status, ingested_at, reviewed_at, available_at)`; `instrument_state(instrument_id, valid_from, reagent_lot, calibration_id)`; `derivation_edge(parent_id, child_id, kind)`; `historian_value(tag, ts, value, available_at)`; `reactor_tag(reactor_id, tag)`.
- **Decide and record in your header comment:** whether `sampled_at <= measured_at` is a `CHECK` or only a validation view (the recorded world must be able to hold wrong data so the wrongness can be detected; the truth world never violates it); which keys are natural versus surrogate; which states are enums.
- **Acceptance** (`tests/user_track/test_schema_sql.py`): executes cleanly in in-memory DuckDB; required names exist; duplicate `(request_id, analyte, version)` rejected; `NULL` `run_id` or `measured_at` rejected; `sampled_at` only on `sample`; time columns `TIMESTAMP`; `tests/fixtures/sql/single_sample.sql` loads; no deny-listed non-portable construct (`CREATE OR REPLACE`, `INSTALL`, `LOAD`, `STRUCT`, `MAP(`, `LIST(`, array `[]` types, `ENUM(`, `UNION(`, `USING SAMPLE`).
- **Learning path:** DuckDB docs, "Data Types" and "Constraints" (`PRIMARY KEY`, `UNIQUE`, `NOT NULL`, `CHECK`, foreign keys and their limits); PostgreSQL docs, "Data Definition" for the portable subset; then read the single-sample example in `docs/design/data_model.md` and sketch the rows for A, B and C on paper first.

### Card B1 — `sql/queries/asof_join.sql` (S2; about 2-3 h)

- **Goal:** for every released result, attach the historian value that was effective **at `sampled_at`** and **knowable at a decision time**. Never join on `measured_at`.
- **Parameters:** `$decision_time` (timestamp), `$max_age_s` (integer; older matches return `NULL`).
- **Output columns:** `request_id, analyte, version, tag, ctx_ts, ctx_value`, one row per released result per tag of its reactor.
- **Rules:** first reduce `historian_value` to what was known at the decision time (latest `available_at` version per `(tag, ts)` with `available_at <= $decision_time`), then `ASOF JOIN` on `ts <= sampled_at`.
- **Hand fixture** (typed by the executor in `tests/fixtures/sql/`): one reactor and tag; historian rows `(08:30, 1.0, avail 08:30:10)`, `(08:39, 2.0, avail 08:39:10)`, `(08:39, 2.5, avail 10:30:00)` (a late correction), `(09:00, 5.0, avail 09:00:10)`; one result sampled 08:40:00, measured 09:25:00. Expected: decision 10:00:00 gives `2.0`; decision 11:00:00 gives `2.5`; `$max_age_s = 30` gives `NULL`; `$max_age_s = 60` keeps the row. The test also asserts the value is not `5.0`, which is what a `measured_at` join would return.
- **Learning path:** DuckDB docs, "ASOF Join" (inequality condition, `USING` form); first write the same thing with pandas `merge_asof` on the fixture and compare; then read about valid time versus transaction time (bitemporal) in `docs/design/data_model.md`.

### Card B2 — `sql/queries/lineage_recursive.sql` (S2; about 2-3 h)

- **Goal:** all ancestors of a node through `derivation_edge`, one row per distinct ancestor at its minimum depth, safe against cycles.
- **Parameters:** `$root_id`, `$max_depth`. **Output:** `ancestor_id, depth`, ordered by `depth, ancestor_id`. The root is never its own ancestor, even when a cycle leads back to it.
- **Hand fixture:** edges (parent to child): `S1>A1`, `S2>A2`, `A1>P1`, `A2>P1`, `P1>P1a`, `P1>P1b`, `P1a>P2`, `P1b>P2`. Root `P2`, depth cap 10, expected `(P1a,1) (P1b,1) (P1,2) (A1,3) (A2,3) (S1,4) (S2,4)`. With `$max_depth = 2`: the first three rows. A second fixture adds the bad edge `P2>P1` (a cycle): the query must terminate and return the same seven rows.
- **Learning path:** DuckDB docs, "WITH Clause", recursive CTEs, and the section on avoiding infinite recursion; PostgreSQL docs, "WITH Queries", the `CYCLE` clause and path-array technique. Do the closure by hand on paper for the fixture before writing SQL.

### Card B3 — `sql/queries/bridging_offset.sql` (S2; about 1.5-2 h)

- **Goal:** estimate the inter-instrument offset per analyte from control material measured on both instruments after a lot change, and return corrected values for the target instrument. No evidence means no correction.
- **Parameters:** `$reference_instrument`, `$target_instrument`, `$changeover_at`.
- **Rule:** `offset(analyte)` = mean over control ids of `[mean(target values) - mean(reference values)]`, using results at or after `$changeover_at`. Correct only target-instrument results at or after `$changeover_at`.
- **Output:** `request_id, analyte, version, instrument_id, value_raw, offset_applied, value_corrected, n_controls`. Where no offset is estimable: `offset_applied` and `value_corrected` are `NULL`, never silently equal to raw.
- **Hand fixture:** analyte glucose; control C1 reference `[10.0, 10.2]`, target `[10.6, 10.8]`; control C2 reference `[5.0]`, target `[5.4]`. Per-control differences 0.6 and 0.4, offset 0.5, `n_controls = 2`. Target results after the changeover `8.0, 6.5` become `7.5, 6.0`; target results before it and reference results are unchanged; a second analyte without controls yields `NULL`. Tolerance 1e-9.
- **Learning path:** DuckDB docs, aggregates and `GROUP BY`, window functions; read about bridging or method-comparison studies in the cited sources in `docs/research/sources.yaml` (grep for "bridging"); sketch the two-level mean on paper first.

### Card C — `reference/sim_core.py` (S1; about 5-7 h including learning)

- **Goal:** a SimPy 4.1.2 model of L3 that reads a trace (`schemas/trace.schema.json`), applies the semantics of the contract table in `prompts/10_S1_engine.md` Step 1, and writes a result (`schemas/trace_result.schema.json`). Roughly 100-150 lines. CLI: `python reference/sim_core.py TRACE.json OUT.json`. No random numbers: all draws are already in the trace.
- **Semantics to reproduce exactly:** integer seconds; event priority levels 0-4 at equal times and tie-break by `seq`; half-open windows with the whole-run pre-check and no backfill; `fifo` and `edf`; sequence-dependent setup; multi-visit routing; rerun re-enqueue with `attempt + 1`.
- **A question for you, not an answer:** SimPy orders events at the same time by a priority and an insertion counter. How will you realise five priority levels so that a run ending at `t` frees its analyzer before an arrival at `t` is enqueued and before dispatch? Record your reasoning in the header.
- **Acceptance** (`tests/user_track/test_sim_core_parity.py`): F1-F7 equal the hand expectations; 20 engine-generated traces equal their `expected_result` exactly on integer times; output validates against the schema.
- **Learning path:** SimPy docs, "SimPy in 10 minutes", then "Topical Guides": Environments, Events, Process Interaction, Shared Resources (`Resource`, `PriorityResource`, `Store`). Run F1 by hand on paper first and keep the timeline next to your code.

Suggested order: C and A during or just after S1; B2, B1, B3 during S2. Total about 15-20 h including learning. Do not wait for the AI path: the gates are separate.

## Reviewer instructions (any AI asked to review the author's work)

1. Read-only on every path in `.claude/user_owned.txt`. Do not run formatters or fixers on them (`ruff --fix`, `sqlfluff fix`, and similar). If the edit guard denies a write, stop; never bypass it with `bash`, `cp`, `sed` or a heredoc.
2. Run the acceptance tests and read the code against the card. Write the review to `docs/user_track/reviews/YYYY-MM-DD_<card>_<reviewer>.md` with these sections: Evidence (commands run, results), Questions, Concerns, Not reviewed.
3. A concern has a severity (blocker, major, minor), a location (`file:line`), and a **failing scenario expressed as an input** (a fixture row or a trace), not as replacement code. Quote at most three lines of the author's code per concern.
4. Questions come first and are real questions: "what happens to a result whose `available_at` equals the decision time?" Do not phrase suggestions as questions to smuggle in a rewrite.
5. If the author asks for a hint, point to a documentation section or a smaller fixture; do not hand over the solution. Never edit the acceptance tests to make the author's code pass; if a test looks wrong, say so in the review and let the orchestrator decide.
6. Praise only what the evidence supports. Do not summarise the work as complete; the gate is the test run.

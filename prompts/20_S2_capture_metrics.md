# 20 — S2 executor brief: capture architectures, error injection, metrics, experiments

Read `prompts/00_master_build.md` first. Start only after the S1 blocking gate passed and the `sim-adversary` pass on S1 is recorded (check the last entry of `docs/progress.md`). Executor: Sonnet, effort xhigh. Estimated 3-4 h.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination (S2): SDD + TDD + EDD + BDD + YAGNI + HITL; always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
Scenarios become Given-When-Then acceptance tests in the format of PRINCIPLES.md section 2, named after the scenario id. The forced-error fixtures, the evaluator's answer key and the hand fixtures are the evals (EDD); goldens are never regenerated.
You never commit; report structure-only paths and behaviour paths as two lists.
HITL gates touched: the author's SQL files (acceptance tests only), ADRs (`Proposed` only).

## Goal

Record the same truth run under data architectures built from feature flags, inject errors fairly, measure what each architecture preserves with an evaluator that cannot be gamed, and run experiments 1 and 2. Also: the analyzer-CSV-to-canonical parser, the data dictionary with state machines and roles, the single-sample failure trace, a Frictionless export, and acceptance tests for the author's three SQL files. Flags, presets, error types, metrics and experiments are defined in `docs/design/simulation_spec.md` (§5 to §8) and `docs/design/data_model.md`; this brief adds process and tests only.

## Allowed paths

`engine/src/` (new modules `record/`, `inject/`, `evaluate/`, `experiments/{assembly,arms,oracle}/`, `ingest/`, `export/`), `schemas/`, `scenarios/`, `tests/` (incl. `tests/fixtures/`, `tests/user_track/`), `docs/design/` (clarifications, plus the new `data_dictionary.yaml` and `single_sample_trace.md`), `docs/progress.md`, Proposed ADRs. `eslint.config.js` only to add the import zones of Step 0: no existing rule may be loosened, removed or downgraded to a warning, and the report includes `git diff HEAD -- eslint.config.js`. `scripts/check_all.sh` is not expected to change; report a gap instead. Dependencies: nothing new without a Proposed ADR.
Never touch: `sql/`, `reference/`, `src/`, `docs/research/*.yaml`, `docs/private/`.

## Step 0

- [ ] Read `.guardrails.local.txt`, `CLAUDE.md`, `docs/design/simulation_spec.md`, `docs/design/data_model.md`, the S1 progress entry. Confirm `npm run check`, `uv run pytest -q` and `bash scripts/check_all.sh --manual` are green before changing anything (paste the tails).
- [ ] ESLint `no-restricted-imports` zones (S2 owns these; each rule is shown failing on a planted import in a scratch copy, then passing):
  - Truth modules (`process`, `sampling`, `analysis`, the truth log) may be imported only from `engine/src/observe/**`, `engine/src/experiments/assembly/**`, `engine/src/experiments/oracle/**` and `engine/src/evaluate/**`. Nothing in `record/`, `ingest/`, `inject/`, `export/` or `experiments/arms/` may import them; the injector receives plain data from the assembly.
  - The error answer key (`engine/src/evaluate/answer_key.ts`) may be imported only inside `engine/src/evaluate/**`. The injector returns the materialised errors as plain data and the assembly writes them to the key file.
  - `experiments/arms/**` (the A, B and C decision code of experiment 2) sees recorded data only; the oracle arm is the single place that reads truth for a decision.

## Step 1 — architecture config, flags, presets

- [ ] `schemas/architecture.schema.json`: `{schema_version, id, flags:{<the eight booleans of spec §5>}, labelling:'handwritten'|'preprinted_barcode'|'issued_at_draw', source_of_record?}`. Presets A, B, C as data in `scenarios/architectures/{a_manual,b_lims_lite,c_context}.json`. No ninth flag.
- [ ] Recorder: one generic function from `observable_events` plus architecture config to a recorded dataset (events and tables). Per-flag effects exactly as the On/Off columns of spec §5. Hidden-field perturbation test (I8) re-run against the real recorder.
- [ ] One test per flag: the same observable stream with the flag on versus off yields the documented difference in recorded rows (fixture of 3-5 samples, expected rows typed by hand).
- [ ] The two time flags are independent: a 2 x 2 fixture (`two_clocks` x `write_time_keys`) with, per cell, the stored time columns, whether the keys are fixed at write, and the join basis (`sampled_at` or `measured_at`), typed by hand from spec §5. A cell the spec does not decide goes to the orchestrator; never infer it from engine output.
- [ ] C's process context is a versioned as-of projection: immutable keys stored at write time; context (batch phase, feed epoch) derived by an as-of join honouring the as-of rule of `data_model.md` §5. Tests: a historian correction ingested after a decision time is invisible to that decision and visible afterwards; a result version with `available_at` after the decision time is invisible to it and a later version supersedes it afterwards.
- [ ] Ablations: a runner producing C minus one flag for each of the eight flags.

## Step 2 — error injector (fair by construction)

- [ ] For each physical sample, draw **common error opportunities** once from keyed streams with the canonical key tuple of `00 §2` item 2 and `purpose = 'error:<type>'`: a list of `{type, u}` with `u` in [0, 1). Independent of architecture and of detection.
- [ ] An architecture **materialises** an opportunity when `u < rate(type, architecture, staff profile)`; rates come from profiles/ledger refs, and the rate is 0 where the mechanism cannot exist (no typed id means no transcription error). Coupling is monotone: any error that materialises under a lower rate also materialises under a higher one.
- [ ] Error types: the rows of the hypothesis matrix in spec §5, plus planned-versus-actual time (a structural limit of B, not a random error). Clock errors use a per-instrument offset of +5 h in fixtures.
- [ ] A forced mode: given a hand-built observable stream and an explicit list of errors to materialise, the injector bypasses the rates. Step 4 uses it; production runs do not.
- [ ] Staff profile multiplies label and transcription rates and scales the probability that an anomaly is noticed; the qualification reference is attached when `audit_trail` is on.
- [ ] Output: the materialised errors per architecture, with sample ids, as plain data; the assembly writes them to the key file. Tests: opportunities identical across architectures; monotone coupling; zero-rate cases; the key module is not importable outside `engine/src/evaluate/` (Step 0).
- [ ] Detection = the validation rule catalogue of `docs/design/data_model.md` §8, producing `hold | quarantine | reject`. Rules change status, never values. Flags only; no re-draw or re-measure in experiment 1.

## Step 3 — metrics evaluator (only reader of the answer key)

- [ ] Implement every metric of spec §8 with its denominator written in the function doc and asserted in tests. `hold_time` and `turnaround` exactly as defined in `data_model.md` §5. False-alarm rate = flags on clean requests / clean requests.
- [ ] Utilisation is always returned twice: per staffed window (a scenario setting) and per 24 h, each with and without setup time. Hand fixture (F5 values): 3600 s busy and 1800 s productive on one analyzer in a 36000 s window give 0.1 and 0.05; per 24 h 3600/86400 and 1800/86400.
- [ ] Hand-built fixture of 10 requests with 3 injected errors, 2 detected, 1 false flag: expected precision, recall, false-alarm rate typed by hand (recall 2/3; precision 2/3; false-alarm 1/7). Exact reconstruction and misattribution fixtures likewise.
- [ ] Gaming guards (each a test): every metric's denominator equals the count of all analysis requests or the stated subset; skipped and rejected requests stay in the denominator; no function returns a combined score; flagged-only samples never define the denominator of recall; the evaluator output includes seed count and spread; metrics are computed from recorded datasets plus truth plus the key, not from recorder internals.
- [ ] Output `metrics.json` (schema-validated) per `(scenario, seed, architecture)` and a seed-aggregate table (median and interval).

## Step 4 — structural gates, scenarios and experiments

**Forced-error fixtures (the gate; `00 §2` item 8).** For each error type of the spec §5 hypothesis matrix, one fixture: a hand-built observable stream of 3-5 samples, one error injected deliberately in forced mode, run through A, B, C and each single-flag ablation of C. Assert the exact outcome per cell: `prevented` (the error does not materialise), `detected` (a flag with the expected rule id) or `invisible` (materialised, no flag). Expected cells are typed by hand from the matrix, the flag table and the rule catalogue; a cell they do not decide goes to the orchestrator. Each flag must change at least one cell when ablated; otherwise report it as dead code. A time-order or clock rule may detect an error in more than one architecture, so cells follow the rules each architecture can evaluate, not a presumed ranking.

**Scenario tests** (`scenarios/sc01..sc07`; SC2 and SC5 exist), structural relations only:

| Scenario | Relation to assert |
|---|---|
| SC1 | the recorded ordinary-day datasets are produced for A, B, C and every ablation, with truth `log_hash` identical; no ordering of architectures is asserted |
| SC3 | the count of samples whose `[sampled_at, run.started_at]` contains a feed equals a count computed independently from the truth log; a join by `measured_at` attaches post-feed context to exactly those; a join by `sampled_at` with write-time keys attaches none |
| SC4 | noise-free fixture with a bias injected on one analyzer only: records without an instrument link show the bias as a group effect; with `instrument_state_snapshot` and a bridging correction the recovered offset equals the injected bias exactly; ablating `instrument_state_snapshot` restores the effect |
| SC6 | the +5 h offset fixture follows the forced-error cell table above, per architecture |
| SC7 | rerun traceability: overwrite keeps no first attempt, append-only keeps both; dilution-factor errors occur only on manual paths |

**Experiment 1.** `engine/src/experiments/assembly/open_loop`: run truth once per seed; assert the truth `log_hash` is identical for A, B, C and every ablation; run the eight ablations. A fixed seed list of at least 20 seeds is written in config before any run.
**Stochastic report (never a gate).** Over those seeds write, per metric, architecture and ablation, the median and interval; recall ranks, misattribution, phantom effect size and other orderings appear as data. No test asserts a ranking, a sign of difference between architectures, an interval that includes or excludes zero, or a residual error on a given seed; inconclusive and negative results are kept in the report.

**Experiment 2 (SC8).** `engine/src/experiments/{assembly,arms,oracle}/closed_loop` per spec §6.2. Arms: oracle (truth-informed decision) and A, B, C (recorded values, plus hold time or container where the architecture records it). Common random numbers through the canonical key tuple, so every arm shares the same draws. Paired difference against the oracle for probe offset and control excursion across at least 20 seeds with bootstrap intervals. Tests: with feedback off, truth is identical to experiment 1; with the same seed all arms share the same draws; a zero-bias configuration gives exactly zero paired difference. The result text template reads "model-internal effect under assumptions ...", never a prediction. The optional PAT/Raman-style model is out of scope unless asked.

## Step 5 — analyzer CSV drop to canonical record

- [ ] `schemas/canonical_record.schema.json`: the envelope fields of data_model §7 (`source_system`, `source_event_id`, `idempotency_key`, `schema_version`, `raw_ref` with file and line, `event_time` with its zone as sent, `received_at`) plus the mapped targets of its mapping table (`sample_id` via the label, `instrument_id`, `analyte`, `value`, `unit_ucum`, `measured_at` with its source zone, `dilution_factor`, `operator_id`).
- [ ] Parser for a **generic** at-line analyzer CSV (synthetic columns; no claim of matching any vendor format). Unit normalisation to UCUM. Output per row: loaded, or one of the actions `hold | quarantine | reject`, or no-op for an exact duplicate, with the rule id (VR-nnn) from the catalogue. Values are never edited.
- [ ] Hand-made fixtures in `tests/fixtures/csv/`, each with expected canonical output typed by hand: duplicate row; same file dropped twice; same `source_event_id` in two files; out-of-order timestamps; replay of a file after a correction (new version, original kept); timezone offset differing from the instrument's configured one; unit mismatch (mmol/L versus g/L); missing dilution factor on a diluted run. Property: parsing a file twice yields the same canonical set (idempotent).

## Step 6 — data dictionary, state machines, roles

- [ ] Create `docs/design/data_dictionary.yaml` per `data_model.md` §9: one entry per column (name, entity, type, nullable, UCUM unit, allowed values or range, time semantics, visibility, default with ledger id, description), a `state_machines` section per entity with each transition and the role allowed to cause it (roles from data_model §6), and a `roles` section. State names are data_model §6's; do not rename.
- [ ] Tests, using the repo's existing YAML reading (no new dependency): every column that recorders, the parser or the export emit exists in the dictionary with matching type and unit; every `state` value emitted belongs to its entity's machine; every transition the recorder performs is listed and its role is permitted; a transition not in the table is refused (forced test); no column with hidden visibility appears in any recorded or exported output.

## Step 7 — single-sample failure trace

- [ ] Pick the sample by rule before looking at any recorded output: in SC3, the lowest `sample_id` whose `[sampled_at, run.started_at]` contains a feed.
- [ ] `tests/fixtures/trace/single_sample_trace.json`, created once by a recorded command (checksum registered in `tests/golden/CHECKSUMS.txt`, read-only afterwards, never regenerated by a test): the truth row and the real recorded rows of that sample under A, B and C (tables and columns named in data_model §2), and each architecture's answer to three questions (which unit, which `sampled_at`, which process context) with the verdict `correct | wrong | unanswerable`.
- [ ] `docs/design/single_sample_trace.md`: the side-by-side table is generated from the fixture, never typed; a test regenerates it and fails on drift. Rows are the recorders' real output.

## Step 8 — FAIR export

- [ ] One row per (sample x analyte x released version) with the columns of data_model §10. Written as CSV plus `datapackage.json` (Frictionless Data Package: resources, table schema from the data dictionary, field types, UCUM units as a custom property, `seed`, `engine_version`, `schema_version`, data dictionary reference). No license value until the license ADR is Accepted.
- [ ] In-house structural validator test (required keys, every resource path exists, CSV header equals schema field names, types parse). No new dependency.

## Step 9 — acceptance tests for the author's SQL (non-blocking gate)

Write fixtures with answers computed by hand first, in `tests/fixtures/sql/` (tables as CSV or `.sql` inserts with explicit column lists, `expected_*.csv`, each with a comment showing the arithmetic). Tests in `tests/user_track/test_queries.py`, marker `user_track`, skip if the query file is absent, DuckDB in memory, schema loaded from the author's `sql/schema.sql` if present else from a minimal fixture schema in `tests/fixtures/sql/`. The contracts per query are cards B1-B3 in `prompts/60_user_track.md`; implement exactly those checks. Integration checks on the engine export for one scenario and seed: `asof_join` returns one row per result known at the decision time and uses no result version with `available_at` or historian row with `ingested_at` after it; `bridging_offset` on the SC4 noise-free fixture recovers the injected bias exactly.

## Gate and report

Blocking (AI path): every forced-error cell exact; the 2 x 2 time-flag fixture exact; evaluator tests, gaming guards and answer-key isolation green; experiment 1 invariance and experiment 2 CRN and zero-bias tests green; dictionary, parser, trace and export tests green; the stochastic report written; `npm run check`, `uv run pytest -q`, `check_docs --all` and `bash scripts/check_all.sh --manual` green. Then the orchestrator runs `sim-adversary` once on the S2 deliverables (you do not call it). Non-blocking (author path): `uv run pytest -m user_track`.
Mutation spot checks to run in a scratch copy and report: let a recorder read a hidden field (I8 must fail); change the recall denominator to flagged samples (a gaming guard must fail); remove monotone coupling (coupling test must fail); make `two_clocks` ignore its flag (the 2 x 2 fixture must fail). Revert each.
Report at most 300 words; append the `docs/progress.md` entry.

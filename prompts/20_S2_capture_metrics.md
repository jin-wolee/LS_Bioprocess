# 20 — S2 executor brief: capture architectures, error injection, metrics, experiments

Read `prompts/00_master_build.md` first. Start only after the S1 blocking gate passed (check the last entry of `docs/progress.md`). Executor: Sonnet, effort xhigh. Estimated 3-4 h.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination (S2): SDD + TDD + EDD + BDD + YAGNI + HITL; always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
Scenarios become Given-When-Then acceptance tests (BDD), named after the scenario id. The evaluator's answer key and the hand fixtures are the evals (EDD); goldens are never regenerated.
Commits follow Tidy First + Small Batches: structure-only changes apart from behaviour changes, each step testable. You leave changes uncommitted, so report structure-only changes separately.
HITL gates touched: the author's SQL files (acceptance tests only), ADRs (`Proposed` only).

## Goal

Record the same truth run under data architectures built from feature flags, inject errors fairly, measure what each architecture preserves with an evaluator that cannot be gamed, and run experiments 1 and 2. Add the analyzer-CSV-to-canonical parser, a Frictionless export, and acceptance tests for the author's three SQL files.

## Allowed paths

`engine/src/` (new modules `record/`, `inject/`, `evaluate/`, `experiments/`, `ingest/`, `export/`), `schemas/`, `scenarios/`, `tests/` (incl. `tests/fixtures/`, `tests/user_track/`), `scripts/check_all.sh` (append only), `docs/design/` (clarifications), `docs/progress.md`, Proposed ADRs. Dependencies: `uv add --dev duckdb` already present from S1; nothing else without a Proposed ADR.
Never touch: `sql/`, `reference/`, `src/`, `docs/research/*.yaml`, `docs/private/`.

## Step 0

- [ ] Read `.guardrails.local.txt`, `CLAUDE.md`, `docs/design/simulation_spec.md`, `docs/design/data_model.md`, the S1 progress entry. Confirm `npm run check` and `uv run pytest -q` are green before changing anything (paste).
- [ ] ESLint `no-restricted-imports`: nothing under `engine/src/record/**` or `engine/src/experiments/**` may import truth modules or the answer key; only `engine/src/evaluate/**` may import the answer key. Show the rule failing on a planted import in a scratch copy.

## Step 1 — architecture config, flags, presets

- [ ] `schemas/architecture.schema.json`: `{schema_version, id, flags:{<8 booleans from 00 §6>}, labelling:'handwritten'|'preprinted_barcode'|'issued_at_draw', source_of_record?}`. Presets A, B, C as data in `scenarios/architectures/{a_manual,b_lims_lite,c_context}.json`. No ninth flag.
- [ ] Recorder: one generic function from `observable_events` plus architecture config to a recorded dataset (events and tables). Per-flag effects exactly as the table in `00 §6`. Hidden-field perturbation test (I8) re-run against the real recorder.
- [ ] One test per flag: the same observable stream with the flag on versus off yields the documented difference in recorded rows (fixture of 3-5 samples, expected rows typed by hand).
- [ ] C's process context is a versioned as-of projection: immutable keys are stored at write time; context (batch phase, feed epoch) is derived by an as-of join to the recorded historian honouring `available_at`. Test: a sensor correction that becomes available after a decision time is invisible to that decision and visible afterwards.
- [ ] Ablations: a runner producing C minus one flag for each of the eight flags.

## Step 2 — error injector (fair by construction)

- [ ] For each sample, draw **common error opportunities** once from keyed streams `(sample, analyte, attempt, 'error:<type>')`: a list of `{type, u}` with `u` in [0, 1). Independent of architecture and of detection.
- [ ] An architecture **materialises** an opportunity when `u < rate(type, architecture, staff profile)`; rates come from profiles/ledger refs, and the rate is 0 where the mechanism cannot exist (no typed id means no transcription error). Coupling is monotone: any error that materialises under a lower rate also materialises under a higher one.
- [ ] Types: label transcription or tube mix-up (a correct barcode stuck on the wrong tube survives in C); dilution factor omitted or in the wrong unit (manual path only); instrument clock offset or timezone misconfiguration (SC6, per-instrument); duplicate or replayed ingest; out-of-order arrival; planned-versus-actual time (a structural limit of B, not a random error).
- [ ] Staff profile multiplies label and transcription rates and scales the probability that an anomaly is noticed (trainee: more errors, lower detection; qualification ref attached when `audit_trail` is on).
- [ ] Output: `error_answer_key` (list of materialised errors per architecture, with the sample ids) written to its own file. Tests: opportunities identical across architectures; monotone coupling; zero-rate cases; answer key is not importable outside `engine/src/evaluate/` (Step 0 rule).
- [ ] Detection = validation rule catalogue from `docs/design/data_model.md` (range, unit, plausibility, time order, duplicate, required context) producing flags `hold | quarantine | reject`. Rules change status, never values. Flags only; no re-draw or re-measure in experiment 1.

## Step 3 — metrics evaluator (only reader of the answer key)

- [ ] Implement every metric in `00 §9` with its denominator written in the function doc and asserted in tests.
- [ ] Hand-built fixture of 10 requests with 3 injected errors, 2 detected, 1 false flag: expected precision, recall, false-alarm rate typed by hand (recall 2/3; precision 2/3; false-alarm 1/7). Exact reconstruction and misattribution fixtures likewise.
- [ ] Gaming guards (each a test): every metric's denominator equals the count of all analysis requests or the stated subset; skipped and rejected requests stay in the denominator; no function returns a combined score; flagged-only samples never define the denominator of recall; the evaluator output includes seed count and spread; metrics are computed from recorded datasets plus truth plus answer key, not from recorder internals.
- [ ] Output `metrics.json` (schema-validated) per `(scenario, seed, architecture)` and a seed-aggregate table (median and interval).

## Step 4 — experiments and scenarios

**Experiment 1.** `engine/src/experiments/open_loop`: run truth once per seed; assert the truth `log_hash` is identical for A, B, C and every ablation; run the 8 ablations; at least 20 seeds for aggregates and one seed for the single-sample trace.
Scenarios (`scenarios/sc01..sc07`): SC1, SC3, SC4, SC6, SC7 (SC2, SC5 exist). Scenario sanity tests state relations only:

| Scenario | Relation to assert |
|---|---|
| SC1 | misattribution A > B > C is not assumed: assert C > 0 (residual tube mix-up) and report the measured ordering as data |
| SC3 | samples whose `[sampled_at, run_started_at]` contains a feed: count equals a count computed independently from the truth log; join by `measured_at` attaches post-feed context to exactly those; C attaches none |
| SC4 | with habitual assignment and inter-instrument bias, phantom effect size in A and B exceeds 0; in C, with `instrument_state_snapshot` and bridging, it is within the seed interval of 0; ablating `instrument_state_snapshot` restores the phantom effect |
| SC6 | skewed instrument stamps are flagged by the time-order rule in C and not by A; recall in C is higher than in B on every seed |
| SC7 | rerun traceability: A (overwrite) below C (append-only); C is exactly 1; dilution-factor errors occur only on manual paths |

Ablation direction table (each ablation must move at least the listed metric in the stated direction, otherwise the flag is dead code): `system_issued_id` misattribution; `two_clocks` alignment error; `available_at` availability before deadline and time-travel leaks; `instrument_state_snapshot` phantom effect and reconstruction; `append_only_versions` rerun traceability; `write_time_keys` alignment error and context mismatch; `ingest_idempotency` duplicate double counts; `audit_trail` attributable rate and detection of overwritten values.

**Experiment 2 (SC8).** `engine/src/experiments/closed_loop`: daily offline pH re-standardises the online probe when the recorded difference exceeds the threshold (ledger ref). Open-sample outgassing biases the true offline value while the sample waits (stability effect from S1). Arms: oracle (truth-informed decision) and A, B, C (decide from recorded values, and from holding time or container where the architecture records it). Common random numbers keyed `(seed, reactor, sample, purpose)`; paired difference against the oracle for probe offset and control excursion across at least 20 seeds with bootstrap intervals. Tests: with feedback off, truth is identical to experiment 1; with the same seed all arms share the same draws; a zero-bias configuration gives zero paired difference. Result text template must read "model-internal effect under assumptions ...", never a prediction. The optional PAT/Raman-style model is out of scope unless asked.

## Step 5 — analyzer CSV drop to canonical record

- [ ] `schemas/canonical_record.schema.json`: `source_event_id, instrument_id, schema_version, run_id, sample_label, analyte, value, unit_ucum, measured_at_local, tz_offset, raw_ref (file, line)`.
- [ ] Parser for a **generic** at-line analyzer CSV (synthetic columns; make no claim of matching any vendor format). Unit normalisation to UCUM. Output per row `accepted | quarantined | rejected` with a reason code from the validation catalogue. Values are never edited.
- [ ] Hand-made fixtures in `tests/fixtures/csv/`, each with expected canonical output typed by hand: duplicate row; same file dropped twice; same `source_event_id` in two files; out-of-order timestamps; replay of a file after a correction (new version, original kept); timezone offset differing from the instrument's configured one; unit mismatch (mmol/L versus g/L); missing dilution factor on a diluted run. Property: parsing a file twice yields the same canonical set (idempotent).

## Step 6 — FAIR export

- [ ] One row per (sample x analyte x released version): value, `sampled_at`, `measured_at`, holding time, instrument state, method, process context as-of. Written as CSV plus `datapackage.json` (Frictionless Data Package: resources, table schema, field types, UCUM units as a custom property, `seed`, `engine_version`, `schema_version`, data dictionary reference). No license value until the license ADR is Accepted.
- [ ] In-house structural validator test (required keys, every resource path exists, CSV header equals schema field names, types parse). No new dependency.

## Step 7 — acceptance tests for the author's SQL (non-blocking gate)

Write fixtures with answers computed by hand first, in `tests/fixtures/sql/` (tables as CSV or `.sql` inserts, `expected_*.csv`, each with a comment showing the arithmetic). Tests in `tests/user_track/test_queries.py`, marker `user_track`, skip if the query file is absent, DuckDB in memory, schema loaded from the author's `sql/schema.sql` if present else from a minimal fixture schema in `tests/fixtures/sql/`. Contracts per query are in `prompts/60_user_track.md` (cards B1-B3); implement exactly those checks. Plus integration checks on the engine export for one scenario and seed: `asof_join` returns one row per released result and never uses a historian row with `available_at` after the decision time; `bridging_offset` on SC4 recovers the injected inter-instrument bias within the seed interval.

## Gate and report

Blocking (AI path): detection matrix behaves as designed (structural cells exact, statistical cells inside the seed interval); metrics evaluator tests, gaming guards and answer-key isolation green; experiment 1 invariance and experiment 2 CRN and zero-bias tests green; parser fixtures and export validator green; `npm run check`, `uv run pytest -q`, `check_docs --all` green. Non-blocking (author path): `uv run pytest -m user_track`.
Mutation spot checks to run and report: let a recorder read a hidden field (I8 must fail); change the recall denominator to flagged samples (a gaming guard must fail); remove monotone coupling (coupling test must fail). Revert each.
Report at most 300 words; append the `docs/progress.md` entry.

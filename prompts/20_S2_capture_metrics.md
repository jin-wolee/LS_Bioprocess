# 20 — S2 executor brief: capture architectures, error injection, metrics, experiments

Read `prompts/00_master_build.md` first. Start only after the S1 blocking gate passed and the `sim-adversary` pass on S1 is recorded (check the last entry of `docs/progress.md`). Executor: Sonnet, effort xhigh. Estimated 3-4 h for Steps 0 to 4 and 9 to 12; Steps 5 to 8 (the raw device layer, ADR-0014) may run as a second executor session after the Step 4 gate passes, at the orchestrator's choice.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination (S2): SDD + TDD + EDD + BDD + YAGNI + HITL; always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
Scenarios become Given-When-Then acceptance tests in the format of PRINCIPLES.md section 2, named after the scenario id. The forced-error fixtures, the evaluator's answer key and the hand fixtures are the evals (EDD); goldens are never regenerated.
You never commit; report structure-only paths and behaviour paths as two lists.
HITL gates touched: the author's SQL files (acceptance tests only), ADRs (`Proposed` only; ADR-0014 stays `Proposed` and its decider's note stays empty).

## Goal

Record the same truth run under data architectures built from feature flags, inject errors fairly, measure what each architecture preserves with an evaluator that cannot be gamed, and run experiments 1 and 2. Also: the raw device layer (synthetic equipment output files for three analyzer dialects and two controller families, and the adapters that parse them into the canonical schema; ADR-0014), the data dictionary with state machines and roles, the single-sample failure trace, a Frictionless export, and acceptance tests for the author's three SQL files. Flags, presets, error types, metrics and experiments are defined in `docs/design/simulation_spec.md` (§5 to §8) and `docs/design/data_model.md`; the raw layer in spec §2.4 and data_model §16. This brief adds process and tests only.

## Allowed paths

`engine/src/` (new modules `record/`, `inject/`, `evaluate/`, `experiments/{assembly,arms,oracle}/`, `ingest/` (incl. `ingest/adapters/`), `raw/` (emitters), `export/`), `schemas/`, `scenarios/` (incl. `scenarios/profiles/{dialect,controller}/`), `tests/` (incl. `tests/fixtures/`, `tests/fixtures/raw/`, `tests/user_track/`), `docs/design/` (clarifications, plus the new `data_dictionary.yaml` and `single_sample_trace.md`), `docs/progress.md`, Proposed ADRs. `eslint.config.js` only to add the import zones of Step 0: no existing rule may be loosened, removed or downgraded to a warning, and the report includes `git diff HEAD -- eslint.config.js`. `scripts/check_all.sh` is not expected to change; report a gap instead. The one permitted edit of S1 code is Step 7: new `sensor_tick` signals behind the `raw_layer` setting, with layer-off logs byte-identical to the S1 goldens. Dependencies: nothing new without a Proposed ADR.
Never touch: `sql/`, `reference/`, `src/`, `docs/research/*.yaml`, `docs/private/`.

## Step 0

- [ ] Read `.guardrails.local.txt`, `CLAUDE.md`, `docs/design/simulation_spec.md`, `docs/design/data_model.md`, the S1 progress entry. Confirm `npm run check`, `uv run pytest -q` and `bash scripts/check_all.sh --manual` are green before changing anything (paste the tails).
- [ ] ESLint `no-restricted-imports` zones (S2 owns these; each rule is shown failing on a planted import in a scratch copy, then passing):
  - Truth modules (`process`, `sampling`, `analysis`, the truth log) may be imported only from `engine/src/observe/**`, `engine/src/experiments/assembly/**`, `engine/src/experiments/oracle/**` and `engine/src/evaluate/**`. Nothing in `record/`, `ingest/`, `raw/`, `inject/`, `export/` or `experiments/arms/` may import them; the injector receives plain data from the assembly.
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

## Step 5 — raw device layer: dialects, synthetic fixtures, emitters

Design: `docs/design/simulation_spec.md` §2.4 and `docs/design/data_model.md` §16 (the design wins; this step carries process only). Start from the ledger gate: for every parameter the step reads, a ledger entry exists. The gaps listed in spec §2.4.8 are not yet entries; if one is missing when a step needs it, stop that part, build what is covered, and report the gap to the orchestrator, who has the research role add it. Never invent a number.

- [ ] Schemas: `schemas/dialect.schema.json` and `schemas/controller_profile.schema.json` (ADR-0012 style, every numeric parameter `{value, unit, ref}` with `ref` resolving to a ledger id; `modeled_on` is a list of `S###` that must resolve; a banner line is required), `schemas/raw_quirk_key.schema.json` (annotated `"x-visibility": "hidden"`; the evaluator is its only reader), and `schemas/canonical_record.schema.json` (the envelope of data_model §7 with `raw_ref` as file and line, plus the targets of data_model §16.3).
- [ ] Profile data: `scenarios/profiles/dialect/{allinone_csv,counter_csv,cds_table}.json` and `scenarios/profiles/controller/{ctrl_neutral,ctrl_bench}.json`; each analyzer profile names its dialect or dialects (spec §2.4.2). Ids, file-name prefixes and labels are vendor-neutral.
- [ ] Hand-made synthetic fixtures in `tests/fixtures/raw/<dialect>/`, each 3 to 5 data rows, each with a sibling `*.expected.json` of canonical records typed by hand from the dialect description. Every fixture file starts with the line `synthetic, modeled on public documentation; not a real instrument file`. One clean file per dialect, then the variants the quirk tests of Step 6 need.
- [ ] Emitter: one generic function from observable events, dialect data and plain-data injections to file text. Integer seconds become wall-clock text only inside it; the calendar anchor and zone offsets come from the scenario. Quirk opportunities use the canonical key tuple with `purpose = 'raw:<quirk id>'` (a file-level draw uses the export id in place of the sample). It returns the realised quirks as plain data for the answer key.
- [ ] Tests (red first): the banner is the first line of every emitted file; the same inputs give a byte-identical file; with `raw_layer` off, no emitter runs and the event log equals the S1 and earlier S2 goldens (compare, never regenerate); `engine/src/raw/**` is added to the no-truth import zone of Step 0 and fails on a planted import.
- Gate 5: schemas validate every dialect and profile file; fixture and banner tests green; the lint zone shown failing then passing.

## Step 6 — adapters: parser, quirk tests, idempotent re-ingest

- [ ] Parser: one generic function from file text and an adapter entry to `raw_file`, `raw_record`, canonical records and `parse_error` rows (data_model §16). Per line the outcome is loaded, no-op, or an action `hold | quarantine | reject` with its rule id. Rules VR-023 to VR-026 and the existing VR-005, VR-006, VR-008, VR-008b, VR-014, VR-019 are used as defined in data_model §8 and §16.6; a rule changes a state and never a value. The parser never reads truth or the raw quirk key.
- [ ] Round trip, one fixture per dialect with every quirk switch off: parsing the emitted file returns the observable events it was rendered from, on the mapped fields and within the dialect's time resolution. The expected rows are typed by hand in the fixture, not produced by running the emitter.
- [ ] One Given-When-Then test per quirk, named after its id: `describe("RQ2 date order and clock style", ...)` with `it("Given ...")`, `it("When ...")`, `it("Then ...")` blocks in the format of PRINCIPLES.md section 2, one behaviour per `it`, expected values typed by hand. Minimum cases (test-only values; say so in the test):
  - RQ1: a stamp with no zone and an entry zone of +2 h loads as the UTC instant two hours earlier, with the source zone stored beside it (K14); an entry without a zone gives an unresolved stamp.
  - RQ2: entry order unknown and a file with day values 03 and 13 pins the order for every row; a file with no day above 12 leaves every row unresolved and quarantined (VR-024); an entry pinned to the wrong order loads valid wrong instants and the key counts them as resolved wrongly; a 12 h clock without a day-part marker is unresolved.
  - RQ3: a minute-truncated stamp loads with `time_resolution_s` set and two rows in one minute keep file order.
  - RQ4: the same file twice, an append-mode file that repeats earlier rows and an overlapping export give no new rows with `ingest_idempotency` on, and double count with it off; same key with a changed value is quarantined (VR-008b).
  - RQ5: a reanalysis row loads as version 2 with the original `measured_at`; without version 1 in the store it is VR-019; with `append_only_versions` off it overwrites.
  - RQ6: a blank value with a range note loads as a null value with `range_flag`; a blank value for a required analyte with no note is held (VR-026).
  - RQ7: a file without a units row takes units from the entry; a unit text that maps to another dimension is quarantined (VR-005); the same dimension with a plausible value loads (the invisible case).
  - RQ8: two templates with reordered columns give the same canonical output; an unknown column is an information finding; a missing required column rejects the file (VR-023).
  - RQ9 and RQ10 and RQ11 are tested in Step 7 with the controller fixtures.
- [ ] Idempotent re-ingest (property): ingesting a set of files twice, and in a shuffled file order, yields the same canonical set; with `ingest_idempotency` off the second pass doubles the rows. A truncated file loads its complete lines and writes one `parse_error` for the broken one.
- [ ] Raw-layer metrics of spec §2.4.7 with the denominators written in each function's doc and asserted. Hand fixture (test-only values): 10 rows written, 2 of them repeats, 1 unreadable, 2 with ambiguous stamps of which 1 is pinned by another row and 1 stays unresolved. Expected: parse failure rate 1/10; duplicate rows suppressed 2/2 with the flag on and 0/2 with it off; ambiguous stamps 1/2 resolved correctly, 0/2 resolved wrongly, 1/2 unresolved; clean rows 5, clean rows quarantined or held 0/5; quarantined 1 and held 0 of 10 rows. A run with no repeated rows prints "none occurred", never 100 percent.
- [ ] Forced-error cells for the two new matrix rows of spec §5 (timestamp misread, unit implied by instrument settings and changed), run through B, C and each single-flag ablation of C in forced mode, expected cells typed by hand from the matrix and the rule table. Preset A is "not applicable". A cell they do not decide goes to the orchestrator.
- [ ] SC1 and SC6 re-run with `raw_layer` on: datasets for B, C and the ablations are produced, the truth `log_hash` is identical across architectures, the +5 h offset of SC6 now sits in the file stamps, and no ordering of architectures is asserted.
- Gate 6: every quirk test (RQ1 to RQ8), the round trip, the idempotency property, the metric fixture and the forced-error cells exact, red first then green.

## Step 7 — controller side: tags, alarms, batch-phase records

Ledger gate first (Step 5 preamble): the log deadband and maximum interval of each tag, the signal parameters of gas flows, pumps and off-gas CO2, and the alarm acknowledge times must exist as entries. If they do not, stop this step, report the list to the orchestrator and go on with Step 8.

- [ ] L1: add the `sensor_tick` signals of spec §2.4.4 that are not in A100 only when `raw_layer` is on. A test shows the layer-off event log byte-identical to the goldens. SP and OUT come from the generic controller rule on observable PV; nothing reads hidden state in an emitter.
- [ ] Controller emitter for `ctrl_neutral` and `ctrl_bench`: deadband and maximum-interval logging per tag (RQ9), scheduled L1 `alarm` events rendered as alarm transitions (RQ10), phase transitions from the process events and the batch (RQ11). The bench family writes its five record types as separate files.
- [ ] Adapter: tag names to the canonical `unit_tag.signal.role` form, rows to `historian_value`, `alarm_event` and `batch_phase_record`; the value at a time is read as the last row at or before it (data_model §16.4).
- [ ] Hand fixtures with expected rows typed by hand. Deadband (test-only values; the 1 rpm and 15 s are the worked example of A172): agitation PV sampled every 5 s as 100.0, 100.4, 101.2, 101.3, 101.3, 101.3, 101.3 rpm from t = 0 s, deadband 1 rpm, maximum interval 15 s (a limit counts when reached at equality), gives logged rows (0 s, 100.0), (10 s, 101.2), (25 s, 101.3); the value read at t = 20 s is 101.2 with age 10 s, and at t = 9 s it is 100.0 with age 9 s. Alarm: unacknowledged, then acknowledged, then normal produces three `alarm_event` rows, acknowledged straight to unacknowledged is held (VR-025). Phase: running, holding, held, restarting, running loads; held straight to running is held (VR-025).
- [ ] Both families on one fixture scenario (one bay each, spec §2.4.2): both parse, tags from both land under the same canonical form, and no ordering is asserted.
- Gate 7: RQ9 to RQ11 tests, the deadband fixture, the alarm and phase fixtures and the layer-off byte-identity test green, red first.

## Step 8 — three-rules checklist (ADR-0014; run before the report, paste the evidence)

- [ ] R1 public material only: every dialect and controller file lists `modeled_on` ids that resolve in `docs/research/sources.yaml` (a test); no sentence, table or paragraph of a manual appears in code, fixtures, comments or docs (read each new file; column labels are short field names from the ledger field lists A160, A162, A165, A166, A168, A171); no file from the Allotrope or AnIML repositories is present, only concept names; `docs/private/` was not read or copied from.
- [ ] R2 origin safety: dialect, profile and fixture ids, file-name prefixes and column labels are vendor-neutral (list them in the report); `uv run --frozen python scripts/check_docs.py --all` passes after the last new file is written (banned tokens); the pre-commit scan is the orchestrator's.
- [ ] R3 no compatibility claims: the banner test of Step 5 is green; every doc or UI string that describes a dialect says "synthetic formats modeled on public documentation"; `grep -rniE "compatible with|supports (the |an |any )?(real |actual )?(instrument|analy[sz]er|controller|device)|certified|conformant|validated against|reads real" docs/ engine/ schemas/ scenarios/ tests/` is run and every hit is read and justified or fixed in the report (design text that denies a claim is fine).
- [ ] ADR-0014 is still `Proposed` and its decider's note is untouched.

## Step 9 — data dictionary, state machines, roles

- [ ] Create `docs/design/data_dictionary.yaml` per `data_model.md` §9: one entry per column (name, entity, type, nullable, UCUM unit, allowed values or range, time semantics, visibility, default with ledger id, description), a `state_machines` section per entity with each transition and the role allowed to cause it (roles from data_model §6), and a `roles` section. State names are data_model §6's, and §16.5's for `alarm_event` and `batch_phase_record`; do not rename. When Steps 5 to 7 have run, the entries also cover the data_model §16 entities (`adapter`, `raw_file`, `raw_record`, `parse_error`, `alarm_event`, `batch_phase_record`) and the new columns of §16.2.
- [ ] Tests, using the repo's existing YAML reading (no new dependency): every column that recorders, the parser or the export emit exists in the dictionary with matching type and unit; every `state` value emitted belongs to its entity's machine; every transition the recorder performs is listed and its role is permitted; a transition not in the table is refused (forced test); no column with hidden visibility appears in any recorded or exported output.

## Step 10 — single-sample failure trace

- [ ] Pick the sample by rule before looking at any recorded output: in SC3, the lowest `sample_id` whose `[sampled_at, run.started_at]` contains a feed.
- [ ] `tests/fixtures/trace/single_sample_trace.json`, created once by a recorded command (checksum registered in `tests/golden/CHECKSUMS.txt`, read-only afterwards, never regenerated by a test): the truth row and the real recorded rows of that sample under A, B and C (tables and columns named in data_model §2), and each architecture's answer to three questions (which unit, which `sampled_at`, which process context) with the verdict `correct | wrong | unanswerable`.
- [ ] `docs/design/single_sample_trace.md`: the side-by-side table is generated from the fixture, never typed; a test regenerates it and fails on drift. Rows are the recorders' real output.

## Step 11 — FAIR export

- [ ] One row per (sample x analyte x released version) with the columns of data_model §10. Written as CSV plus `datapackage.json` (Frictionless Data Package: resources, table schema from the data dictionary, field types, UCUM units as a custom property, `seed`, `engine_version`, `schema_version`, data dictionary reference). No license value until the license ADR is Accepted.
- [ ] In-house structural validator test (required keys, every resource path exists, CSV header equals schema field names, types parse). No new dependency.

## Step 12 — acceptance tests for the author's SQL (non-blocking gate)

Write fixtures with answers computed by hand first, in `tests/fixtures/sql/` (tables as CSV or `.sql` inserts with explicit column lists, `expected_*.csv`, each with a comment showing the arithmetic). Tests in `tests/user_track/test_queries.py`, marker `user_track`, skip if the query file is absent, DuckDB in memory, schema loaded from the author's `sql/schema.sql` if present else from a minimal fixture schema in `tests/fixtures/sql/`. The contracts per query are cards B1-B3 in `prompts/60_user_track.md`; implement exactly those checks. Integration checks on the engine export for one scenario and seed: `asof_join` returns one row per result known at the decision time and uses no result version with `available_at` or historian row with `ingested_at` after it; `bridging_offset` on the SC4 noise-free fixture recovers the injected bias exactly.

## Gate and report

Blocking (AI path): every forced-error cell exact; the 2 x 2 time-flag fixture exact; evaluator tests, gaming guards and answer-key isolation green; experiment 1 invariance and experiment 2 CRN and zero-bias tests green; dictionary, parser, trace and export tests green; if Steps 5 to 8 ran, Gates 5 to 7 green, the Step 8 checklist pasted with its evidence, and any Step 7 part blocked by a ledger gap listed as blocked (never skipped silently); the stochastic report written; `npm run check`, `uv run pytest -q`, `check_docs --all` and `bash scripts/check_all.sh --manual` green. Then the orchestrator runs `sim-adversary` once on the S2 deliverables (you do not call it). Non-blocking (author path): `uv run pytest -m user_track`.
Mutation spot checks to run in a scratch copy and report: let a recorder read a hidden field (I8 must fail); change the recall denominator to flagged samples (a gaming guard must fail); remove monotone coupling (coupling test must fail); make `two_clocks` ignore its flag (the 2 x 2 fixture must fail); make the adapter ignore `ingest_idempotency` (the RQ4 test must fail); make the parser read a file as day-first when the entry says month-first (the RQ2 test must fail); drop the banner from one emitter (the banner test must fail). Revert each.
Report at most 300 words; append the `docs/progress.md` entry.

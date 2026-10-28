# 00 — Master build prompt

Load this first in every session. It says what the project is, what must always hold, and how work is judged. Session briefs (`10_*`, `20_*`, ...) add scope; on invariants and gates this file wins. Detail lives in `docs/design/simulation_spec.md`, `docs/design/data_model.md`, `docs/research/assumptions.yaml`, `docs/research/sources.yaml` and `docs/adr/`. If this prompt and a design doc disagree, follow this prompt and log the discrepancy under "Open questions" in `docs/progress.md`.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md` (definitions, stage table, rails, brief header).
Stage combination: set per session by the stage table in PRINCIPLES.md section 5. This file is the SDD source of truth for all of them: spec first, then code. Always KISS, AHA, SRP, Small Batches.
The rail numbers cited below (rails 1-6) are PRINCIPLES.md section 6.

## 1. Mission

Build a public, browser-runnable simulator. N bench-scale bioreactors in a process-development (PD) lab send in-process samples to 2 shared at-line analyzers. One synthetic "truth" run is recorded under several data architectures on the same run, so the only thing that changes is how the data is captured and stored. The simulator shows how analysis results lose process context (which reactor, which moment, which instrument state) and what each architecture preserves.

The portfolio centre is not the screen. It is: single-sample failure tracing (real rows from A, B and C side by side), the canonical DDL, three core SQL queries, the analyzer-CSV-to-canonical mapping, and the source ledger.

Central case (README first screen): a sample drawn at 08:40 waits; a bolus feed happens at 09:00; the sample is measured at 09:25. Joining to the historian by `measured_at` pairs the pre-feed value with post-feed process state, which contaminates anything trained on it. Same family: an autosampler that loads in vessel-number order makes the high-numbered vessels wait longest.

Default scenario: 24 reactors in two bays of 12, 2 analyzers; N and M are variable (5 to 100 reactors, 1 to 6 analyzers).

## 2. Non-goals

- Predicting any real lab. Results are model-internal under ledger assumptions.
- Claims of compliance (Part 11, Annex 11, ASM, SiLA, OPC UA): describe, never claim.
- Real data, vendor file formats copied verbatim, or any LIMS/MES product.
- A single summary score. A server, accounts, or a database service.
- PAT/soft-sensor model (optional, build only on explicit request). DSP and perfusion before S4. Pyodide. DuckDB-WASM bundled by default.
- Making C win by construction. Orderings must emerge from mechanisms.

## 3. Invariants (every session, every file)

1. **Truth vs recorded.** The engine emits a `truth_log` (everything) and an `observable_events` stream (what a person or instrument could actually see: sample drawn with planned label, received, run started with instrument and QC lot, QC result, calibration record, maintenance log, recorded historian values). Recorders (L4) consume only `observable_events`. Hidden fields are annotated `"x-visibility": "hidden"` in `schemas/`. Test: perturb hidden-only fields; recorder output is byte-identical. Only the metrics evaluator may read the error answer key; L5 never reads truth, except the oracle arm of experiment 2.
2. **Determinism.** Same `(scenario, seed, engine_version)` gives a byte-identical event log. Integer seconds for all event times. Randomness only from a keyed integer PRNG (`pure-rand`) with key `(physical sample, analyte, attempt, purpose)` (experiment 2 adds `seed, reactor`). A rerun or an added sample must not change any other sample's draws. `Math.random`, `Date.now()` and `new Date()` are banned in the engine (lint plus `scripts/check_all.sh` grep). Seeds are neutral values, never date-shaped.
3. **Source ids.** Every number shown publicly, and every parameter default in a profile or scenario, carries an `S###` or `A###` id that exists in the ledgers. Code reads values from profile/scenario JSON; no domain constant is hard-coded. Grade `A` values are labelled assumptions. Public numbers cite only `main-reread` sources. `check_docs.py` enforces ids.
4. **ADRs are Proposed only.** Use the `adr-new` skill. Never write a decider's note, never set `Accepted`.
5. **Author-owned files are review-only:** `sql/schema.sql`, `sql/queries/*.sql`, `reference/sim_core.py` (and anything listed in `.claude/user_owned.txt`). AI writes specs, fixtures, acceptance tests and reviews; never the implementation. Do not route around the edit guard with `bash`, `cp`, `sed` or heredocs.
6. **One contract.** `schemas/*.schema.json` is the single source for events, traces, scenarios and profiles. TS types are generated, Python validates with `jsonschema`. Every export and shareable URL carries `schema_version`, `engine_version`, `seed`.
7. **Generic engine.** No branch on a profile id, scenario id or architecture id inside the engine core. Behaviour comes from data through generic mechanisms.
8. **No false precision.** Report distributions over many seeds, show sensitivity, warn on extrapolation outside the range a source covers, make no numeric claim for a stage that has no result yet.
9. **Golden files are never regenerated by a script or by a test.** Changing one needs the author's approval recorded in `docs/progress.md`.
10. **Synthetic only, headless only, no publishing** (rails 1, 4, 5 of `PRINCIPLES.md`).

## 4. Five layers

| Layer | Contents | Notes |
|---|---|---|
| L1 process (truth) | staggered inoculation, simple kinetics (cells, metabolites, titer), 1-minute online sensor series, scheduled events (feed, temperature shift, alarm) | ISA-88 vocabulary: Site/Area/Unit, Batch. No feedback from L5 in experiment 1 |
| L2 sampling and logistics | planned window, actual draw (shift burst, weekend gap, handling time), label, transport, aliquot by storage condition, sample-stability effects while waiting | Labelling method (handwritten, pre-printed barcode, issued at draw) is an L2 setting, independent of L4 |
| L3 analysis (DES) | queue policy, QC and maintenance windows, reruns, dilution, instrument state (drift, lot, inter-instrument bias), multi-visit routing, setup time | Integer-second discrete-event engine |
| L4 recording | recorders per architecture, error injector, event log | The comparison axis |
| L5 use | feed decision, batch comparison, analyst queries, optional model; truth-oracle arm | Closed loop only in experiment 2 |

## 5. Profiles (first-class, data not code)

Scenarios pick profiles. Profiles live in `scenarios/profiles/{bioreactor,analyzer,staff}/*.json`, validated by `schemas/profile.schema.json`. Every numeric parameter is `{value, unit, ref}` and `ref` must resolve to a ledger id; bare numbers are rejected by schema and test. Values: `docs/research/assumptions.yaml`.

| Profile | Options (default first) | Changes | Layer | Data-side consequence |
|---|---|---|---|---|
| Bioreactor | `bench_manual` (2-5 L glass or single-use, manual sampling) / `micro_mini_parallel` (automated sampling, integrated analyzers) / `pilot` (50-200 L, manual via port) | sampling method, sample-volume budget (cumulative draw vs working volume, dead volume; over-budget draws are skipped and logged, still count in metric denominators), automation level (operator present or not, shift burst or not, rack/vessel-order delivery, who creates the label) | L1 volume, L2 | automated draws deliver in vessel order; labels can be system-created at draw |
| Analyzer | `allinone_atline` (one instrument, one pass per sample) / `split_cellcounter_metabolite` (one sample visits two instruments in sequence) / `hplc` (column changeover and system-suitability time) | service time, analyte panel, interface (`csv_drop` default, `vendor_opc`), calibration behaviour (drift, resets, lot change), routing visits, sequence-dependent setup | L3 (+ L4 ingestion) | per-visit records, instrument-state link, CSV vs OPC ingestion paths |
| Staff | `experienced` / `trainee`, plus shift and fatigue modifiers, roster mix per shift | handling time (L2), label and transcription error rate and anomaly-detection probability (L4) | L2, L4 | "who did it": `operator_id` plus training qualification ref attached to records when `audit_trail` is on |

The engine implements only the generic mechanisms: multi-visit routing, sequence-dependent setup, volume budget, rate multipliers, delivery order. Operator id and qualification ref ride on the existing `audit_trail` flag; do not add a ninth flag. If one seems necessary, write a Proposed ADR.

## 6. Data architecture = feature flags; A/B/C are presets

| Flag | On | Off |
|---|---|---|
| `system_issued_id` | keys issued by the system at label creation; nothing typed | key typed or handwritten; label transcription errors possible |
| `two_clocks` | `sampled_at` (actual) and `measured_at` stored separately | one time stored: the planned sampling time if a sampling plan exists (needs `system_issued_id`), otherwise the analysis time |
| `available_at` | each row carries when it became knowable; as-of queries honour it | queries see rows as of now (time travel leaks) |
| `instrument_state_snapshot` | run links instrument, calibration and reagent lot at run time | no link; at most a free-text analyzer name |
| `append_only_versions` | correction, rerun, reprocess create new versions | overwrite in place |
| `write_time_keys` | immutable `unit_id`, `batch_id`, `sampled_at` captured at write time | context joined later by timestamp (`measured_at`) against the historian |
| `ingest_idempotency` | source event id and idempotency key; duplicates and replays are no-ops; out-of-order handled | duplicates double count |
| `audit_trail` | who, when, what changed; operator id and qualification ref | no history; operator is free text or absent |

| Preset | Flags on | Labelling default | Realistic limits kept |
|---|---|---|---|
| A manual/Excel | none | handwritten | transcription, analysis-time clock, overwrite, no instrument id |
| B LIMS-lite | `system_issued_id`, `ingest_idempotency`, `audit_trail` | pre-printed barcode | records the planned time not the actual, reagent lot and calibration not linked, dilution factor typed by hand, joined to the historian by measured time. B is not a straw man: barcodes, auto-capture and audit trail exist |
| C context-preserving | all eight | issued at draw | immutable keys at write time, process context as a versioned as-of projection joined to the historian with `AS OF`. Residual error remains: a correct barcode stuck on the wrong tube |

- Labelling method is set independently of the flags; scenarios may cross them.
- Ablation: C with exactly one flag off, for each flag.
- GMP preset (SC11): which system is the source of record for routine in-process checks differs by site, so it is a setting; only release-relevant tests get state-machine and Part 11-grade control.

## 7. Experiments

**Experiment 1 (primary, open loop).** One truth run per `(scenario, seed)` shared by every architecture. Step durations identical across architectures. Errors come from common error opportunities drawn once per sample, independent of architecture, then materialised per architecture (S2 spec). Detection only raises flags; it never triggers a re-draw or re-measure. Truth log hash is identical across architectures.

**Experiment 2 (closed loop, SC8).** Offline pH is used to re-standardise the online probe. Open-sample CO2 outgassing biases offline pH, which mis-calibrates the probe, which causes a pH-control excursion in the process. Arms: oracle (decides with truth) versus A, B, C. Common random numbers keyed `(seed, reactor, sample, purpose)`. Paired difference against the oracle over at least 20 seeds, with intervals. Wording is always "model-internal effect under assumptions A###, not a prediction". Feedback is off everywhere else (default `feedback: false`, tested).

## 8. Scenario catalogue (`scenarios/*.json`, one question each)

| ID | Question | Key setting | Session |
|---|---|---|---|
| SC1 Ordinary Tuesday | what disappears on an ordinary day | defaults, architecture toggle | S2 |
| SC2 Shift-start burst | why wait when mean utilisation is low | shift burst versus staggered sampling window | S1 |
| SC3 Feed in the gap | which timestamp should the join use | feed between draw and measurement | S2 |
| SC4 New lot on AN-2 | instrument effect looks like a process effect | inter-instrument bias, habitual assignment, bridging | S2 |
| SC5 One analyzer down | whom does the priority rule hand the cost | 4 h maintenance window, FIFO versus EDF | S1 |
| SC6 Wrong clock | what if one clock is wrong | instrument timezone or skew | S2 |
| SC7 Re-run and dilution | how are reruns and dilutions recorded | QC failure, manual dilution factor | S2 |
| SC8 pH re-standardisation | how does a record error reach control | experiment 2 | S2 |
| SC9 Perfusion campaign | context unit is not the batch | long perfusion, harvest intervals | S4 |
| SC10 Pool genealogy | merges across batch boundaries | cross-batch pool | S4 |
| SC11 GMP preset | same model, different control strength | source-of-record setting | S3 |

## 9. Metrics (no composite score)

- Fixed denominator: **all analysis requests**, including missing, rejected, skipped (volume budget) and delayed ones.
- Only the evaluator reads the error answer key.
- Operational: holding time median, p90 and SLA exceedance; utilisation (state whether setup counts); **availability before a decision deadline** (`available_at` <= decision time).
- Quality: misattribution rate; detection precision and recall per error type; **false-alarm rate** (flags on clean requests / clean requests); **exact reconstruction rate** (share of requests whose analyst-query answer equals truth on reactor, batch, `sampled_at`, process context as-of, instrument state; unanswerable counts as wrong); **alignment error** (seconds between the time the join used and true `sampled_at`, reported as median and p90, plus the resulting context mismatch); **phantom effect size** (|recorded group effect - true group effect| / pooled truth SD for a group contrast whose true effect is zero); rerun traceability rate; attributable rate (operator and qualification present and correct).
- Experiment 2: probe offset, control excursion, paired difference versus oracle.
- Every table reports the seed count and spread. A metric without a stated denominator is a defect.

## 10. Verification ladder

1. Invariants (property-style loops over many seeds): no double occupancy of an analyzer, sample conservation, results immutable once released, time monotone, truth never visible to recorders, no run overlaps a window, queue discipline.
2. M/M/c-only mode (engine unit test only; the real scenarios are M/D/c-like and are explained, not validated, by it).
3. Hand-calculated fixtures: arrival reversal, window boundary, rerun, tandem visit, setup change, rack burst, EDF.
4. SimPy trace-driven parity: same input file, integer seconds, exact equality on event times, golden files read-only.
5. Scenario sanity: qualitative relations (sign, ordering, structural zero), not magnitudes.

A private prior prototype exists; do not port it. Its two defects become fixtures: (1) queue admission ordered by sampling time although transport can reverse arrival order; (2) QC and maintenance windows checked only at the start time so a run can straddle a window.

## 11. Session gates (AI path and author path gated separately)

| Session | AI builds | Author builds | Blocking gate (AI path) | Non-blocking gate (author path) |
|---|---|---|---|---|
| S1 engine | contracts, schemas, hand fixtures, TS L1-L3 with profiles, scaffold, acceptance tests for the author's code | SimPy core loop, canonical DDL | TS engine judged only by invariants + hand fixtures + M/M/c; lint, typecheck, tests green | SimPy parity, DDL acceptance (`pytest -m user_track`) |
| S2 capture + metrics | flags and presets, error injector, evaluator, experiments 1 and 2, CSV parser, datapackage, SQL acceptance tests | three SQL queries | detection matrix behaves as designed; evaluator tests; experiment invariants | SQL results equal fixture answers |
| S3 lab UI | UI, presets, lineage view, challenge, E2E, Pages workflow (`30_*` written at session start) | approve the public flip (author changes visibility) | Playwright headless green; full-history banned-token scan 0 | - |
| S4 DSP | genealogy, HPLC contention (`40_*`) | - | many-to-many lineage query test | - |
| S5 release | model card, demo GIF, case write-up, external-review dispositions (`50_*`) | review a private 90-second explanation script; run and explain it unaided | author sign-off; only then a resume sentence draft | - |

Prompts `30_*`, `40_*`, `50_*` are written at the start of their session, not before.

## 12. Ownership map

Layout (matches `CLAUDE.md`): TypeScript engine in `engine/` with its tests beside it (`engine/tests/`); UI in `src/` (S3); language-neutral shared fixtures in `tests/fixtures/` and goldens in `tests/golden/`; Python acceptance tests for the author's code in `tests/user_track/`; root `package.json` drives `npm run check`.

AI-owned: `engine/`, `src/`, `tests/`, `schemas/`, `scenarios/`, `scripts/`, `docs/design/`, `docs/progress.md`, `prompts/`. Ledgers (`docs/research/*.yaml`) are written by the research role; engine code only reads them. Author-owned: `sql/`, `reference/`, ADR decider notes, `Accepted` status, commits of Accepted ADRs, `git push`, visibility change.

## 13. Definition of done (every session)

- [ ] Every new behaviour has a test seen red, then green; pasted evidence in the report.
- [ ] `uv run pytest -q` and `uv run --frozen python scripts/check_docs.py --all` both pass (0 failures). From S1 on, `npm run check` passes too.
- [ ] `bash scripts/check_all.sh` passes (S1 onward it also runs lint, typecheck, tests and the `Math.random` grep).
- [ ] Python dependencies only through `uv`; Node packages with exact versions; every browser closed.
- [ ] No file outside the brief's allowed paths changed (`git status --short`).
- [ ] `docs/progress.md` has a new entry: date, what changed, evidence, Parked, Open questions.
- [ ] Report is at most 300 words: files with line counts, commands with output tails, deviations, blocked items.

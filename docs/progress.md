# Progress log

Newest entry last. Each entry: what was done, what is open for the author, what comes next.

## 2026-10-29 — S0a: harness, research ledgers, design, ADRs, prompts

**Done**
- Harness: Claude Code hooks (publishing guard, tool guard, per-edit doc check, Stop check, session brief), git hooks (pre-commit token scan, pre-push needs `ALLOW_PUSH=1` and scans history), `scripts/check_docs.py`, 86 pytest cases.
- Research: `docs/research/sources.yaml` (52 sources; 11 re-read by the orchestrator and marked `main-reread`), `docs/research/assumptions.yaml` (76 parameters graded S/P/D/A), `docs/research/README.md`.
- Re-reading the sources changed the design: neat-sample viability does not decline within the tested hold (A038–A040), so hold-time viability loss is a scenario knob, not the headline. The headline cases are "feed in the gap" (joining by measured time pairs a pre-feed value with post-feed process state) and offline pH used to re-standardise the online probe (S013).
- Design: `docs/design/simulation_spec.md`, `docs/design/data_model.md`.
- Decisions: ADR-0001 to ADR-0012, all `Proposed`.
- Prompts: `prompts/PRINCIPLES.md` (stage-by-stage principle combinations) plus master, S1, S2, author-track, review-rubric and external-review briefs.

**Open for the author (HITL)**
- Create the private backup repository and push (command given in chat; the AI does not push).
- Read ADR-0001 to ADR-0012; flip the ones you agree with to `Accepted`, write the decider's note, and commit that change yourself.

**Next (S0b, start a new session inside this repo)**
1. Confirm the hooks fire live (session brief, publishing guard, edit check, Stop check).
2. README (English first, Korean summary).
3. Infographic (`infographic/src` → `build.py` → `index.html`), headless QA script, private preview link.
4. Vault hub note.

## 2026-10-29 — S0a review round and rework

**Done**
- Three independent reviews (two Opus agents, one external codex `gpt-6.1-sol` xhigh); 31 findings, all accepted. Public summary: `docs/reviews/2026-10-29_s0a_review.md`.
- Harness: `check_all.sh --manual` gate, change detection by repository state (catches shell edits), tests in the gate, public-number check extended to `docs/research/README.md` with assumption → source tracing, ledger schema (range/unit, bundle components, weakest-grade rule), two more publishing commands blocked. 155 tests.
- Research: 118 assumptions (A077–A118 added), 56 sources; grades corrected (cell-free pH offset → P, vendor bead study → P, unsourced range ends marked); neat-sample viability wording corrected.
- Design: `data_model.md` is the naming authority; `hold_time`/`turnaround` defined once; `two_clocks` vs `write_time_keys` separated; as-of covers result versions and historian rows; S2 gates are structural forced-error fixtures, stochastic comparisons are reported, never gated; false-alarm rate and M/M/c step added.
- Prompts: design is the source of truth; `00_master_build.md` trimmed to invariants, gates, ownership and pointers; author-track cards aligned with `data_model.md`; untracked-aware commands; tool verdicts listed.

**Open for the author (HITL)**
- Private backup repository and first push (command in chat).
- ADR-0001 to ADR-0012: decide, write the decider's note, commit yourself.

**Open questions**
- The evaluator may read the truth world (needed to score); recorders and the decision layer may not. Recorded in `simulation_spec.md` observation contract.
- `scripts/check_docs.py` is 346 lines (target ≤300): split it in a structure-only commit at the start of S1.
- Before S0b puts numbers on a public page, the orchestrator must re-read the sources behind them (currently 11 are `main-reread`; new kinetics and precision sources S003, S053–S056 are `agent-read`).

**Next**: S0b in a new session started inside the repo.

## 2026-10-29 — Infographic, planned extensions, device output adapters

**Done**
- Infographic (`infographic/`, built from `infographic/src` by `build.py`): seven sections, English first with a Korean toggle, light/dark plus opt-in neon theme and story mode, two interactions (measurement-time slider, feature-flag outcome matrix). Headless QA (`scripts/qa_infographic.py`, 8 checks incl. SVG clipping) passes; private preview published.
- Planned extensions (ADR-0013, Proposed): per-reactor cell-line profiles, operating-mode profiles, break-out events (contamination/sterility failure) with the investigation walk-back; SC12–SC14; entities for material lots, deviations, quality holds and retro-flagging. Scheduled after S2.
- Device output adapters (ADR-0014, Proposed): a raw device layer between L3 and L4 — synthetic files and controller records modeled on public documentation (three analyzer dialects, two controller families), parsed into the canonical schema; no compatibility claims; no manual text or licensed schema files in the repository.
- Ledgers: 103 sources, 177 assumptions.

**Open for the author (HITL)**
- Private backup repository and first push.
- ADR-0001 to ADR-0014: decide, write the decider's note, commit yourself.
- ADR-0014 open question: preset A has no adapter (results typed by hand) — confirm or change.

**Open questions**
- S2 Step 7 (controller emitters) needs ledger entries first: logging deadband and maximum interval for tags other than agitation, gas-flow/pump/off-gas CO2 signal parameters, alarm acknowledgement time, pH/DO alarm deadbands (`simulation_spec.md` §2.4.8). Without them Step 7 stops and reports.
- Lot withdrawal schedule for SC12: now A187 (P); the time from a confirmed positive to the recall decision has no source (inside A176).
- Before any number from a non-re-read source goes on a public page, the orchestrator re-reads it.

## 2026-10-29 — Ready to start development (pre-S1 complete)

**Done**
- Author decisions recorded: preset A types results by hand (no adapter); a separate `capture_path` setting (manual_transcription / adapter_ingest) lets any preset switch, so automatic linkage can be compared on its own (ADR-0014, spec §5).
- Controller emitter inputs (A178–A187) and S1b process/logistics inputs (A188–A211) in the ledgers: 117 sources, 211 assumptions.
- README (English first, Korean summary); vault hub note and two MOC lines (vault left uncommitted for the author).
- `scripts/check_docs.py` split (structure only, behaviour proven identical).
- Independent readiness review: GO WITH FIXES; all 5 blockers and 12 fixes applied. S1 split into `prompts/10_S1a_contracts_analyzer.md` and `prompts/11_S1b_process_sampling.md`.

**State**: S1a can start now; S1b inputs exist. All gates pass (`bash scripts/check_all.sh --manual`).

**Open for the author (HITL)**
- Private backup repository and first push.
- ADR-0001 to ADR-0014: decide, write the decider's note, commit yourself.
- Vault: review and commit the new hub note and the two MOC lines.
- Author track (non-blocking): canonical DDL, three SQL queries, SimPy core loop (`prompts/60_user_track.md`).

**Next**: start a new session inside the repo; S1a Step 0 checks that the hooks fire live, then contracts and the analyzer DES.

## 2026-10-29 — ADRs accepted by the author

**Done**
- Guided review of ADR-0001 to ADR-0014; the author's answers are recorded verbatim in `docs/adr/review_2026-10-29.json`. Thirteen accepted as proposed; ADR-0013 accepted with a change: break-out events move to S3 (with the lab UI), cell-line and operating-mode profiles stay in S4.
- The author applied the record with `scripts/adr_accept.py` and committed it personally (`docs: accept ADR-0001 to ADR-0014`, no co-author trailer).
- ADR-0008 in effect: `LICENSE` (MIT, code) and `LICENSE-docs.md` (CC BY 4.0, text and figures); README and infographic footer updated; infographic roadmap shows break-out events in S3.

**Open for the author (HITL)**
- Private backup repository and first push.
- Vault: review and commit the hub note and the two MOC lines.
- Author track (non-blocking): canonical DDL, three SQL queries, SimPy core loop.

**Open questions**
- ADR-0013 leaves open whether break-out events need a ninth flag in ADR-0005; decide in S3.

**Next**: new session inside the repo → S1a Step 0.

## 2026-10-29 — S1a Step 0: live hooks (orchestrator)

**Done**
- SessionStart brief printed at session start (last progress entry; no `Proposed` ADR).
- Baseline before any change: `check_all --manual: PASS`; `uv run pytest -q` → `186 passed`; `check_docs --all: 78 files, 0 failure(s), 0 warning(s)`.
- `.claude/user_owned.txt` lists the five author paths. First Edit of the session → `.claude/.dirty` created by the PostToolUse hook.
- Live guard: `Write` on `reference/sim_core.py` → `BLOCKED by guard_tools: reference/sim_core.py is on the author's own implementation track (.claude/user_owned.txt)`. `git status --short -uall -- sql reference` empty.
- PDD: the Step 0 probe in `prompts/10_S1a_contracts_analyzer.md` now uses `Write`. The `Edit` probe as first written fails with `File does not exist` before any PreToolUse hook runs, so it could never show a denial. The author chose the `Write` probe.

**Next**: S1a Steps 1-8 by a Sonnet executor.

## 2026-10-29 — S1a: contracts, hand fixtures, L3 analyzer core (executor, uncommitted)

**Done**
- Scaffold, exact pins: TypeScript 6.0.3, typescript-eslint 8.72.1, ESLint 10.13.0 (+ @eslint/js 10.0.1), Vite 8.3.5, Vitest 5.0.5, pure-rand 8.4.2, json-schema-to-typescript 16.0.0, Ajv 8.20.0, @types/node 25.9.9 (nearest line to Node 25.6.1 from `.nvmrc`). Newer upstream exists only for TypeScript (7.0.2, outside typescript-eslint's peer range, kept at the brief's 6.0.3) and @types/node (26.x, not Node 25). Python via `uv add --dev`: simpy 4.1.2, jsonschema 4.26.0, duckdb 2.0.0. pytest marker `user_track` registered, default `-m "not user_track"`.
- Vitest 5.0.5 declares engines `^22.12 || ^24 || >=26`, so `.nvmrc` 25 is outside it: npm prints EBADENGINE, every test runs. The orchestrator may pin `.nvmrc` to 24 or 26.
- pure-rand install check: `xoroshiro128plus(seed)` in 8.4.2 takes a 32-bit seed (`seed | 0`), narrower than the 64-bit stream seed. The engine does not use it: it builds the generator from four 32-bit words with `xoroshiro128plusFromState`, taken from two successive splitmix64 outputs seeded with the stream seed. Nothing is truncated (test: seeds differing only in the high 32 bits give different words).
- Rework R2: the later-visit half of the seq rule is a named contract test, `Contract: queue policies and dispatch > a later visit re-enters the queue with its request's own seq: at an equal arrival instant it goes before a request with a higher seq` (green in the repo; red in a scratch copy under the mutation "later visit takes a new seq", the only failing test). The rerun half is `Contract: reruns > a qc_failed run re-enqueues the same sample as attempt + 1 at run.ended_at with a seq above every request seq`.
- Contracts as named tests (`engine/tests/contract/`), five schemas in `schemas/` with generated types (`npm run gen:types`, drift test), hand fixtures F1-F7 (19 cases incl. variants), their 19 exported traces, L3 core (`rng`, `clock`, `analysis`, `observe`, `trace`, `mmc`; largest 236 lines), invariants I1-I9 over 250 seeds, M/M/c check, author-track acceptance tests (`tests/user_track/`).

**Evidence**
- Red before code (modules were throwing stubs, schemas and golden files absent): `Test Files 11 failed (11) | Tests 93 failed | 16 passed | 4 skipped`; reasons: `not implemented` from the stubs (F1-F7 runner 51 failing tests, L3 rules 21, rng 10, clock 4, log identity 4, collision, invariants, M/M/c 1 each), ENOENT on `schemas/*.schema.json` and on `CHECKSUMS.txt`. Schema tests after the schemas: 27 passed, 1 failed (hidden-field table, `observe` still a stub), then green.
- Green: `npm run check` -> `Test Files 11 passed (11) | Tests 2265 passed`; `uv run pytest -q` -> `186 passed, 62 deselected`; `check_docs --all` -> `193 files, 0 failure(s)`; `check_all --manual: PASS`.
- M/M/c (seeds 1..100, 3 % band untouched): mean Wq 483.34 s, standard error 4.19 s (0.70 % above 480 s), measured utilisation 0.8004, 99 % interval [472.34, 494.34] s; 7 s runtime.
- Mutation spot checks, scratch copy only, each reverted: admission at `sampled_s` -> F1, F1b fail; window checked at the start time only -> F2-r2, F2-r3 (and F2b-r2) fail, I5 fails; setup left out of the pre-check -> F2b-r2 fails (also I5 and two parity traces); RNG key without `attempt` -> F3 "fresh noise" and I7 (234 of 250 seeds) fail.
- Planted violations, scratch copy only: ESLint reports `no-restricted-imports` (`node:fs`), `no-restricted-properties` (`Math.random`, `Date.now`), `no-restricted-syntax` (`new Date`), `no-restricted-globals` (`process`, `Buffer`); `check_all --manual` with a `Math.random` in `engine/src` fails ("Math.random found in engine/src"), and passes after removal.
- The two user_track files were exercised against throwaway stubs (an echo of `expected_result`, a minimal DDL) in the scratch copy only: 62 passed; a shifted start or a missing UNIQUE made the matching tests fail. Nothing was written under `sql/` or `reference/`. In the repo, `uv run pytest -m user_track -q` -> `1 passed, 61 skipped`.

**Golden files, created once** (workload seeds 1..20, engine 0.1.0, `tests/golden/parity/parity_01..20.json` + `CHECKSUMS.txt`, sha256, canonical JSON indent 2). Command, run from the repo root, never stored in a script:
`node --input-type=module -e "import { writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; import { runL3 } from './engine/src/analysis.ts'; import { exportTrace, toTraceResult, canonicalJson } from './engine/src/trace.ts'; import { makeWorkload } from './engine/tests/support/workload.ts'; const sums = []; for (let seed = 1; seed <= 20; seed++) { const input = makeWorkload(seed); const trace = exportTrace(input, toTraceResult(input, runL3(input).runs), 'ts-engine-golden'); const text = canonicalJson(trace, 2) + '\n'; const name = 'parity_' + String(seed).padStart(2, '0') + '.json'; writeFileSync('tests/golden/parity/' + name, text); sums.push(createHash('sha256').update(text).digest('hex') + '  ' + name); } writeFileSync('tests/golden/parity/CHECKSUMS.txt', sums.join('\n') + '\n');"`
The hand traces in `tests/fixtures/traces/` were exported once the same way from each hand fixture (`exportTrace(inputs, expected from the hand-typed runs, 'hand')`); a test keeps them in sync. A test verifies the checksums and fails if any file under `engine/`, `scripts/` or `tests/` writes under `tests/golden`.

**Modelling choices** (recorded as asked; none changes a design rule)
- No backfill: strict head of line. A run is checked against the windows of its analyzer over `[t, t + setup + service)`; windows never preempt a run.
- Seq: request seqs come from the input; every seq the engine assigns (window events, run-end events, dispatch, reruns) comes from one counter that starts above the largest request seq. A rerun therefore sorts after every first arrival at the same instant. Only relative order matters, so a SimPy model needs no matching counter values.
- A later visit and a rerun are scheduled as arrival events (priority 2) at `run.ended_at` plus `transfer_s` (rerun: plus 0), the later visit with the request's own seq, the rerun with a new one. `attempt` counts per visit.
- A method pair missing from the setup table is an input error. A visit without `method_id`, or an analyzer with nothing loaded, needs no setup.
- The log starts with a `log_header` event (schema_version, engine_version, seed), so the log hash depends on the seed even without noise. Rework R1: the name is now defined in `data_model.md` section 5 (engine events table) and referenced from `simulation_spec.md` section 3, rule 4, before the schema, as the source-of-truth order requires.
- Core-input extras that never enter a trace: `sampled_s`, window `kind` (`qc` default, `maintenance`), visit `analyte` (default: the group), `noise_sd`, `true_value` (default 0), top-level `dilution_factor` (`dilution_applied` is logged only when it is given, so a trace alone replays). Noise is Box-Muller from the stream keyed `(seed, request_id, analyte, attempt, "noise")`; no sd draws nothing.
- M/M/c drives the real L3 core and counts customers by arrival index 2,000..21,999 (not by departure order, which would bias the tail by the drain).

**Open questions**
- Spec section 9 rung 2 asks that the analytic mean lie inside the 99 % interval of the simulated mean; brief Step 7 fixes a 3 % band. Both are asserted (design wins; the brief's band is kept as the orchestrator fixed it). Both pass.
- Tolerance row: S1a has no real-valued truth state, so the 1e-9 rule has no call site yet (times are compared with `===`); a helper arrives with S1b.
- `.nvmrc` 25 versus Vitest's declared engines (above).
- SQL fixtures use state names from data_model section 6 (`closed`, `created`, `requested`, `measured`, `released`) and `UPDATE method SET version` as the K13 bad-data script; the author's CHECK lists and key design must accept them, or the test will say which one does not.

**Parked**
- A tolerance helper (`approxEqual`, 1e-9 and 1e-6) when L1 produces real-valued truth states (S1b).
- A way to run the core without building the log: not needed, the 100 M/M/c replications take 7 s.
- The trace schema cannot say "every visit group has an analyzer"; `runL3` checks it.

**Next**: orchestrator review and commits (structure-only: scaffold and config first, then behaviour); then S1b.

## 2026-10-29 — S1a review (orchestrator)

**Verdict**: PASS after one rework round (`prompts/90_review_rubric.md`, sections A-K).
- Orchestrator's own runs: `npm run check` → 2266 passed; `uv run pytest -q` → 186 passed, 62 deselected; `check_docs --all` → 193 files, 0 failure(s); `check_all --manual: PASS`; `uv run pytest -m user_track -q` → 1 passed, 61 skipped. Base commit unchanged by the executor; `sql/` and `reference/` untouched; ADR history check clean; goldens untracked and unmodified.
- F2b, F3 and F5 re-derived by hand from the brief's tables. Mutations in a scratch copy: RNG key without `attempt` → F3 and I7 fail; window checked at the start only → F2 and F2b rows and I5 fail; later visit given a new seq → the R2 contract test fails.
- Rework: R1 `log_header` had no design entry (`00` §2 item 11) → row in data_model §5 and a clause in spec §3 rule 4. R2 the later-visit seq rule had no named contract test → added in `engine/tests/contract/l3_rules.test.ts`. The parity goldens do not exercise that tie, so this test is its only guard.
- Commits: the Python dev dependencies and the `user_track` marker first, alone (green by themselves); the Node scaffold goes with the engine, because `npm run check` fails while `engine/` is absent.

**Parked (minor)**
- `engine/tests/support/mini.ts` has one call site (AHA); inline it when next touched.

**Open for the author**
- `.nvmrc` 25 is outside Vitest 5.0.5's declared engines (EBADENGINE warning; every test runs): keep it, or pin 24 or 26.
- Card C (`reference/sim_core.py`) and Card A (`sql/schema.sql`) can start; their acceptance tests are in `tests/user_track/`.

**Next**: S1b (`prompts/11_S1b_process_sampling.md`).

## 2026-10-29 — S1b: L1 process, L2 sampling, profiles, SC2 and SC5 (executor, uncommitted)

**Result**: after the rework round (below) every gate test is green: `npm run check` passes; the SC2 metric finding is reported, not gated. Base commit 8aeed08; nothing committed; Step 4 (golden event logs) not run.

**Done**
- Engine: `process` (L1 kinetics, cohorts, feed rule, shift, harvest), `sensors` (columnar series), `sampling` (L2), `stability`, `instrument` (drift, lot, bias, calibration), `measure` (the hook that decides what a run measures and how it ends), `profiles`, `scenario` (loaders), `run` (one scenario run), additions to `analysis` (the `measure` hook, window kind `closed`), `observe` (hidden fields), `trace` (`traceOfRun`), `clock` (`wholeSeconds`). Largest file 271 lines.
- Data: eight profiles under `scenarios/profiles/`, `scenarios/default.json`, `sc02_shift_burst.json`, `sc05_one_analyzer_down.json`; schemas extended additively (ten event types, `result_measured` hidden fields, profile `route` and `containers`, scenario `feedback`, `sampling_plan`, `label_method`, `maintenance`, `lot_changes`, `scripted_events`, `stability`); `data_model.md` section 5 names the new events and fields.
- The S1a evals are untouched: hand fixtures, 19 traces and the 20 parity goldens with `CHECKSUMS.txt` (`git status --short -uall -- tests/golden` is empty); `analysis.ts` without the hook behaves as before.

**Evidence**
- Red before code (stub modules throwing `not implemented`, the L3 core ignoring the new hook): `Test Files 11 failed (11)`, 15 tests failed one by one and 4 files failed at collection; 23 `Error: not implemented`, plus 3 hook tests red because the hook was ignored. The `Data:` schema tests were written after the JSON and schema edits and were green on first run.
- Green (after the rework round): `npm run check` -> `Test Files 24 passed (24)`, `Tests 2389 passed (2389)` (S1a baseline 2266); `uv run pytest -q` -> `186 passed, 62 deselected`; `check_docs --all` -> `0 failure(s)`; `check_all --manual` -> PASS. The first round had ended with SC2 red as the brief then worded it (a gated metric comparison): `Tests 1 failed | 2379 passed (2380)`, `AssertionError: expected 1622.4 to be less than 1602.55`.
- I12: start mark the line before `runScenario(cfg)`, stop mark the line after it returns (truth log, observable stream, sensor series, sample and run records complete); not measured: tick serialisation, JSONL, hashing, scenario loading. Median of 5 runs, seed 1: **57 ms** (69, 58, 57, 52, 53 ms) against the 1 s budget.
- Invariants I1-I10 on the default scenario, 200 seeds each (four full runs per seed: the run, a second run of a frozen input, a run without reruns, a run with a second sample on every weekday), I9 across two Node processes (seeds 1, 17, 200), I10 also on the micro-scale profile where the cap binds, I11, I8 also on the sensor ticks, the stream-seed collision test on the default scenario (200 seeds, more than 500,000 keys, no collision). A non-vacuity guard sits in I7 (at least 100 shared draws) and I8 (the perturbation must change something).
- SC2 and SC5 gate structural facts only (spec section 8; `00` section 2 item 8); their metric comparisons are in the report block below. In the first round both described tests asserted metrics. SC5 then needed two wording changes after its first run, kept here for the record: "nothing changes before the window" first compared samples that arrived before it (samples that arrived the evening before wait overnight and meet the open window), and the EDF relation first counted first attempts only (the due-today group gains through its reruns, which keep the request deadline).
- Mutation spot checks, scratch copy only, each reverted: a branch on a profile id in `engine/src` -> `scenarios_data.test.ts` "the profile-id grep ... is empty"; a recorder-side projection that keeps `noise` -> I8 (`invariants_s1b.test.ts`) and the HIDDEN_FIELDS-versus-schema test (`schemas.test.ts`); a stability effect beyond its range without `extrapolated` -> 3 tests of `stability.test.ts` and the in-run test of `instrument.test.ts`.

**Step 0 ledger result**: all 135 ids cited in spec sections 2 (without 2.4), 3, 4 and the SC1, SC2, SC5 rows resolve in the ledgers; `check_docs --all` passes. No value was invented. Items the ledger does not settle, and what the engine does:
- Molar masses of glucose (180.16) and lactate (90.08 g/mol) exist only in the notes of A082, A045 and A085: used as settings with the refs A082 and A085. A dedicated entry would be cleaner.
- Stationary-phase rates (A082 2.1, A083 0.56, the +0.24 lactate of A085) have no phase-boundary rule: the engine uses the exponential-phase values throughout and reads no stationary value. Blocked item, reported.
- The hold range of the open-sample pH offset and relaxation (A041, A042) is not in the ledger: that effect has no `valid_to`, so `extrapolated` is not evaluated for it. For the closed-sample drift (A043) the range covered is taken from A046 (30 min); the ledger does not say which hold S015 tested, so this is a judgement for review.
- No precision value for HPLC titer or for viability: no noise is drawn for them. The counter limit of A089 (15e6) has no dilution ladder (A090 is the all-in-one): not applied in the split profile.
- Several defaults are prose (A016, A018, A063, A188, A194, A201 to A206): their numbers were read off the default text and carry that id.

**Modelling choices** (none changes a design rule)
- L1 is a function of the scenario alone: no per-reactor draw, and a draw does not lower the culture volume (the budget only caps the cumulative sampled volume). Sensor ticks run from inoculation to harvest: about 0.83 million values for the default, against the 2.2 million the spec derives for all reactors over the full horizon.
- The state at a draw is the stored step plus a partial Euler step; a feed at 10:00 is part of the state from that instant. Initial dead cells follow from A211.
- Planned time: second sample uniform in the feed window, a first sample burst or uniform (A016, A202) or on the bay window of the staggered arm (all first samples, A203). Delay is half-normal with the staff profile's sd (A063), added to the plan and kept inside the staffed window. First samples start the day after inoculation; a draw at or after harvest is not planned.
- Label instant: pre-printed at the plan, issued at the draw and handwritten at the draw (the log order puts the handwritten one after `sample_drawn`).
- Hours outside the staffed window are L3 windows of kind `closed` that log nothing, so analysis happens only inside the roster (A201); a sample that arrives after closing waits for the next 08:30.
- Instrument: the drift walk moves at the integration step; a lot change adds +A093 percent; bias is uniform in +-A032 per analyzer from a keyed draw (none when 0); bias, drift and lot apply as a percent of the reading to relative analytes only. Calibration events at every interval from t0 to the horizon.
- Over-range: a reading above limit times the current dilution (ladder of A090 per visit) is `over_range` and the rerun takes the next rung; at the last rung the reading is accepted. `qc_failed` is drawn only for readings in range.
- Request ids equal sample ids (one request per sample); `analyzer_count` counts analyzers per route group; the S1b profiles have one method per group, so the setup table is empty.
- `feedback` defaults to false; `true` is refused by the run (experiment 2 is S2). `runScenario` accepts an L5 stub that it never calls.

**Open questions**
- **SC2 metric finding (reported, not gated; A203 stays as the author decided).** With the ledger settings the staggered arm does not lower the p90 `hold_time` (report block below: 1602.5 s burst against 1622.4 s staggered, staggered lower in 7 of 20 seeds). The diagnostics point to the second samples of the feed window (09:00-11:00, A194) that overlay the staggered windows (A203), and to transport (10 to 25 min, A018), whose p90 alone is about 1406 s of the 1600 s. The choice (change A203, A015 or the metric, or accept the finding) belongs to the author and the research role.
- Lactate reaches about 10 g/L at harvest because the exponential rate runs to the end (A084) and the lactate switch is off (A085); about 18 percent of the runs of the default scenario are over-range reruns at the 6 g/L limit (A089), so the rerun load is above the 13.5 percent baseline of A074. It needs the stationary-phase rule above or the switch.
- With A081 and A211 the viability rule (A013) harvests at about day 8, before the 14 d limit of A004; the 14 d is reached only when death is off.
- `engine/src/generated` was regenerated (`npm run gen:types`) after the schema edits; the drift test passes.

**Parked**
- A044 (settling bias) and A045 (in-tube change): graded A, off in the base scenarios, not built.
- Mini-scale class of the parallel profile (A066, 175 mL, 0.31 percent): needs a second profile file.
- A034 habitual assignment, delivery order of an autosampler rack, trainee share knob (A098), per-reactor parameter draws (S4), a second method and the setup table for HPLC contention (S4).
- The tolerance helper of S1a (`approxEqual`): L1 is real-valued now, but no engine call site needs it; the tests use `toBeCloseTo`.
- Step 4, the golden event logs, waits for the orchestrator's go-ahead. Parked from S1a and unchanged: `engine/tests/support/mini.ts` now has two call sites (`l3_rules.test.ts` and the new `l3_measure_hook.test.ts`); the `.nvmrc` 25 against Vitest's engines.

**Rework round 1** (orchestrator verdict REWORK, two majors)
- R1 (SC2 and SC5 gate structural facts only). `describe("SC2 shift-start burst")` has 4 `it`: every first sample of the staggered arm sits at its slot of its bay window (A203); the staggered plan uses no randomness while the burst plan does; the second samples are unchanged between the arms (same planned times, inside the feed window, never on a weekend); every draw lies inside the staffed window. `describe("SC5 one analyzer down")` has 5 `it`: runs that started before the window opens are identical with and without it (20 seeds); the log carries `maintenance_started` and `maintenance_ended` for AN-1 at 08:30 and 12:30 on day 8 and the QC window on both analyzers; no run occupies AN-1 inside the window and AN-2 keeps running; under FIFO and EDF each run takes the request the policy puts first (replayed log); the same samples and attempts run under both policies (and EDF reorders at least one run in the 20 seeds, a guard against a vacuous test). Green tail: `Test Files 2 passed (2)`, `Tests 9 passed (9)`.
- R2 (integer seconds). Named contract test `Contract: integer seconds from fractional parameters` (`engine/tests/contract/integer_time.test.ts`, 5 tests): fractional cohort interval 1.1 d and 20 more fractional instants and durations, maintenance, lot change and scripted event; every event time, tick, window, request, run, sample and reactor instant is an integer and the log validates against `event.schema.json`; the configuration holds whole seconds; a fractional integration step or cadence is refused. Red before the fix: `Tests 5 failed (5)`, `AssertionError: expected 123840.00000000001 to be 123840`. Green after: `Tests 5 passed (5)`. The fix converts every parameter-derived instant and duration once at load (`wholeSeconds`, floor(x + 0.5)) in `process`, `sampling`, `scenario`, `instrument`, `stability`; the shift day is now an offset in whole seconds.

**Metric report of SC2 and SC5** (not gated; seeds 1 to 20; mean, sd and min-max across seeds; the first round's tests asserted these and SC2 failed)
- SC2, per-seed p90 `hold_time` in seconds: burst arm mean 1602.5, sd 87.4, min-max 1467.0-1800.0; staggered arm mean 1622.4, sd 68.0, min-max 1519.0-1782.0. Staggered minus burst per seed: mean 19.9, sd 105.5, min-max -153.0 to 228.0; the staggered arm is lower in 7 of 20 seeds. p90 queue wait: burst 435.5 (sd 122.5), staggered 512.4 (sd 76.6).
- SC2 diagnostics, only to locate the cause, nothing changed in the scenario files. Second samples off: burst 1685.7 (sd 117.1), staggered 1568.3 (sd 37.2), difference -117.4 (sd 125.1), staggered lower in 18 of 20. Bay windows and offset 120 min: staggered 1434.1 (sd 17.4), difference to the ledger burst arm -168.4 (sd 89.9), lower in 20 of 20. Burst share 1.0 (all first samples in the burst): burst 1911.8 (sd 79.5), staggered (ledger) minus it -289.4 (sd 118.8), lower in 20 of 20.
- SC5, per-seed mean `hold_time` of the first attempt of samples that arrive 08:00 to 12:30 on day 8: no maintenance mean 1302.6 (sd 145.7, min-max 1119.2-1666.1); maintenance 2938.5 (sd 524.6, min-max 2184.3-4124.1); difference mean 1635.9 (sd 442.0, min-max 797.9-2728.5), higher with the window in 20 of 20 seeds.
- SC5, EDF against FIFO, every run of those samples, per-seed mean `hold_time`: due next day (drawn after 10:00) FIFO 3292.0 (sd 841.4), EDF 3571.0 (sd 1057.7), difference mean 278.9 (sd 254.9, min-max 19.3 to 945.0), EDF higher in 20 of 20; due today FIFO 3776.0 (sd 754.3), EDF 3721.1 (sd 733.7), difference mean -54.9 (sd 42.9, min-max -171.8 to -9.3), EDF lower in 20 of 20.
- I12, re-measured after the rework in a quiet run: median 78 ms of 5 (108, 82, 78, 70, 72 ms); the first round's 57 ms came from another moment, the variation between runs is within the budget by a factor of ten.

**Recorded by the orchestrator's adversary pass, not fixed in this round** (Open questions and Parked)
- F3: a bolus is applied on the integration grid, after the logged feed time (the event carries the nominal instant). F4: no viability noise (the ledger has no precision for it). F5: operator ids for `weekend_operators` 0 or above the roster size are not checked. F6: `rerun_probability` outside the A088 range [0, 0.1] is not rejected, and 1 loops forever. F7: no closed window after the horizon plus one day. F8: the molar-mass refs point at A082 and A085, whose defaults are other quantities, so they need ledger entries of their own. F9: unit checks for limits, absolute sd and offsets are missing. F10: the split profile names its analyzers AN-1 to AN-4 by group order, which is not the AN-1 of SC5. F11: I5 uses the engine's own windows and I7 stops at the first rerun.
- The observable sensor series: `sensors` carries the process value and the truth together; S2 needs a process-value-only stream before any recorder reads it. A041 and A042 have no source time range; A043's range is taken from A046. The stationary-phase rates are not used (A011 has one rate; the item is not blocked).
- The default L1 trajectory (all batches harvested by the viability rule at about culture day 8, lactate up to about 9.75 g/L at zero glucose, 58 of 323 runs over-range in seed 1) is a design and ledger question for the author (A081 applied from day 0, no lysis, the A050 trigger at the A010 floor, lactate not gated by glucose). Kinetics, rules and scenario values were not changed for it.

**Next**: the orchestrator re-checks R1 and R2, the author takes the SC2 finding and the L1 trajectory question, then `sim-adversary` once more if the orchestrator wants it, then Step 4.

## 2026-10-29 — S1b review (orchestrator)

**Verdict**: PASS for the S1b engine after one rework round (`prompts/90_review_rubric.md`, sections A-K, and one `sim-adversary` pass). Step 4 (golden event logs) is not run: it waits for the L1 calibration below.
- Orchestrator's own runs: `npm run check` → 24 files, 2389 passed; `uv run pytest -q` → 186 passed; `check_docs --all` → 229 files, 0 failure(s); `check_all --manual: PASS`; `tests/golden`, `sql/` and `reference/` unchanged; base commit unchanged by the executor; rubric greps clean (no `Math.random`/`Date`, no profile or scenario id in `engine/src`, numbers in `engine/src` are unit conversions only).
- Mutations in a scratch copy: integer conversion of the cohort interval removed → 4 tests of `Contract: integer seconds from fractional parameters` fail (`expected 123840.00000000001 to be 123840`).
- First round: SC2 failed its metric assertion (reported above). The brief asked for metric relations as gates, which spec §8 and `00` §2 item 8 forbid; the orchestrator corrected `prompts/11_S1b_process_sampling.md` (PDD) so scenario tests gate structural facts and metrics are reported. The author kept A203 as it is and chose to report the finding.
- `sim-adversary` (Opus, high): no truth leak, every key on the canonical 5-tuple. Majors: F1 implausible default L1 trajectory (reproduced by the orchestrator, see the executor's entry); F2 fractional event times from a fractional parameter (fixed in rework, R2). Minors F3-F11 are recorded in the executor's entry.

**Decision (author, 2026-10-29)**: L1 calibration is a separate step before the goldens: verify public sources (A050 trigger against S110, an early-phase death or lysis term against A081 and A011, lactate when glucose is exhausted), propose the spec §2.1 and ledger changes, implement after the author approves, then Step 4.

**Open for the author**
- A Proposed ADR on mixed fleets (per-bay bioreactor profiles, per-analyzer profiles, additive schema fields), decided 2026-10-29 to follow S1b; implementation in S3 or S4.

**Next**: L1 calibration (sources, then the design proposal for the author).

## 2026-10-29 — S1b: L1 calibration (executor, uncommitted)

**Result**: the L1 changes the author approved on 2026-10-29 are in (spec and ledger first, then tests, then code); every gate is green. Base commit dad4f2d; nothing committed; Step 4 (golden event logs) not run; no ADR touched. The metrics below are reported, not gated, and no value was tuned to reach a range.

**Done**
- Spec 2.1 rewritten: logistic ceiling (Xmax = the A008 default), growth mu = mu_max x m_T x phi, phi = g / (Ks + g) x max(0, 1 - X / Xmax) with no temperature factor, death kd = (kd_min + (kd_late - kd_min) x (1 - phi)) x m_T,kd, mass balance (uptake capped by what is present, lactate = A084 x X x phi, glucose uptake at the A082 exponential value throughout, stationary values unused), predictive feed rule with its derivation, scripted feeds keep A192.
- Ledger: A212 new (kd_min 0.0013 per h, range 0.0010-0.0016, grade S, S118); A081 notes (kd_late), A008 (carrying capacity), A011 (default, notes, sources S053 S054 S056 S118; the coupling form is a simulator choice, grade A), A013 (sources S114 S119, value unchanged), A050 (predictive rule, derivation), A084 and A192 (one sentence each), A109 (open question: the caption and the text of S056 give different Ks). S118 (Kroll et al. 2017) and S119 (Mahe et al. 2022) added, both `agent-read`; title, journal and pages checked against CrossRef.
- Code: `engine/src/process.ts` (282 lines): `advance` (phi, coupled death, capped uptake, lactate x phi), `ruleShare` (the rule's bolus share f = max(0, (floor + D - g) / (C - floor)), D = A082 x X x glucose molar mass per day), `bolus` takes the share, scripted feeds pass the fixed A192. New settings in the three scenarios: `carrying_capacity_e6_per_ml` (A008), `early_death_per_h` (A212); `death_per_h` renamed `late_death_per_h` (A081). Input checks: feed glucose above the floor, carrying capacity positive.
- Tests: `engine/tests/process_calibration.test.ts` (new, 23 tests); `process.test.ts` and `sampling.test.ts` updated where the old closed forms no longer hold (a constant death rate, no ceiling, the fixed rule bolus); a `NO_DEATH` helper in `tests/support/scenarios.ts`.

**Evidence**
- Structure-only step first (rename, the two new settings read but unused, `advance` exported): `process.test.ts` and `sampling.test.ts` 36 passed.
- Red (new and updated tests against the old model): `Test Files 2 failed (2) | Tests 14 failed | 25 passed (39)`. Reasons, each by value: constant death `expected 9.979 to be close to 9.9935` (phi = 1), no ceiling `expected 20.441762597984322 to be close to 19.958`, lactate not tied to growth `expected 0.3431633333333333 to be 0.3` (no glucose) and `expected 14956 to be +0` (lactate rises in steps that start with zero glucose), fixed bolus `expected 0.048 to be close to 0.002004008016032064`.
- Green: `npm run check` -> `Test Files 25 passed (25)`, `Tests 2412 passed (2412)` (before: 24 files, 2389); `uv run pytest -q` -> `186 passed, 62 deselected`; `check_docs --all` -> `231 files, 0 failure(s)`; `check_all --manual: PASS`. `git status --short -uall -- tests/golden tests/fixtures sql reference` is empty: the hand fixtures, traces and parity goldens are byte-identical.
- Hand values: one step of 3600 s (dt = 1 h). phi = 1: x = 10 - 0.0013 x 0.5 x 10 = 9.9935. Ceiling (X = Xmax = 20): x = 20 - 0.0042 x 0.5 x 20 = 19.958. No glucose: x = 5 - 0.0042 x 0.5 x 5 = 4.9895 and lactate unchanged. phi = 0.25 (g = Ks, X = 10): mu = 0.027 x 0.5 x 0.25, kd = 0.0013 + 0.0029 x 0.75, x = 9.999. Bolus for X = 10, g = 4 at inoculation: g at the first decision = 4 - 4.504 x 2/24 = 3.62467, f = (1.0 + 4.504 - 3.62467) / 499 = 0.0037662, which brings glucose one day later to the floor (checked one step before the decision). The prediction 0.01 g/L above the floor feeds nothing, 0.01 below feeds 0.01 / 499.
- Gate on the default scenario: glucose, glutamine, lactate, titer and cells are never negative or not finite, and lactate never rises in a step that starts with zero glucose. The default scenario never runs dry (zero such steps), so the relation is also checked on the same scenario with the glucose floor at 0, where 8,556 such steps exist; a test asserts that they exist.
- Mutations, scratch copy only, each reverted: lactate without phi -> 4 tests fail; no ceiling -> 5; uptake not capped -> 5; old trigger rule at the floor -> 5; bolus without dilution (denominator C) -> 5; temperature inside phi -> 3.

**Trajectory of the default scenario** (L1 has no RNG draw, so the trajectory is the same for every seed, as a test shows; the spread over the 24 reactors comes only from the inoculation minute against the 10:00 clock of decisions and shift; min / median / max over the 24)

| Quantity | Result | Source range it can be compared with |
|---|---|---|
| Peak VCD | 11.48 / 11.51 / 11.55 e6 cells/mL | A008: 10-30e6 |
| Culture day of the peak | 12.03 / 12.05 / 12.08 (the last value before harvest: cells are still increasing) | S053 tmax 8.4-9.6 d |
| Harvest day, cause | 12.03 / 12.05 / 12.08; rule 24 of 24, none reached the 14 d limit | A004 14 d |
| Viability at harvest | 78.83 / 78.88 / 78.97 % | S119 day 14: 90.3 +/- 3.8 % (standard fed-batch; its other arms were read once and not re-checked); S114 harvest below 60 % |
| Minimum glucose | 0.793 g/L in all 24; 580-584 min per reactor below the 1.0 g/L floor, never zero | A010 floor 1.0 g/L |
| Maximum glucose | 8.00 g/L (the initial value; no bolus raises it higher) | |
| Maximum lactate | 7.09 / 7.11 / 7.14 g/L | S056 at most 1.0 g/L |
| Feeds, volume | 8 rule feeds per reactor, 0.120-0.122 L each reactor, 2.912 L in all | |
| Seed 1, whole scenario | 449 runs, 51 over_range (11.4 percent) | before: 58 of 323 (18.0 percent); A074 baseline 13.5 percent |

Before the calibration (entry above): harvest at about day 8, lactate about 9.75 g/L. The ceiling factor at the peak is 1 - 11.5/20 = 0.42, so the carrying capacity is not what stops growth: the Monod term, the shift (growth x 0.5 from day 4) and death are.

**Metric report of SC2 and SC5, re-run** (not gated; seeds 1 to 20; sample sd; the same script reproduces the first-round figures exactly on dad4f2d, e.g. burst 1602.5 / 87.4 / 1467.0-1800.0)
- SC2, per-seed p90 `hold_time` in seconds: burst arm mean 1547.8, sd 61.1, min-max 1448.0-1676.0; staggered arm mean 1508.8, sd 29.9, min-max 1479.0-1579.0. Staggered minus burst: mean -38.9, sd 62.0, min-max -153.0 to 55.0; the staggered arm is lower in 14 of 20 seeds (before: 7 of 20). p90 queue wait: burst 390.9 (sd 66.7), staggered 358.8 (sd 38.3).
- SC5, per-seed mean `hold_time` of the first attempt of samples that arrive 08:00 to 12:30 on day 8: no maintenance mean 1169.4 (sd 88.4, min-max 1041.6-1366.1); maintenance 1900.6 (sd 380.7, min-max 1303.4-2581.7); difference mean 731.2 (sd 337.5, min-max 150.5-1382.1), higher with the window in 20 of 20.
- SC5, EDF against FIFO, every run of those samples: due next day (drawn after 10:00) FIFO 1229.2 (sd 154.2), EDF 1233.7 (sd 165.9), difference mean 4.5 (sd 20.1, min-max 0.0 to 90.0), EDF higher in 1 of 20; due today FIFO 2131.4 (sd 477.2), EDF 2129.9 (sd 476.9), difference mean -1.4 (sd 6.5, min-max -28.9 to 0.0), EDF higher in 0 of 20. The EDF cost of the first round (+278.9 s for the next-day group) is not reproduced: the policies now rarely differ. The cause was not diagnosed here (the harvest day moved from about 8 to about 12, which changes the sample load on day 8).
- I12: median of 5, seed 1, start mark before `runScenario(cfg)`, stop mark after it returns: 78 ms (85, 78, 78, 75, 78) after one warm-up, 449 runs and 7,874 events; the test itself passes. The first-round figures were 57 ms and 78 ms.

**Modelling choices** (for review; none changes a design rule)
- The consumption D of the rule uses the viable density before the bolus; the bolus then dilutes cells and glucose together, so the predicted glucose is (g + f C - D) / (1 + f). This is the dilution-consistent form and gives a closed formula; S114's Eq. 9 has no dilution term.
- The rule's bolus is exact up to floating point: when nothing is consumed (a test case) the next decision feeds a remainder of order 1e-16 L.
- The lactate production in a step uses phi at the start of the step, like growth and death (explicit Euler); it is not scaled by the share of the glucose demand that was actually met in a capped step.
- Lysis is not modelled (spec 2.1). Dead cells therefore accumulate and viability falls even while the viable density is still rising, which is why the harvest rule fires on day 12.

**Open questions**
- Lactate reaches about 7.1 g/L against at most 1.0 g/L in the batch cultures of S056 (and 1.35-2.25 g/L in S074): production follows growth (phi) and the lactate switch (A085) is off, so lactate accumulates for as long as glucose lasts. No source supports this magnitude; the choice (switch on, a stationary-phase production rule, or accept) is the author's.
- Viability at harvest is just under the A013 threshold on day 12 and below the 90.3 +/- 3.8 % of the S119 standard fed-batch on day 14; the day-14 limit is still not reached. Whether to add lysis, change A013, or accept belongs to the author and the research role.
- The default scenario keeps glucose below the 1.0 g/L floor for about 580 min per reactor (minimum 0.79 g/L) because the rule projects no growth; it never reaches zero.
- The fact-check of the S118 and S119 quotes confirmed every number; four wordings were changed (see Fact-check round).

**Parked**
- `docs/research/README.md` line 41 still says "first-order death" and its table does not list A212; the A190 note ("the first bolus (A050) is due around day 4") describes the old rule and ignores the Monod term. Both are outside this call's scope.
- A050 cites S114 in its notes and not in its `sources` field: the public pages that cite A050 (`docs/research/README.md`, `infographic/index.html`) may use `main-reread` sources only, and S114 is `agent-read`; with S114 in the field the public-number rule of `check_docs` (`scripts/ledger_rules.py`) would flag those lines. It moves into the field when S114 is re-read.
- S118 and S119 need a `main-reread` of the quoted passages before a public number may use them (S118: section 3.2, the constant kD of 1.3e-3 per h up to 180 h; S119: the day-14 viabilities).
- Per-reactor parameter draws (S4) would make the 24 trajectories differ; today they are the same curve shifted by the inoculation minute.
- Structure-only versus behaviour paths. Structure-only (no behaviour change; after this step the process and sampling test files were green, the full suite was run only after the behaviour step): `scenarios/default.json`, `scenarios/sc02_shift_burst.json`, `scenarios/sc05_one_analyzer_down.json` (rename to `late_death_per_h`, the two new settings), `engine/tests/support/scenarios.ts`, `engine/tests/sampling.test.ts`, and the rename, the new config fields and the `export` hunks of `engine/src/process.ts` and `engine/tests/process.test.ts` (interleaved with behaviour hunks: `git add -p`). Behaviour: the remaining hunks of `engine/src/process.ts` and `engine/tests/process.test.ts`, `engine/tests/process_calibration.test.ts`, `docs/design/simulation_spec.md`, `docs/research/assumptions.yaml`, `docs/research/sources.yaml`, `docs/progress.md`.

**Fact-check round** (wording only; no value changed; S118 and S119 stay `agent-read`)
- S053 and A081, A011, spec 2.1: kd max is described as S053's parameter a2, analogous to the maximum death rate of a logistic fit to viable cell density; using it as the death rate when growth is fully limited is a simulator choice. The words "late-phase net decline" are gone. A081 keeps grade S for the sourced range; the use is the grade-A structure of A011.
- S118, A212, A011, spec 2.1: 1.3e-3 per h is from section 3.2 (lysis taken into account, approximately constant up to 180 h). The section 3.3 sentence on the rise after 120 h is stated as a correlation only and is not offered as support for the coupling, whose form stays unsourced (grade A).
- S056: the lactate consumption condition is "after the maximum cell concentration was achieved" (glucose depletion only approximately coincided). The new text of this call never said otherwise, but the existing S056 `supports`, A085 and A123 notes said "once glucose was depleted"; I corrected those three sentences and a fourth in the notes of the operating-mode profile ("after glucose depletion"), although the entries were not on the call's list.
- S119 and A013, spec 2.1: no "fed daily" wording exists; the source added glucose from the daily measurement, to 6 g/L at a 4 g/L trigger, in ambr15 microscale cultures. Only 90.3 +/- 3.8 % (standard fed-batch, day 14) is quoted as confirmed; 82.2, 86.3 and 80.5 % are marked as read once and not re-checked. The comparison range of the trajectory table is 90.3 +/- 3.8 % accordingly.

**Next**: the orchestrator reviews and applies the fact-check result; the author decides the lactate and viability questions; then Step 4 (golden event logs).

## 2026-10-29 — S1b L1 calibration review (orchestrator)

**Verdict**: PASS after one rework round (wording only). Approved by the author on 2026-10-29 as proposals 1-5 (logistic ceiling, death coupled to growth limitation, mass balance with lactate tied to growth, predictive daily feed, harvest-rule sources).
- Orchestrator's own runs: `npm run check` → 25 files, 2412 passed; `uv run pytest -q` → 186 passed; `check_docs --all` → 0 failure(s); `check_all --manual: PASS`; `tests/golden`, `tests/fixtures`, `sql/`, `reference/` unchanged. Default trajectory reproduced with the adversary's script: harvest by the viability rule at culture day about 12.1 (was about 8.1), glucose minimum 0.79 g/L and never zero, lactate maximum 7.14 g/L, 192 feeds, 51 of 449 runs over-range in seed 1.
- Fact-check (`fact-checker`, Sonnet): every number confirmed; four wordings were wrong and are corrected (S053 kd max is a parameter "analogous to the maximum death" rate, not a late-phase rate; the 120 h sentence of S118 is a correlation in section 3.3 and no basis for the coupling; S056 consumption follows the maximum cell concentration; S119 confirmed only for 90.3 ± 3.8 % on day 14). The executor also corrected the same S056 wording in S056, A085 and A123; accepted.
- Remaining gap, reported not tuned: lactate is 3 to 7 times the source maxima (0.9 to 2.3 g/L), which drives the over-range reruns; the lactate term of proposal 3 omits the temperature factor although S056 ties production to the rate of growth.

**Decision (author, 2026-10-29)**: calibrate lactate as its own step before the golden event logs.

**Next**: lactate sources (in progress), proposal for the author, implementation, then Step 4.

## 2026-10-29 — S1b: lactate calibration (executor, uncommitted)

**Result**: plan A of the author (2026-10-29) is in, spec and ledger first, then tests, then code; every gate is green. Base commit 790c5bd; nothing committed; Step 4 (golden event logs) not run; no ADR touched. The metrics below are reported, not gated, and no value was tuned to reach a range.

**Done**
- Spec 2.1: lactate production is A084 x X x (mu / mu_max) = A084 x X x m_T,mu x phi (the temperature multiplier of A196 is now inside it); the lactate switch (A085) is on by default: from culture day 7 the net rate is -0.15 pmol/cell/d x X, it replaces production, does not depend on glucose, and lactate never goes below zero; a scenario can switch it off. Sources for the onset days, the counter-cases and the known limitation of the growth course (peak at about culture day 12 against 7.5-9.6 in the sources; no quantitative end-of-growth rule; the candidates that would move it were not used) are in the section.
- Ledger: A011 (form, limitation), A080 (default is S053's Combs culture, temperature conditions not confirmed; the stale "temperature shifts are not modelled" now points to A196), A084 (net rate from the sign convention, the 0.79 against 2.34 / 2.49 = 0.94 discrepancy, parent maximum density under about 6.5e6 cells/mL), A085 (default on, onset sources and counter-cases, grade A for the default), A086 (open question below), A123 (trigger candidates: growth deceleration, glutamine depletion; sources gain S121), A195 (density trigger S113), A196 (S122 for growth x 0.5, S120 on per-cell lactate; "lactate rates unchanged" deleted, glucose and glutamine per-cell rates unchanged). New sources S120 Nam et al. 2009, S121 Brunner et al. 2017 (print 2018; online 2017-12-19), S122 Matsuoka et al. 2013, all `agent-read`; title, journal, volume and pages checked against CrossRef. `used_in` of S110 and S114 gained A085 (A085 now lists them as sources).
- Code: `engine/src/process.ts` (292 lines): `advance(c, s, m, dt, age_s = 0)` with the lactate rule above, the age taken at the start of the step in `simulate` and `stateAt`; `ProcessConfig` gains `lacOn`, `lacOnset_s`, `qLacNet`, read from three new scenario settings with ref A085 (`lactate_switch_on` unit flag, `lactate_switch_day` d, `lactate_net_rate_pmol_per_cell_d`) in the three scenarios; a switch other than 0 or 1 or a negative day is refused.
- Tests: `engine/tests/process_lactate.test.ts` (new, 21 tests); two existing expectations changed because L1 and L2 change them (below).

**Evidence**
- Structure-only step first (settings read and validated, unused): `process`, `process_calibration`, `sampling`, `scenarios_data` tests 82 passed, `tsc` clean.
- Red (new tests and the updated one against that code): `Test Files 2 failed (2) | Tests 12 failed | 32 passed (44)`. Reasons, each by value: no growth multiplier in lactate `expected 0.38632666666666665 to be close to 0.3431633333333333`; production at the onset instead of the net rate `expected 0.38632666666666665 to be close to 0.29436999999999997`; no consumption and no clamp `expected 0.039668159761104896 to be +0`; whole run lactate flat `expected 0.5 to be close to 0.36488`; structural gate `expected 174660 to be +0` (174,660 steps with a rise after day 7).
- Green: `npm run check` -> `Test Files 26 passed (26)`, `Tests 2434 passed (2434)` (before: 25 files, 2412); `uv run pytest -q` -> `186 passed, 62 deselected`; `check_docs --all` -> `232 files, 0 failure(s), 0 warning(s)`; `check_all --manual: PASS`. `git status --short -uall -- tests/golden tests/fixtures sql reference` is empty.
- Hand values (one step of 3600 s, X = 10, 90.08 g/mol): production phi = 1: 0.3 + 0.207184 x 10 / 24 = 0.38632667; after the shift (m_T = 0.5): 0.3 + 0.5 x 0.207184 x 10 / 24 = 0.34316333; net step: 0.3 - 0.15 x 10 x 0.09008 / 24 = 0.3 - 0.00563 = 0.29437; whole run without growth, glucose use or production, 0.5 g/L at X = 10: 0.5 until day 7, 0.5 - 0.13512 = 0.36488 on day 8, 0 from day 11 (0.5 / 0.13512 = 3.7 d).
- Mutations, scratch edits of `process.ts`, each reverted (file identical afterwards): no growth multiplier in lactate -> 3 tests fail; no phi -> 4; no clamp -> 3; onset exclusive -> 6; flag ignored -> 3; production added to the net rate -> 5; age of the step end -> 2; `stateAt` without the age -> 1; switch day read as hours -> 6.
- Gate on the default scenario: after culture day 7 lactate never increases in any reactor (the check has steps and falls; with the switch off it does rise, so the relation belongs to the switch).

**Changed existing expectations** (each because L1 or L2 changes it)
- `process_calibration.test.ts`, the phi = 0.25 lactate test: "whatever the temperature multiplier" became half the rise after the shift (0.3 + 0.207184 x 10 x 0.25 x 0.5 / 24).
- `scenario_trace.test.ts`, the default-scenario schema test: `dilution_applied` is no longer in the kinds the default run must log (the default culture has no over_range any more, see the table); a new test starts a small culture at 8 g/L lactate, above the 6 g/L limit (A089), and validates its `dilution_applied` and over_range `rerun_requested` events.

**Trajectory of the default scenario** (L1 has no RNG draw, so the trajectory is the same for every seed; min / median / max over the 24 reactors; growth and death do not depend on lactate, so the growth rows equal the L1 entry above)

| Quantity | Before (790c5bd) | After | Source range it can be compared with |
|---|---|---|---|
| Peak VCD | 11.48 / 11.51 / 11.55 e6 cells/mL | same | A008: 10-30e6 |
| Culture day of the peak VCD | 12.03 / 12.05 / 12.08 | same | S053 tmax 8.4 and 9.6 d; S121 between day 7.5 and 8.5 |
| Peak lactate | 7.09 / 7.11 / 7.14 g/L | 2.60 / 2.61 / 2.62 g/L | S056 at most 1.0 g/L; Ruhl 0.9 g/L (not in the ledger); S074 15-20 mmol/L = 1.35-1.80 g/L (CD CHO fed-batch); A089 analyzer limit 6 g/L |
| Culture day of the peak lactate | 12.03 / 12.05 / 12.08 (the harvest) | 7.00 in all 24 (the onset: production before, net consumption after) | |
| Lactate at harvest | 7.09 / 7.11 / 7.14 g/L | 1.84 / 1.84 / 1.85 g/L | same |
| Harvest day, cause | 12.03 / 12.05 / 12.08, rule 24 of 24 | same | A004 14 d |
| Viability at harvest | 78.83 / 78.88 / 78.97 % | same | S119 day 14: 90.3 +/- 3.8 % (standard fed-batch) |
| Seed 1: runs, over_range (by analyte) | 449, 51 (lactate 51) | 398, 0 | A089: lactate 6 g/L, glucose 15 g/L |

The peak lactate is 2.6 to 2.9 times the S056 and Ruhl maxima and 1.4 to 1.9 times the S074 range: still above all three. The peak sits on the switch day by construction (production rises until day 7, the net rate then lowers it); it is not a source result. Reported, not tuned.

**Metric report of SC2 and SC5, re-run** (not gated; seeds 1 to 20; sample sd; the same script as the L1 entry above)
- SC2, per-seed p90 `hold_time` in seconds: burst arm mean 1506.7, sd 45.7, min-max 1429.0-1636.0; staggered arm mean 1464.9, sd 14.3, min-max 1435.0-1494.0. Staggered minus burst: mean -41.8, sd 41.6, min-max -161.0 to 12.0; the staggered arm is lower in 18 of 20 seeds (L1 entry: 14 of 20). p90 queue wait: burst 337.5 (sd 71.6), staggered 232.8 (sd 31.7).
- SC5, per-seed mean `hold_time` of the first attempt of samples that arrive 08:00 to 12:30 on day 8: no maintenance mean 1169.4 (sd 88.4, min-max 1041.6-1366.1); maintenance 1900.6 (sd 380.7, min-max 1303.4-2581.7); difference mean 731.2 (sd 337.5, min-max 150.5-1382.1), higher with the window in 20 of 20. EDF against FIFO, every run of those samples: due next day FIFO 1229.2 (sd 154.2), EDF 1233.7 (sd 165.9), difference mean 4.5 (sd 20.1, min-max 0.0 to 90.0), EDF higher in 1 of 20; due today FIFO 2131.4 (sd 477.2), EDF 2129.9 (sd 476.9), difference mean -1.4 (sd 6.5, min-max -28.9 to 0.0), EDF higher in 0 of 20. The SC5 figures equal the L1 entry's to the last digit; not diagnosed (the SC2 figures, over the whole run, did change).
- I12: median of 5, seed 1, after one warm-up: 79 ms (86, 84, 77, 77, 79), 398 runs, 394 samples and 7,211 events; `perf_i12.test.ts` passes.

**Modelling choices** (for review)
- mu / mu_max is implemented as m_T,mu x phi, not as a division, so a scenario with mu_max at 0 still produces lactate from phi (the existing process tests rely on it).
- The age is taken at the start of the step, the onset is inclusive (age 7 d exactly uses the net rate, one second before it uses production), and `stateAt` inside a step uses the age of the stored step it starts from, like the shift multipliers.
- The net rate is not scaled by glucose or temperature and does not return to production later (S110 cell line 1 produced lactate again after day 7).
- A bolus dilutes lactate as before; lactate at 0 stays at 0.

**Open questions**
- The peak lactate of 2.6 g/L is above the S056, Ruhl and S074 ranges (table). The growth course is the larger known gap (peak at about day 12 against 7.5 to 9.6 days in the sources, no quantitative end-of-growth rule); the author decides whether the research role looks for one.
- A086 (S054 productivity): the supports text of S054 gives 1.7-2.7 pg/cell/d from the flask values only; the 2 L values differ (PYC2 2.21, parent 2.86). Recorded in the A086 notes, not resolved.
- A084: the printed parent lactate/glucose ratio 0.79 against 2.34 / 2.49 = 0.94 (S054 Table 2) is not resolved by the source.
- Open question for S4: with A085 on by default the platform line already switches to net consumption on day 7, so the `lactate_consumer` clone of the cell-line extension (A151, A123, spec 11.2 and 11.3, SC13) is no longer the only line that consumes. The SC13 design needs a decision: a consumer clone that differs by onset and rate (the spec 11.3 row now says so), or the platform switched off in that scenario.

**Parked**
- `docs/research/README.md` line 157 and the `lactate_consumer` and `high_lactate_producer` rows of spec 11.2 were not changed (line 157 says only that the switch is an assumption; the clone rows stay valid as onset and rate differences).
- The S074 sentences of the `supports` text in `sources.yaml` and of A122 ("one of eight clones ... 25 mmol/L") were not re-checked against the S074 fact-check.
- S120, S121 and S122 need a `main-reread` of the quoted passages before a public number may use them. The molar-mass refs (F8 above) are untouched.
- Step 4, the golden event logs, waits for the orchestrator's go-ahead.
- Structure-only versus behaviour paths. Structure-only (no behaviour change; settings read and validated, unused; related tests green before and after): `scenarios/default.json`, `scenarios/sc02_shift_burst.json`, `scenarios/sc05_one_analyzer_down.json`, and the `ProcessConfig` and `processConfig` hunks of `engine/src/process.ts` (interleaved with the behaviour hunks: `git add -p`). Docs first, as in the L1 step: `docs/design/simulation_spec.md`, `docs/research/assumptions.yaml`, `docs/research/sources.yaml`. Behaviour: the `advance`, `simulate` and `stateAt` hunks of `engine/src/process.ts`, `engine/tests/process_lactate.test.ts`, `engine/tests/process_calibration.test.ts`, `engine/tests/scenario_trace.test.ts`, `docs/progress.md`.

**Rework round 1** (orchestrator verdict REWORK, docs only, no code or value change)
- R1: spec 11.3 row "Lactate consumption", `docs/research/README.md` line 43 and the table row of line 118 now say that A085 is on by default (net -0.15 pmol/cell/d from culture day 7, grade and "provisional" wording kept); the spec row adds that consumer clones differ from the platform by onset and rate, not by switching on. The SC13 question is recorded above as an open question for S4.
- R2: the S074 sentence of A123 now reads "in CD CHO medium lactate of 15-20 mmol/L remained stable for 3-4 days and then decreased slowly towards the end of the culture, and the decrease coincided with glucose depletion; in the mAb1 panel of eight clones, two clones, C3 and C8, are named as staying flat in fed-batch, and the source gives no count of flat clones (S074)".
- `check_docs --all` and `check_all --manual`: see the report.

**Next**: the orchestrator reviews, the fact-checker goes over the new wordings, the author decides the SC13 clone design and the growth-course question; then Step 4.

## 2026-10-29 — S1b lactate calibration review (orchestrator)

**Verdict**: PASS after one rework round (docs only). Plan A approved by the author on 2026-10-29: lactate production follows the actual growth rate including the temperature multiplier; A085 on by default (net -0.15 pmol/cell/d from culture day 7, replacing production); growth course unchanged, A196 now cites S122 for growth x 0.5, and the late peak is a known limitation.
- Research before the plan: the growth course has no sourced fix. No source supports double counting of the shift in A080; the only number for the shift effect (S122, constant temperature, ratio 0.53) matches A196; every candidate that would move the peak to days 7.5-9.6 (age stop at a tmax, growth x 0.2, another Xmax) is a value picked to hit the range and was not used.
- Fact-check (`fact-checker`, Sonnet) before the executor started: seven claims confirmed with caveats (S120 shift coincided with stationary phase; S122 is a constant-temperature ratio; S110 consumption is inferred from CO2/base demand; S114 has one rising condition; S074 gives no count of flat clones). The caveats were in the brief from the start.
- Orchestrator runs: `npm run check` → 26 files, 2434 passed; `uv run pytest -q` → 186 passed; `check_docs --all` → 0 failure(s); `check_all --manual: PASS`; goldens, fixtures, `sql/`, `reference/` unchanged. Trajectory reproduced: lactate maximum 2.62 g/L on culture day 7 (was 7.14), 0 of 398 runs over-range in seed 1 (was 51, all lactate), harvest unchanged at culture day about 12.1.
- Remaining gaps, reported not tuned: lactate maximum above the source maxima (S056 at most 1.0 g/L, Ruhl 0.9, S074 1.35-1.80 g/L in CD CHO); peak viable density at about culture day 12 against days 7.5-9.6.

**Next**: golden event logs (S1b Step 4) on the orchestrator go-ahead.

## 2026-10-29 — S1b Step 4: golden event logs (executor, uncommitted)

**Result**: the golden event logs of the default scenario exist for seeds 1, 2 and 3, with a checksum file and a test that verifies them and reproduces them; every gate is green. Base commit da5f366 (the lactate calibration included); nothing committed; no ADR touched. These files are read-only from now on: no script, flag or test rewrites them, and any change needs the author's approval recorded in this file (`00` section 2 item 9). `tests/golden/parity/` and its `CHECKSUMS.txt` are untouched.

**Command** (run once from the repo root, not an npm script, not a test, saved in no file; engine 0.1.0, `scenarios/default.json`, seeds 1, 2, 3; the seed replaces the one in the scenario file, as in the I9 test):
`node --input-type=module -e "import { writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; import { runScenario } from './engine/src/run.ts'; import { canonicalJson, canonicalJsonl, logHash, ENGINE_VERSION } from './engine/src/trace.ts'; import { configOf } from './engine/tests/support/scenarios.ts'; const sums = []; const put = (name, text) => { writeFileSync('tests/golden/' + name, text); sums.push(createHash('sha256').update(text).digest('hex') + '  ' + name); }; for (const seed of [1, 2, 3]) { const events = runScenario({ ...configOf('default'), seed }).events; const counts = {}; for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1; const summary = { schema_version: '1', engine_version: ENGINE_VERSION, seed, event_count: events.length, log_hash: await logHash(events), event_counts: counts }; put('default_seed' + seed + '.trace.jsonl', canonicalJsonl(events)); put('default_seed' + seed + '.summary.json', canonicalJson(summary, 2) + '\n'); } writeFileSync('tests/golden/CHECKSUMS.txt', sums.join('\n') + '\n');"`

**Files** (`tests/golden/`; `*.trace.jsonl` is `canonicalJsonl(runScenario(...).events)`, keys sorted, one event per line; `*.summary.json` is canonical JSON, indent 2, with `schema_version`, `engine_version`, `seed`, `event_count`, `log_hash` and `event_counts` by event type, 18 types; `log_hash` is the sha256 of the trace file)

| Seed | Trace (bytes) | Events | `log_hash` | Summary (bytes) |
|---|---|---|---|---|
| 1 | 1,091,015 | 7,211 | 47afbe18e38bc4095b502a97059498e7211e5ac0b634caa3748212cbd45904fd | 671 |
| 2 | 1,104,630 | 7,295 | b81025c3b6b716a8e7ad657333eb543bafb97f1ea2cdbd3ea73d5a20a224c8a0 | 672 |
| 3 | 1,104,141 | 7,287 | 20033a35a0f3dcaa0d9ae4f0b3d000b6d22990ef0e0d6813eef4df3c71192b60 | 671 |

`CHECKSUMS.txt` (555 bytes) lists the sha256 of the six files, in the format of the parity file. No file is near 5 MB. Sensor ticks are not in `events` (they are in `ScenarioRun.sensors`), so they are not in the logs; S2 compares against the event logs only.

**Test**: `engine/tests/golden_default.test.ts` (8 tests, 61 lines): the folder holds exactly `CHECKSUMS.txt`, the six files and `parity`; the checksum file lists exactly the six files and every sha256 matches; for each seed the engine reproduces the trace byte for byte and the summary file equals the summary computed from a fresh run. It only reads and compares. `repo_rules` (no write under `tests/golden`) still passes.

**Evidence**
- Red before the files existed: `Test Files 1 failed (1)`, `Error: ENOENT: no such file or directory, open '.../tests/golden/CHECKSUMS.txt'`. Green after: `Test Files 2 passed (2)`, `Tests 22 passed (22)` with `repo_rules`.
- Mutations in a scratch copy of the repo only (the repo itself was not touched): one byte flipped in the middle of `default_seed2.trace.jsonl` -> the checksum test fails (`default_seed2.trace.jsonl: expected 'eea3db9b…' to be 'b81025c3…'`) and the seed 2 reproduction fails at line 3636, 2 failed and 6 passed; the A085 onset day of the copy's `scenarios/default.json` changed from 7 to 6 -> all 6 reproduction tests fail and the 2 checksum tests pass.
- `git status --short -uall -- tests/golden` shows the seven new files only.

**Parked**
- The goldens are bound to engine 0.1.0 and to the A085 default as of da5f366; any later change of a default, a ledger value used by the scenario or the engine that moves the event log will fail this test and needs the author's approval to regenerate.

## 2026-10-29 — S1b gate (orchestrator)

**Verdict**: S1b complete. Golden event logs created once from base commit da5f366 (command and seeds in the Step 4 entry above); from now on they are read-only and a change needs the author approval recorded here.
- Orchestrator checks: `shasum -a 256 -c tests/golden/CHECKSUMS.txt` → six files OK; the engine reproduced all three logs byte-identically in a separate Node process (7211, 7295 and 7287 lines); `git status --short -uall -- tests/golden` showed exactly the seven new files; `tests/golden/parity/` unchanged.
- S1b gate items: `npm run check` green; S1a fixtures and the M/M/c test green; invariants I1-I12 green; SC2 and SC5 structural tests green; profile-id grep clean; I12 measured (median 79 ms); golden checksum test green; `uv run pytest -q`, `check_docs --all` and `check_all --manual` green; one `sim-adversary` pass with its majors closed (F1 by the L1 and lactate calibrations, F2 by the integer-time contract).

**Known limitations (recorded, not tuned)**: peak viable density at about culture day 12 against days 7.5-9.6 in the sources; lactate maximum 2.62 g/L above the source maxima (at most 2.25 g/L); minors F3-F11 of the adversary pass are in the S1b executor entry.

**Open for the author**
- ADR-0015 (mixed fleets) is Proposed and waits for a decision.
- `.nvmrc` 25 against the Vitest engines range.
- S118-S122 are `agent-read`; a public number from them needs a `main-reread` first.
- S4: the `lactate_consumer` clone of SC13 needs a new difference from the platform, which now turns to net consumption on culture day 7.

**Next**: S2 (`prompts/20_S2_capture_metrics.md`) in a new session; before any recorder exists, a process-value-only sensor stream (adversary F11 note).

## 2026-10-29 — Author decisions and S2 start (orchestrator)

**Author decisions**
- ADR-0015 (mixed fleets): accepted by the author in chat ("혼합구성 허락."). The decision is recorded verbatim in `docs/adr/review_2026-10-29_adr0015.json` for `scripts/adr_accept.py`; the author applies it and commits it personally (dry run checked: status line and decider note change, exit 0). Implementation stays in S3 or S4.
- `.nvmrc` stays at 25; the EBADENGINE warning of Vitest 5.0.5 is accepted.
- Push: run by the author after the ADR commit.

**S2 plan (orchestrator, PDD)**: `prompts/20_S2_capture_metrics.md` runs in five executor batches, each verified and committed before the next: S2a Steps 0-1 plus a process-value-only sensor stream for recorders (S1b adversary note); S2b Steps 2-3; S2c Step 4; S2d Steps 9-12; S2e Steps 5-8 (raw device layer). `sim-adversary` runs once at the end of S2. The brief now states that ADR-0014 is Accepted by the author (it said Proposed).

## 2026-10-29 — S2a: import zones, observable sensor stream, architecture flags, recorder (executor, uncommitted)

**Result**: Steps 0 and 1 of S2 and the S1b follow-up are in, every test red first and then green; base commit cdfec84, nothing committed, no ADR touched; `tests/golden`, `sql`, `reference` and `docs/adr` are unchanged (only the author's untracked ADR-0015 review file is in `docs/adr`). Questions the design does not decide are listed below and were not guessed past; the choices made so that the work could go on are named as choices.

**Step 0 baseline before any change**: `npm run check` -> `Test Files 27 passed (27)`, `Tests 2442 passed (2442)`; `uv run pytest -q` -> `186 passed, 62 deselected`; `check_docs --all` -> `241 files, 0 failure(s)`; `check_all --manual: PASS`.

**Zone mapping** (the truth modules of this repo are flat files): the brief's "process, sampling, analysis and the truth log" is `engine/src/{process,sampling,analysis,measure,instrument,stability,sensors,run}.ts` (the truth log is what `run.ts` returns). `observe/**` is the flat `engine/src/observe.ts`; with `scenario.ts`, `trace.ts` and `mmc.ts` (they load or type the truth world today) it is on the reader list, together with the future folders `evaluate/`, `experiments/assembly/` and `experiments/oracle/`. Everything else in `engine/src` may not import a truth module: `record`, `ingest`, `raw`, `inject`, `export`, `experiments/arms`, any folder added later, and any new top-level file. Zone 2: `engine/src/evaluate/answer_key.ts` only from `engine/src/evaluate/**`. Zone 3: `experiments/arms/**` may import none of `oracle`, `assembly`, `evaluate`. Each zone repeats the Node-only ban (a later config object replaces the options of `no-restricted-imports`); a test checks that the ban still fires in every zone. Each zone was shown failing on a planted import in a scratch copy (six folders and the key; 9 errors) and passing after the plants were removed (`npx eslint engine` exit 0).

**Task 1, observable sensor stream**: `observeSensors` and the types `ObservableEvent` and `ObservableSensorSeries` in `engine/src/observe.ts` (the file stays flat); `ScenarioRun.observableSensors` in `engine/src/run.ts` carries identity, cadence and the process value `pv` only, listed field by field. The `ObservableEvent` type removes the hidden fields from the type, not only from the value. `record/` cannot import `sensors.ts` (zone 1). Sensor ticks are not in the event log, so the S1 goldens are untouched (the golden test is part of the green run).

**Step 1**: `schemas/architecture.schema.json` (and the generated `engine/src/generated/architecture.schema.d.ts`, which the existing no-drift test requires), presets `scenarios/architectures/{a_manual,b_lims_lite,c_context}.json`, `engine/src/record/{architecture,types,recorder,results,asof,ablation}.ts`. One generic `record(input, architecture)`; `contextAsOf` and `resultsAsOf` are the as-of reads; `ABLATIONS` and `recordAblations` give C minus one flag. Hand-typed fixture and tests in `engine/tests/record/` and `engine/tests/support/record_fixture.ts`.

**Evidence, red then green** (reasons by value)
- Zones: `Tests 68 failed | 43 passed (111)` (expected one restricted-import message, received none); green `111 passed`.
- Observable sensors: `TypeError: observeSensors is not a function` (5 of 5, the field `observableSensors` undefined); green 5 passed.
- Architecture schema, presets, ablation configs: module and schema missing; green 40 passed.
- Per-flag tests: 17 of 17 failed against a recorder that records nothing (`expected [] to deeply equal [ 1100, 5000, 9100 ]`); green 17 passed.
- 2 x 2 fixture and as-of tests: `Tests 17 failed | 10 passed (27)` (`expected [] to deeply equal [ 'R1' ]`, `expected null to match object { join_basis: 'sampled_at', ... }`); green 27 passed.
- I8 on the recorder (3 seeds x 3 architectures): the case "an object handed over with its truth array still on the series" failed 3 of 13, because the recorder stored the input series by reference; the recorder now copies the series field by field; green 13 passed. In the ablation test the order of three hand-typed table lists was wrong (the sets were right); the expectation was corrected, not the code.
- Final: `npm run check` -> `Test Files 35 passed (35)`, `Tests 2666 passed (2666)` (lint and typecheck clean).
- Mutations in a scratch copy only (every file restored; `diff -r` of `engine/src` clean afterwards): the recorder reads the hidden `noise` of an event -> 3 I8 tests fail; reads the sensor truth -> 3 fail; passes the series by reference -> 3 fail; `two_clocks` ignored in the recorder -> 5 of 13 in the 2 x 2 file fail; the join basis ignores `two_clocks` -> 3 fail; each of the eight flags replaced by `false` in turn -> its per-flag test fails (1 each, 2 for `audit_trail`), the others pass.

**Deviations and choices** (for review)
- `observe.ts` stays a flat file; the `observe/**` zone path of the brief is represented by it. The reader list in `eslint.config.js` is where a later move to folders is recorded.
- The generated type file `architecture.schema.d.ts` is outside the brief's list but the existing no-drift test requires it.
- The recorder is deterministic and pure; it reads only `ObservableEvent[]` and `ObservableSensorSeries[]`. A column an architecture cannot know is `null`, not absent (data_model principle 7).

**Open questions for the orchestrator** (the design does not decide; the choice made is in brackets)
1. `write_time_keys` off: no locator is given for "unit and batch attached later by a time join". [Both settings store the keys the stream carries; the sample row says `keys_fixed_at_write` true or false. A mis-join would enter as a changed key in the stream (S2b, S2c).]
2. Cell two_clocks on and write_time_keys off: "the stored time" is ambiguous when two times are stored. [The join basis is `sampled_at` whenever it is stored (matrix row "feed in the gap"), independent of `write_time_keys`.]
3. `ingested_at` of a result is open for A, B and the layer-off case (data_model section 14, question 7), and no ingestion or review delay exists before S2b or S2e. [Result rows carry no `ingested_at`; `available_at` is the stamp of the result event; historian and process-event rows from the stream are ingested at their own stamp.]
4. `append_only_versions` off with `available_at` on: the spec says the earlier version "no longer exists" but not what an as-of read returns. [The overwrite replaces the row including `available_at`; a read before the rerun's stamp sees nothing of that key.]
5. "Batch phase" and "feed epoch" are not defined. [`feed_epoch` = feeds of the batch with `occurred_at` at or before the join time; `batch_phase` = before_shift, after_shift or harvested, from the temperature_shift and harvest process events.]
6. `planned_at` is stored iff `system_issued_id` is on, whatever the labelling method (data_model section 2, read literally); C (issued at draw) therefore stores both `planned_at` and `sampled_at`. The architecture's `labelling` is carried and validated; the recorder records the method the `label_bound` event reports.
7. `audit_trail`: the sampler is observable, the analyst who reran is not, and no qualification data is in the stream. [`sample.operator_id` only; audit events without `operator_id`; the qualification reference waits for the injector.]
8. `instrument_state` comes from `calibration_recorded` (`lot_id` is taken as the reagent lot); `qc_lot` and `software_version` are not observable; a reagent lot change between two calibrations is invisible to the record. The `calibration_ref` text and the id prefixes `R`, `A` and `PE` are mine.
9. VR-008b (same event id, different content, quarantine) is detection (S2b); the idempotency key here is event id + stamp + value, so changed content is a different key.
10. Invariant 11 (a new name needs a design change first): `keys_fixed_at_write`, `analyzer_name`, `join_basis`, `join_time`, `feed_epoch`, `batch_phase` and its values, `pv`, the `source_of_record` values `lims` and `mes_ebr`, and the table name `validation_finding` (data_model's entity, without `status`) need the orchestrator's ratification or renaming.
11. A skipped draw (`draw_skipped_volume_budget`) has no sample row.

**Parked**
- The generated `Event` type (with the hidden fields) is still importable from `record/`; a type-level zone for `generated/event.schema` would close that, but it was not in the brief.
- The historian is kept columnar (`series`) plus a `late` list; an export to rows is S2d.
- The `labelling` of the architecture is not yet applied to the scenario's `label_method` (the assembly of S2b does that).

**Next**: the orchestrator reviews, answers the questions above and commits in three steps (zones; observable sensors; architecture and recorder); then S2b (injector and evaluator).
- Structure-only versus behaviour paths. Structure-only (no runtime behaviour): `eslint.config.js`, `engine/tests/contract/import_zones.test.ts`. Behaviour, step 2 (observable sensor stream): `engine/src/observe.ts`, `engine/src/run.ts`, `engine/tests/observe_sensors.test.ts`. Behaviour, step 3 (architecture and recorder, new files): `schemas/architecture.schema.json`, `engine/src/generated/architecture.schema.d.ts`, `scenarios/architectures/`, `engine/src/record/`, `engine/tests/record/`, `engine/tests/support/record_fixture.ts`, `docs/progress.md`.

**Rework round 1** (orchestrator verdict REWORK; rulings: Q2, Q4, Q5, Q6 approved; Q3 and Q7 approved for now; Q8 a recorded limitation; Q10 ratified; questions 1, 9 and 11 above are answered by R1 to R3)
- R1, keys: `write_time_keys` off now stores `sample_id` and `unit_id` and leaves `batch_id` null; `batchOf` (`engine/src/record/asof.ts`) derives it at read, the batch of that unit open at the stored time (`sampled_at` when stored, else `measured_at`; open means `inoculated_at` <= t < `harvested_at`). Context uses it and is null when no batch is open. Hand-typed case in `flags.test.ts` (U1 harvested at 1500, S1 drawn at 1100 and measured at 2000): on `[B-U1, B-U1, B-U2]`; off with the measured time `[null, null, B-U2]`; off with `two_clocks` `[B-U1, null, B-U2]`. The 2 x 2 file asserts `batch_id` null or fixed per cell.
- R2, idempotency: key = source + event id + content version (`AN-1|AN-1/S1/1/1/glucose|v1`; the stream has content version 1, the value is not in the key). On: same content is a no-op with a VR-008 information finding; same key and other content is not loaded, the original stays, the incoming row is in the new `ingest_conflict` list; off: both are rows. Three hand-typed cases (replay, conflict, off).
- R3, skipped draw: `draw_skipped_volume_budget` gives a `sample` row with `state` `skipped`, its `planned_at`, no `sampled_at`, operator, label or result when `system_issued_id` is on; no row when it is off. `state` is null on other rows. Hand-typed case for both (fixture `WITH_SKIP`).
- R4, design: new subsection "Recorder rules decided in S2a" at the end of section 7 of `docs/design/data_model.md` (rules R1 to R3, join basis, overwrite, planned time, process context, interim `ingested_at` and attribution, the instrument-state limitation, findings with `status` when S2b creates them, and the new names).
- Evidence: red `Tests 8 failed | 105 passed (113)` (for example `expected [ 'S1', 'S2', 'S3' ] to deeply equal [ 'S1', 'S2', 'S3', 'S4' ]`, `expected 'AN-1/S1/1/1/glucose|2000|5.1' to be 'AN-1|AN-1/S1/1/1/glucose|v1'`, `expected [ 'S1', 'U1', 'B-U1' ] to deeply equal [ 'S1', 'U1', null ]`); green `113 passed`. Mutations in a scratch copy (restored, `diff -r` clean): join ignores `sampled_at` -> 4 fail; `batch_id` always stored -> 4 fail; the batch never closes at harvest -> 2 fail; key includes the value -> 2 fail; conflict treated as a no-op -> 1 fails; skipped row without a plan -> 1 fails; skipped draws never recorded -> 1 fails.
- Paths: `docs/design/data_model.md` joins the behaviour paths of step 3 (architecture and recorder); `engine/src/record/{asof,recorder,results,types}.ts` and `engine/tests/{record/flags.test.ts,record/time_flags_2x2.test.ts,record/ablation_record.test.ts,support/record_fixture.ts}` changed in this round.

## 2026-10-29 — S2a review (orchestrator)

**Verdict**: PASS after one rework round.
- Orchestrator runs: `npm run check` → 35 files, 2671 passed; `uv run pytest -q` → 186 passed; `check_all --manual: PASS`; `git diff HEAD -- eslint.config.js` adds only (no rule removed or loosened); goldens, `sql/`, `reference/` and `docs/adr/` unchanged (the author's untracked ADR-0015 record aside).
- Rulings on the executor's eleven questions: Q2, Q4, Q5 and Q6 approved; Q3 (`ingested_at`) and Q7 (analyst and qualification reference) interim until S2b; Q8 recorded as a limitation; Q10 names ratified. Rework: R1 `write_time_keys` off derives `batch_id` by a time join at read (spec section 5); R2 the idempotency key is source, event id and content version, and a same-key row with other content is kept aside (data_model section 7); R3 a skipped draw is a `skipped` sample row where a plan issues the label (spec section 2.2); R4 the rules and names are in data_model section 7, "Recorder rules decided in S2a".
- Hand check of the R1 case: U1 harvested at 1500 s, S1 drawn at 1100 s and measured at 2000 s gives B-U1 with keys fixed at write, no batch by the measured-time join, and B-U1 by the `sampled_at` join, as the tests expect.

**For S2b**: decide `ingested_at` (data_model section 14, question 7) where VR-003 and VR-004 need it; findings carry the `status` column; the generated `Event` type with hidden fields is still importable from `record/` (Parked by the executor; a type-level zone would close it).

## 2026-10-29 — S2b: error injector and metrics evaluator (executor, uncommitted)

**Result**: Steps 2 and 3 of S2 are in, every test red first (module or column missing) and then green; base commit db02f71, nothing committed, no ADR touched; `tests/golden`, `sql`, `reference` and `docs/adr` are unchanged (only the author's untracked ADR-0015 review file is in `docs/adr`). Cells and denominators the design does not decide are listed as questions and were not guessed past; the choices made so that the work could go on are named as choices. No value of any metric is reported here: nothing was run on the default scenario except a timing check (one seed through eleven architectures, about 0.4 s).

**Parked item of S2a closed (decision 3)**: `eslint.config.js` has a fourth zone: `engine/src/{record,inject,ingest,raw,export}/**` and `experiments/arms/**` may not import `generated/event.schema` (the Event type with the hidden fields); they use `ObservableEvent`. Planted in a scratch copy in `record/`, `inject/` and `experiments/arms/` (and the answer key in `record/`): `npx eslint engine` exit 1 with four errors; plants removed: exit 0. `git diff HEAD -- eslint.config.js` adds a constant and one argument in two rules, nothing is loosened.

**Decision 1 (`ingested_at`)**: result rows carry `ingested_at` (null for A) and `state`; the recorder takes optional plain data `received_at` (host receipt time by source event id) and `qualifications`. Decision text is in `docs/design/data_model.md` section 7 (the interim row replaced) and question 7 of section 14 points to it.

**Step 2, injector** (`engine/src/inject/`): `drawOpportunities` (key `(seed, sample, "-", 0, "error:<type>")`, no architecture input), `catalogue.ts` (mechanism per type from the matrix, "Prevented by"), `rates.ts` (label rate from the staff profile: A047 per 1000, times A062 for the trainee), `structural.ts` (feed in the gap, lost rerun, unattributable record, planned-versus-actual), `edits.ts` (relabel, rekey, replay, per-analyzer clock skew with the host receipt time), `inject.ts` (production and forced mode), `types.ts`. Output is plain data; `experiments/assembly/key_file.ts` writes the key (`schemas/answer_key.schema.json`), `evaluate/answer_key.ts` is its only reader.

**Detection** (`engine/src/record/{validate,rule_types,rules_time,rules_keys}.ts`): VR-002, 003, 004, 008b, 009, 010, 011, 014, 015, 019, 020. A rule sets the `state` of rows and writes a finding (`rule`, `target`, `severity`, `action`, `status`); a rule that lacks a field or a limit is listed as not evaluable with its reason. A held, quarantined or rejected row is not available to `resultsAsOf`.

**Step 3, evaluator** (`engine/src/evaluate/`, `schemas/metrics.schema.json`): holding time, turnaround, utilisation (twice, with and without setup), availability (with the leakage count), misattribution (unattributed and no-result apart), detection recall, precision and false-alarm rate per type, exact reconstruction, alignment error, phantom effect, rerun traceability, attributable rate; `aggregate.ts` is the seed table (median, 5th and 95th percentile, seed count, A103 minimum). `experiments/assembly/{run_seed,from_run}.ts` run one truth run through every architecture and write the key once.

**Evidence, red then green**
- Baseline before any change: `npm run check` -> `Test Files 35 passed (35)`, `Tests 2671 passed (2671)`.
- Zone 4: `Tests 6 failed | 121 passed (127)` (expected one restricted-import message, received none) with the old config; `127 passed` with the new one.
- Recorder columns and rules: `Test Files 2 failed` (module `validate.ts` and the columns missing); the first green run showed two wrong expectations of mine (VR-010 also fires on the S2 rerun; without versions the rerun overwrites, so three rows), corrected in the tests, not in the code. `160 passed (160)` in `engine/tests/record`.
- Injector: `Cannot find module '../../src/inject/inject.ts'` in 4 of 4 files; green `42 passed (42)` after the tests that asserted only the forced type were made to filter by type (the structural types appear as well).
- Evaluator and assembly: `Cannot find module '../../src/evaluate/answer_key.ts'` in 4 of 4 files; first green run `57 passed | 2 failed`, both from the strict-mode union types in the new schemas (rewritten as `anyOf`); `by_type` made explicit in the schema; then `261 passed (261)` over record, inject, evaluate and assembly. No hand-derived expectation had to be changed.
- Rubric grep (`scenarios_data`): failed once because the qualification level used the profile ids as strings; the level is now the boolean `qualified`.
- Final: `npm run check` -> `Test Files 45 passed (45)`, `Tests 2835 passed (2835)` (lint and typecheck clean); `uv run pytest -q` -> `186 passed`; `check_docs --all` -> `308 files, 0 failure(s)`.
- Mutations in a scratch copy only (each reverted, tests green after): recall denominator = flagged samples -> 8 fail (Guard 1, Guard 4, the 10-request fixture); no monotone coupling (fresh draw per rate) -> 2 fail; opportunities keyed by architecture -> 1 fails (identity); a rule that edits a value -> 5 fail; label-error mechanism ignoring `system_issued_id` -> 2 fail; a feed at the draw instant counted as in the gap -> 1 fails; `ingested_at` stored for A -> 1 fails; answer key and hidden event type imported from `record/`, `inject/`, `experiments/arms/` -> lint exit 1, then 0.

**Choices and deviations** (for review)
- `ingested_at` follows the flag `ingest_idempotency` (the envelope `received_at`): A null, B and C stored as decided, but C minus `ingest_idempotency` also stores none. The alternative is "any flag on".
- Prevented means a structural zero (the matrix column "Prevented by"). Production rate of a label error is A047 times the staff multiplier where the mechanism exists; A061 (the 72 percent reduction by a standard protocol) is not used.
- Production label-error content is the neighbouring tube; a forced one names the id (`as_id`), so a typo that matches no request and one that matches another request are both expressible.
- Reconstruction and alignment queries run after the end of the run; only availability uses the decision time. The truth release is the last passing QC result. Hold time is measured to the first run.
- The spread of the seed table is the 5th to 95th percentile, stated as not a confidence interval.
- The qualification level of A072 and A073 is carried as the boolean `qualified`.
- S2a tests changed: `flags.test.ts` (the finding row has `status`, its target is typed; the skipped sample row has `qualification_id`) and `import_zones.test.ts` (the event type is now blocked on the recorded side).

**Open questions for the orchestrator**
1. `ingested_at` by flag (above): confirm, or give the "any flag on" reading.
2. VR-014 needs `system_issued_id` (the registry), and a label error is prevented by that flag, so no architecture can detect an injected label error with VR-014; only VR-009 (needs `two_clocks`) can, and the injector's mix-ups never share a draw time. Should a residual label-error rate under `system_issued_id` (A061) exist, and what is its content (a barcode on the wrong tube)?
3. Types whose detector is a mechanism, not a rule (lost rerun, planned-versus-actual time, instrument effect, late correction, technique error): detection reads "not evaluable". In the forced cells of S2c, does audit review, a bridging study or an as-of query count as `detected`, and what is its flag?
4. A replayed file under `ingest_idempotency` is prevented, so the injector does not edit the stream and the VR-008 information no-op never appears for an injected replay. The alternative is to replay in every architecture and let the recorder's flag decide.
5. Finding `status` (`open` or `resolved`), result `state`, and "not available to an as-of read" while held: confirm.
6. Rerun traceability scores original and link; the reason of a rerun is recorded by no architecture. Add a `reason` to the audit event (outside the S2b recorder scope)?
7. Spec section 8 "Experiment 2" row (probe offset, control excursion, paired difference) is not in S2b; it belongs to the arms and the oracle of S2c.

**Blocked** (no ledger entry; built and tested with test-only values where the code does not need a number)
- Tolerances of VR-003 and VR-004: the rules exist and are tested; production settings list both as not evaluable.
- Rates of a unit or batch re-key and of a replayed file: forced mode only; production reports them as not modelled.
- The probability that an anomaly is noticed, scaled by the staff profile (Step 2): no base value or multiplier exists; not built.
- Result transcription and dilution entry errors: manual path, S2e (spec section 2.4.8: no entry; A048 has no rate).

**Parked**
- VR-001, 005, 006, 007, 012, 013, 016 to 018 (units, ranges, trajectory, QC outcome, dilution rule, lineage); the zone part of VR-004 (waits for the raw layer).
- Technique error and instrument effect are truth-side; late correction has no source in the layer-off stream.
- A `sample` row state for held or quarantined samples (the rules set the state of result rows only).

**Next**: the orchestrator reviews, answers the questions and commits; then S2c (Step 4: forced-error cells, SC1/3/4/6/7, experiments 1 and 2).
- Structure-only paths (no runtime behaviour): `eslint.config.js`, `engine/tests/contract/import_zones.test.ts`. Behaviour, recorder and rules: `engine/src/record/{types,results,recorder,asof}.ts`, `engine/src/record/{rule_types,rules_time,rules_keys,validate}.ts`, `engine/tests/record/{flags,ingested_at,validate}.test.ts`, `docs/design/data_model.md`. Behaviour, injector: `engine/src/inject/`, `engine/tests/inject/`, `engine/tests/support/inject_fixture.ts`. Behaviour, evaluator and assembly: `engine/src/evaluate/`, `engine/src/experiments/assembly/`, `schemas/{answer_key,metrics}.schema.json`, `engine/src/generated/{answer_key,metrics}.schema.d.ts`, `scenarios/evaluation/default.json`, `engine/tests/{evaluate,assembly}/`, `engine/tests/support/{eval_fixture,eval_schemas}.ts`, `docs/progress.md`.

**Rework round 1** (orchestrator verdict REWORK; rulings: Q2 no residual label-error rate from A061 (a protocol effect, not a barcode residual), recorded as a design finding; Q3 stays "not evaluable" until S2c scores the non-rule detectors by named evidence; Q5 is S2c; the blocked ledger gaps are accepted as "not modelled" in production runs). This round supersedes the choice "`ingested_at` follows `ingest_idempotency`" and the choice "a prevented replay leaves the stream untouched" above.
- R1, `ingested_at`: a row-creation stamp is stored whenever at least one of the eight flags is on (`storesIngestedAt` in `engine/src/record/results.ts`, read by VR-003 and VR-004); the all-off configuration stores none. Hand-typed tests: A none; B, C, each of the eight single-flag ablations of C and each single flag alone store the stamp; two_clocks only (no idempotency flag) still fires VR-003 and VR-004. Red: `14 failed | 68 passed` (for example `expected [ null, null, null, null ] to deeply equal [ 2000, 6500, 9000, 10000 ]`); green with R2: `Test Files 16 passed`, `Tests 283 passed` over record, inject, evaluate and assembly. Mutation in a scratch copy (stamp tied to `ingest_idempotency` again) -> 10 fail; reverted, 178 pass.
- R2, replay: forced `duplicate_replay` is injected in every architecture (a source event); in the key only where `ingest_idempotency` is off. Hand-typed across A, B, C: the stream has S1's result twice in all three; A double counts (two S1 rows of 5.1, in the key); B and C hold one S1 row and one VR-008 information no-op (`status` resolved), not in the key. Production runs: not modelled. Mutation (replay only where it materialises) -> 4 fail; reverted, 46 pass.
- R3, docs: `data_model.md` section 7 (the `ingested_at` row replaced by the R1 rule, the error-type and forced-mode rows say that a replay is a source event) and question 7 of section 14; `simulation_spec.md` section 5 has "Notes from S2b" under the matrix: VR-014 cannot detect an injected label error in any architecture, the label row's cells read prevented or invisible unless VR-009 applies, and the non-rule detectors are scored in S2c by named evidence.
- Done: `npm run check`, `uv run pytest -q`, `check_docs --all` and `check_all --manual` green (final lines in the report).

**Research tasks** (ledger gaps behind "not modelled" and "not evaluable"; none was filled with a number)
1. A tolerance for VR-003 (measured later than ingested) and one for VR-004 (clock offset): scenario settings with a ledger entry each.
2. The rate at which a sample is re-keyed to another unit or batch.
3. The rate at which a result file is replayed.
4. The probability that an anomaly is noticed, and the staff-profile multiplier on it.
5. Manual-path entry errors: a typed result value, a unit slip, the delay between result and entry (spec section 2.4.8; A048 has no rate).

## 2026-10-29 — S2b review (orchestrator)

**Verdict**: PASS after one rework round.
- Orchestrator runs: `npm run check` → 45 files, 2857 passed; `uv run pytest -q` → 186 passed; `check_all --manual: PASS`; protected paths clean; the `eslint.config.js` diff only adds the hidden-event zone to two existing rules (tighter, nothing removed). Hand values present in the tests: F5 utilisation 0.1 and 0.05 per staffed window and 3600/86400 per 24 h, recall 2/3, precision 2/3, false-alarm 1/7.
- Rulings: Q1 rework, `ingested_at` is stored whenever at least one flag is on (so ablating `ingest_idempotency` no longer removes clock detection); Q2 no residual label-error rate from A061, recorded as a design finding under the spec section 5 matrix; Q3 the matrix entries that are not rules (idempotency log, audit trail, bridging study, as-of query, recorded container and hold context) are scored in S2c by named evidence in the record; Q4 rework, a replay is a source event injected in every architecture in forced mode; Q5 experiment 2 is S2c.
- Ledger gaps (research tasks; production runs report them as not modelled): VR-003/VR-004 tolerance, unit re-keying rate, file replay rate, anomaly-notice probability; manual-path value and dilution transcription errors move to S2e.
- The author committed ADR-0015 meanwhile (`61c30fa`, docs/adr only) and pushed.

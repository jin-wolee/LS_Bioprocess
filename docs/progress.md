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

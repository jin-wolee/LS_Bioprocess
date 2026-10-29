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

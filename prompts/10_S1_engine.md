# 10 — S1 executor brief: contracts, hand fixtures, TS engine L1-L3

Read `prompts/00_master_build.md` first; its invariants and definition of done apply. Executor: Sonnet, effort xhigh. Estimated 3-4 h.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination (S1): SDD + TDD + EDD + BDD + YAGNI + HITL; always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
Scenarios SC2 and SC5 become Given-When-Then acceptance tests in the format of PRINCIPLES.md section 2 (BDD). Hand fixtures and the analytic M/M/c values are the evals (EDD).
You never commit. Tidy First is applied by the orchestrator: report your structure-only paths and your behaviour paths as two lists.
HITL gates touched: the author's implementation track (acceptance tests only), ADRs (`Proposed` only).

## Goal

A deterministic TypeScript engine for layers L1-L3 with profiles, judged only by invariants, hand-calculated fixtures and an M/M/c check. Plus the contracts (JSON Schemas), the SimPy trace interface, and acceptance tests for the two things the author writes: the SimPy core loop and the canonical DDL. What L1-L3, profiles and scenarios mean is in `docs/design/simulation_spec.md`; this brief does not restate it.

## Allowed paths

Create or edit: `engine/`, `schemas/`, `scenarios/`, `tests/` (incl. `tests/fixtures/`, `tests/golden/`, `tests/user_track/`), root `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `pyproject.toml`/`uv.lock` (via `uv add --dev`), `.claude/user_owned.txt` (append the author paths), `docs/design/` (only if a design doc needs an S1 clarification), `docs/progress.md`, Proposed ADRs for stack choices not already covered.
Not expected to change: `scripts/check_all.sh` already runs `npm run check` once `package.json` exists and carries the `Math.random` grep. If either is missing or wrong, report it to the orchestrator instead of editing.
Never create or edit: `sql/`, `reference/`, `src/` (UI, S3), `docs/research/*.yaml`, `docs/private/`, `infographic/`.

## Step 0 — rails and ownership

- [ ] Read `.guardrails.local.txt`, `CLAUDE.md`, the last entry of `docs/progress.md`, `docs/design/simulation_spec.md`, `docs/design/data_model.md`, `docs/research/assumptions.yaml` (ids only; never copy values into code).
- [ ] Run `bash scripts/check_all.sh --manual`, `uv run pytest -q` and `check_docs --all` once before changing anything (paste the tails).
- [ ] Append `sql/schema.sql`, `sql/queries/asof_join.sql`, `sql/queries/lineage_recursive.sql`, `sql/queries/bridging_offset.sql`, `reference/sim_core.py` to `.claude/user_owned.txt` (one per line, no duplicates). Prove the guard works: pipe a PreToolUse `Write` JSON for `reference/sim_core.py` into `scripts/hooks/guard_tools.py`; expect exit 2. Paste it. Do not create these files.

## Step 1 — reproducibility contract (encode as named tests in `engine/tests/contract/`)

Test names are the documentation; do not restate the rules in another prose file. Event names follow `docs/design/simulation_spec.md` §2, state names `docs/design/data_model.md` §6.

| Rule | Contract |
|---|---|
| Time | Integer seconds from scenario t0 = day 0, 00:00:00. The engine has no timezones; clock skew is an L4 offset. Sampled continuous durations are rounded with `Math.floor(x + 0.5)`, minimum 1 s |
| Event priority at equal `t` (ascending) | 0 capacity restored (`maintenance_ended`, QC window end); 1 `visit_finished` (frees the analyzer, emits the result, may re-enqueue a rerun); 2 `request_queued` (arrival); 3 capacity removed (`maintenance_started`, QC window start); 4 `dispatch` (internal, not logged) |
| Tie-break inside a priority | ascending `seq`, a global integer assigned when the event is scheduled (an arrival gets its `seq` when the sample is drawn; a rerun when it is re-enqueued) |
| Windows | half-open `[start, end)`. A run may start at `t` only if `[t, t + service)` intersects no window of that analyzer (a run ending exactly at the window start is allowed). If the queue head does not fit, the analyzer idles until the window ends. No backfill: strict head of line. Record this simplification in `docs/progress.md` as a modelling choice |
| Queue policies | `fifo` (order by arrival time at that analyzer, then `seq`) and `edf` (earliest deadline, then arrival, then `seq`). Dispatch gives the head to the lowest-index idle, available analyzer first |
| Time fields | `hold_time`, `turnaround` and `measured_at` are defined in `docs/design/data_model.md` §5. The sample's true state is evaluated at `run_started_at` (column `run.started_at`), and stability effects accumulate from `sampled_at`. Truth `measured_at` is `run_ended_at` (column `run.ended_at`) of the run that produced the value. `turnaround` is an S2 quantity (recorded `available_at`). The engine emits `run_started_at` and `run_ended_at`; only L4 may skew a stamp |
| Reruns | A failed run (`qc_result` failed) emits `rerun_requested` and re-enqueues the same physical sample with `attempt + 1`, arrival time = the failure time, new `seq`. The failed attempt stays in the truth log with run QC outcome `qc_failed` (its results are held); the rerun's run is `qc_passed` |
| RNG | One canonical key tuple `(run_seed, physical_sample_id, analyte, attempt, purpose)`; a draw that belongs to a unit or instrument puts that entity's id in the second slot and `-`, `0` in the next two. Stream seed = splitmix64 hash of the canonical key string (fields joined by a separator no id can contain), computed with `BigInt` modulo 2^64, synchronously (no Web Crypto, no `await`), split into the words the PRNG needs. **Install check:** verify which seed width the chosen PRNG constructor accepts and record it in `docs/progress.md`; if it is narrower than 64 bits, take further words from the same splitmix64 sequence, never truncate silently. **Collision test:** enumerate every key a default-scenario run uses at the largest seed count in the aggregates (compute the count, do not hard-code it) and assert zero stream-seed collisions. Python never needs the RNG: SimPy consumes pre-drawn traces |
| Tolerance | Event times: exact (`===`). Real-valued truth states: `abs(a-b) <= 1e-9 * max(1, abs(b))` on the same platform; TS versus Python value parity: `1e-6` absolute |
| Log identity | Canonical JSONL (sorted keys, integers, no floats in times). `log_hash = sha256`, computed with Web Crypto. Same inputs give the same hash; a different seed gives a different hash |
| Golden files | `tests/golden/*.json` plus `tests/golden/CHECKSUMS.txt`. Created once in this session (record command and seed in `docs/progress.md`), then read-only. No script, flag or test rewrites them; a test verifies the checksums |
| Seeds | Neutral integers. A test fails any scenario seed matching `^(19|20)\d{6}$` |
| Portability | `engine/src/**` imports no Node-only module (lint `no-restricted-imports` for `node:*`, `fs`, `process`, `Buffer`) so it runs in a Web Worker. The ban covers `engine/src/**` only; tests may use Node modules to load fixtures |

## Step 2 — schemas (single contract)

Write in `schemas/` (draft 2020-12), each with `schema_version` const `"1"`: `scenario.schema.json`, `profile.schema.json` (numeric parameters are `{value, unit, ref}`, `ref` pattern `^A\d{3}$|^S\d{3}$`), `event.schema.json` (truth and observable event types; hidden fields carry `"x-visibility": "hidden"`; `additionalProperties: false`), `trace.schema.json`, `trace_result.schema.json`. Field names follow `docs/design/data_model.md` (`00 §2`, item 11).

- `trace`: `{schema_version, engine_version, seed, policy, analyzers:[{id, group, initial_method}], setup:{from_method,to_method,seconds}[], windows:[{analyzer, start_s, end_s}], requests:[{request_id, seq, arrive_s, deadline_s?, visits:[{group, service_s, method_id?}]}], forced_outcomes:[{request_id, attempt, outcome}]}`. `initial_method` is the method installed on that analyzer at t0 (`null` = none, so the first run needs no setup); a trace alone must reproduce every setup. `outcome` is one of `qc_passed`, `qc_failed`, `over_range`. All randomness is drawn in TS and written into the trace; the SimPy side is deterministic.
- `trace_result`: `{schema_version, engine_version, seed, runs:[{request_id, attempt, visit, analyzer, start_s, end_s, outcome}]}` sorted by `(start_s, analyzer, request_id, attempt)`. `engine_version` and `seed` are copied from the trace.
- TS types are generated into `engine/src/generated/` by `npm run gen:types` (`json-schema-to-typescript`, exact version). A test regenerates to a temp path and fails on drift. Python validates samples with `jsonschema` (`uv add --dev jsonschema`).
- [ ] Tests: each schema compiles; one valid and one invalid example per schema; a profile with a bare number or an unknown `ref` is rejected (cross-checked against ids in `docs/research/assumptions.yaml`); a trace without `initial_method` and a result without `engine_version` or `seed` are rejected.

## Step 3 — hand fixtures first (red before any engine code)

Store as JSON in `tests/fixtures/hand/F#_*.json` with `inputs`, `expected` and a `derivation` string showing the arithmetic. Service times, setup times and clock times below are fixture-only inputs, not domain claims. Type the expected values from this brief; never copy them from engine output. Both the TS runner and, later, the author's SimPy loop read these files.

**F1 Arrival reversal** (1 analyzer, FIFO by arrival at the analyzer, service 600 s)

| sample | sampled | transport | arrives |
|---|---|---|---|
| X | 08:40:00 | 25 min | 09:05:00 |
| Y | 08:50:00 | 10 min | 09:00:00 |
| Z | 08:55:00 | 10 min | 09:05:00 |

Expected: Y 09:00:00-09:10:00 (wait 0); X 09:10:00-09:20:00 (wait 300); Z 09:20:00-09:30:00 (wait 900; ties X at arrival, X has the lower `seq`). `hold_time` (sampled to run start): Y 600, X 1800, Z 1500. A sampling-time-ordered admission would start X at 09:05:00 and Y at 09:15:00, so this fails it.
F1b, same samples with 2 analyzers: Y AN-1 09:00:00-09:10:00; X AN-2 09:05:00-09:15:00; Z AN-1 09:10:00-09:20:00.

**F2 Window boundary** (1 analyzer, service 600 s, window `[09:30:00, 10:00:00)`; each row is its own run on a fresh engine)

| arrival | start | end | what it checks |
|---|---|---|---|
| 09:20:00 | 09:20:00 | 09:30:00 | ends exactly at the window start: allowed |
| 09:20:01 | 10:00:00 | 10:10:00 | starts outside the window but would end at 09:30:01 |
| 09:25:00 | 10:00:00 | 10:10:00 | starts outside the window but would end at 09:35:00 |
| 09:45:00 | 10:00:00 | 10:10:00 | arrives inside the window |
| 10:00:00 | 10:00:00 | 10:10:00 | arrives exactly at the window end: allowed (half-open) |

Rows 2 and 3 are the discriminating cases: a check of the start time alone would start them at 09:20:01 and 09:25:00 and let them straddle the window, so only the whole-run check passes them. Row 1 and row 5 pin the half-open boundaries; row 4 is the plain case.

**F3 One rerun** (1 analyzer, FIFO, service 600 s; P arrives 09:00:00, Q 09:05:00, R 09:25:00; forced outcome: P attempt 1 = `qc_failed`)

Expected: P#1 09:00:00-09:10:00 (`qc_failed`); Q 09:10:00-09:20:00; P#2 09:20:00-09:30:00 (`qc_passed`); R 09:30:00-09:40:00. Control run without the forced failure: P 09:00:00, Q 09:10:00, R 09:25:00-09:35:00. Assertions: R's start differs by 300 s while R's measured values are identical in both runs (keyed RNG); P#2's noise draw differs from P#1's; the truth log keeps both attempts of P; a rerun with reason `over_range` carries `dilution_factor` on attempt 2 in the truth log.

**F4 Tandem visit** (profile `split_cellcounter_metabolite`: counter service 120 s then metabolite analyzer service 300 s, zero transfer; A arrives 09:00:00, B 09:00:30)

Expected counter: A 09:00:00-09:02:00, B 09:02:00-09:04:00. Metabolite: A 09:02:00-09:07:00, B arrives 09:04:00, runs 09:07:00-09:12:00. Each visit is its own run with its own instrument id.

**F5 Setup change** (profile `hplc`: service 600 s, setup 900 s when the method differs from the loaded one; the trace sets `initial_method` = T; P (T), Q (S), R (T) all arrive 09:00:00 with `seq` 1, 2, 3)

Expected: P 09:00:00-09:10:00; Q setup 09:10:00-09:25:00, run 09:25:00-09:35:00; R setup 09:35:00-09:50:00, run 09:50:00-10:00:00. Busy 3600 s, productive 1800 s (the engine emits both; utilisation per staffed window and per 24 h is an S2 metric computed from them). The same input with `initial_method` = S gives P setup 09:00:00-09:15:00, so the initial method changes the outcome and must travel in the trace.

**F6 Rack burst** (2 analyzers, FIFO, service 600 s, automated delivery: V1..V6 all arrive 08:30:00, `seq` 1..6)

Expected starts: V1 AN-1 and V2 AN-2 at 08:30:00; V3 AN-1 and V4 AN-2 at 08:40:00; V5 AN-1 and V6 AN-2 at 08:50:00. Waits 0, 0, 600, 600, 1200, 1200: the high-numbered vessels wait longest.

**F7 EDF** (1 analyzer, service 600 s, A/B/C all arrive 09:00:00; deadlines A 11:00:00, B 10:00:00, C 10:30:00)

Expected order B 09:00:00, C 09:10:00, A 09:20:00. FIFO on the same input gives A, B, C.

Two common discrete-event pitfalls are the regression targets of F1 (admission ordered by sampling time although transport can reverse arrival order) and F2 (a window checked only at the start time).

- [ ] Write a generic fixture runner and see all of F1-F7 fail (red) before writing the scheduler.

## Step 4 — scaffold (exact versions; re-check each with `npm view <pkg> version` or `uv` before installing)

| Tool | Version | Note |
|---|---|---|
| TypeScript | 6.0.3 | pinned: typescript-eslint 8.72.1 peers `typescript <6.1.0`; TS 7 is out of range |
| typescript-eslint | 8.72.1 | flat config |
| Vite | 8.3.5 | scaffold only; no UI in S1 |
| Vitest | 5.0.5 | |
| pure-rand | 8.4.2 | seed width: see the RNG row of Step 1 |
| ESLint, json-schema-to-typescript, others | latest compatible | pin exact, record in `docs/progress.md` |
| SimPy | 4.1.2 | `uv add simpy` so the author's loop can import it |
| pytest, jsonschema, duckdb | `uv add --dev` | DuckDB for the DDL acceptance test |

If a planned version does not install, use the nearest compatible one and log it; never upgrade silently. Node comes from `.nvmrc`.
- [ ] `package.json` scripts: `lint`, `typecheck`, `test`, `gen:types`, `check` (= all four). `npm run check` must pass.
- [ ] ESLint, scope `engine/src/**` only: ban `Math.random`, `Date.now`, `new Date` and the Node-only imports of Step 1. Show the rule failing on a planted violation in a scratch copy, then passing. Show `bash scripts/check_all.sh --manual` failing on a planted `Math.random` in a scratch copy, then passing.
- [ ] pytest config in `pyproject.toml`: register marker `user_track`; default `addopts = -m "not user_track"` so `uv run pytest -q` stays the AI-path gate.

## Step 5 — engine (build only what a red test demands)

Modules under `engine/src/`: `rng` (keyed streams), `clock/events` (queue with the contract above), `process` (L1), `sampling` (L2), `analysis` (L3), `profiles` (loader), `observe` (truth to observable projection), `trace` (export), `scenario` (loader), `mmc` (validation mode).

Every parameter value comes from a profile or scenario with a `ref`. Values come from `docs/research/assumptions.yaml` via the ids cited in the spec. If a value the engine needs has no id there, stop and report it to the orchestrator; never invent one.

- **L1:** batches with staggered inoculation; simple kinetics (growth limited by nutrient, nutrient consumption proportional to viable cells, product from integrated viable cells) at the integration step and online sensor cadence the spec names; scheduled events (feed, temperature shift, alarm) from the scenario. No feedback.
- **L2:** planned sampling windows to actual draw (shift burst, weekend gap, handling time from the staff profile), label, transport, aliquot storage condition, stability effects between `sampled_at` and `run_started_at` (kind, container open or closed, parameters with `ref`s). An effect applied beyond the range its source covers sets `extrapolated: true` on the truth event. Volume budget from the bioreactor profile: over-budget draws are skipped (state `skipped`) and logged.
- **L3:** queue policies `fifo` and `edf`; planned windows; multi-visit routing; sequence-dependent setup; reruns (`qc_failed`, `over_range` with `dilution_factor`); instrument state series (drift random walk, lot id, inter-instrument bias, calibration reset); measurement noise from keyed streams. No unplanned breakdown (YAGNI: no catalogue scenario needs it).
- **Operator and qualification** ride on `sample_drawn` truth events (`operator_id`, `qualified`), used by S2.
- **Profiles:** defaults and the extra profiles the spec lists (§4), all as data. Test that switching a profile changes only data: `git grep --untracked -nE "<profile ids>" -- engine/src` is empty.
- **Scenarios:** `scenarios/sc02_shift_burst.json` and `scenarios/sc05_one_analyzer_down.json` (settings per spec §7). Their Given-When-Then tests (`describe("SC2 shift-start burst")`, `describe("SC5 one analyzer down")`) state relations only: staggering lowers p90 `hold_time`; the maintenance window raises `hold_time` for samples that arrive during or just before it; EDF changes who bears the cost versus FIFO.

## Step 6 — invariant tests (loop over at least 200 seeds each)

I1 no analyzer double occupancy. I2 sample conservation: every sample ends in exactly one terminal state (`closed`, `discarded` or `skipped`, data_model §6) and counts reconcile. I3 a released result is never mutated; changes create new versions. I4 time monotone: `sampled_at <= arrived_at <= run_started_at <= run_ended_at`, so `hold_time >= 0`. I5 no run intersects a window. I6 queue discipline equals the policy's definition, recomputed independently in the test. I7 keyed-RNG independence (F3 generalised: adding or removing a rerun never changes another sample's draws). I8 observation contract: perturbing `x-visibility: hidden` fields leaves recorder-visible output byte-identical. I9 determinism: same inputs, same `log_hash`, across two Node processes. I10 volume budget never exceeded. I11 `feedback` defaults to false and truth output is independent of any L5 stub. I12 budget: the default scenario with one seed runs in at most 1 s, median of 5 runs under Node (proxy for the Web Worker budget in `00 §4`).

## Step 7 — M/M/c check (engine unit test only)

`mode: "mmc_validation"`: Poisson arrivals, exponential service, `c` servers, FIFO, no transport, windows, shifts, noise or reruns. The numbers below are test-only inputs, not domain claims.
Hand-calculated target: `c = 2`, mean service 270 s, utilisation 0.8, so `lambda = 0.8 * 2 / 270 = 0.005926 /s`, offered load `a = 1.6`. Erlang C: `P(wait) = 6.4 / (2.6 + 6.4) = 32/45 = 0.7111`; `Wq = P(wait) / (c*mu - lambda) = 0.7111 / 0.0014815 = 480 s`.
Test: 30 replications with seeds 1..30, each 20,000 departures after discarding the first 2,000. Pass if the mean of replication means is within 3% of 480 s, 480 s lies inside the 99% t-interval of the replication means, and measured utilisation is within 0.02 of 0.8. Seeds and tolerances are fixed in advance and never changed to pass. **If the check fails, stop and escalate to the orchestrator** with the replication means; do not tune the engine, the seeds or the tolerances until it passes (the fault may be in the engine, the target or the test, and the orchestrator decides). State in the test header that integer-second rounding is a known tiny bias and that real scenarios are M/D/c-like and are not validated by this test.

## Step 8 — trace export and author-track acceptance tests (non-blocking gate)

- [ ] `trace` exporter: any scenario run, plus F1-F7, exports `trace.json` valid against its schema. Examples under `tests/fixtures/traces/`: F1-F7 and 20 engine-generated traces with `expected_result` marked `"source": "ts-engine-golden"` (parity only, not truth).
- [ ] `tests/user_track/test_sim_core_parity.py` (marker `user_track`): skip with a clear message if `reference/sim_core.py` is absent. Otherwise run `uv run python reference/sim_core.py <trace.json> <out.json>` for each trace, validate against `trace_result.schema.json`, check `engine_version` and `seed` equal the trace's, and compare: F1-F7 against the hand expectations; the 20 traces against `expected_result`, exact equality on integer times.
- [ ] `tests/user_track/test_schema_sql.py` (marker `user_track`): skip if `sql/schema.sql` is absent. Otherwise implement exactly the acceptance list of Card A in `prompts/60_user_track.md`, including the integrity-check queries and the good/bad fixtures under `tests/fixtures/sql/`.
- [ ] Prove each test file collects and skips cleanly with the author files absent: paste `uv run pytest -m user_track -q`.

## Gate and report

Blocking (AI path): `npm run check` green; fixtures F1-F7 green; invariants I1-I12 green; M/M/c green; schemas valid; `uv run pytest -q`, `check_docs --all` and `bash scripts/check_all.sh --manual` green; guard pipe test shows exit 2; `Math.random` grep clean; no golden file changed after creation. Then the orchestrator runs `sim-adversary` once on the engine (you do not call it). Non-blocking (author path): `uv run pytest -m user_track` once the author has written the files.
Mutation spot check to run yourself and report, in a scratch copy: sort admission by `sampled_at` and confirm F1 fails; check the window only at start and confirm F2 rows 2 and 3 fail; key the RNG without `attempt` and confirm F3/I7 fail.
Report at most 300 words (format in `prompts/README.md`). Append the `docs/progress.md` entry.

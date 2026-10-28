# 10 — S1 executor brief: contracts, hand fixtures, TS engine L1-L3

Read `prompts/00_master_build.md` first; its invariants and definition of done apply. Executor: Sonnet, effort xhigh. Estimated 3-4 h.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination (S1): SDD + TDD + EDD + BDD + YAGNI + HITL; always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
Scenarios become Given-When-Then acceptance tests (BDD), named after the scenario id. Hand fixtures and the M/M/c values are the evals (EDD).
Commits follow Tidy First + Small Batches: structure-only changes apart from behaviour changes, each step testable. You leave changes uncommitted, so report structure-only changes separately.
HITL gates touched: the author's implementation track (acceptance tests only), ADRs (`Proposed` only).

## Goal

A deterministic TypeScript engine for layers L1-L3 with profiles, judged only by invariants, hand-calculated fixtures and an M/M/c validation mode. Plus the contracts (JSON Schemas), the SimPy trace interface, and acceptance tests for the two things the author writes: the SimPy core loop and the canonical DDL.

## Allowed paths

Create or edit: `engine/`, `schemas/`, `scenarios/`, `tests/` (incl. `tests/fixtures/`, `tests/golden/`, `tests/user_track/`), root `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `pyproject.toml`/`uv.lock` (via `uv add --dev`), `scripts/check_all.sh` (append lint, typecheck, test, `Math.random` grep only), `.claude/user_owned.txt` (append the three author paths), `docs/design/` (only if a design doc needs an S1 clarification), `docs/progress.md`, Proposed ADRs for stack choices not already covered.
Never create or edit: `sql/`, `reference/`, `src/` (UI, S3), `docs/research/*.yaml`, `docs/private/`, `infographic/`.

## Step 0 — rails and ownership

- [ ] Read `.guardrails.local.txt`, `CLAUDE.md`, the last entry of `docs/progress.md`, `docs/design/simulation_spec.md`, `docs/research/assumptions.yaml` (ids only; never copy values into code).
- [ ] Append `sql/schema.sql`, `sql/queries/asof_join.sql`, `sql/queries/lineage_recursive.sql`, `sql/queries/bridging_offset.sql`, `reference/sim_core.py` to `.claude/user_owned.txt` (one per line, no duplicates). Prove the guard works: pipe a PreToolUse `Write` JSON for `reference/sim_core.py` into `scripts/hooks/guard_tools.py`; expect exit 2. Paste it. Do not create these files.

## Step 1 — reproducibility contract (encode as named tests in `engine/tests/contract/`)

Test names are the documentation; do not restate the rules in another prose file.

| Rule | Contract |
|---|---|
| Time | Integer seconds from scenario t0 = day 0, 00:00:00. The engine has no timezones; clock skew is an L4 offset. Sampled continuous durations are rounded with `Math.floor(x + 0.5)`, minimum 1 s |
| Event priority at equal `t` (ascending) | 0 capacity restored (`window_end`, `analyzer_up`); 1 `run_end` (frees analyzer, emits result, may re-enqueue a rerun); 2 `arrival` (enqueue); 3 capacity removed (`window_start`); 4 `dispatch` |
| Tie-break inside a priority | ascending `seq`, a global integer assigned when the event is scheduled (an arrival gets its `seq` when the sample is drawn; a rerun when it is re-enqueued) |
| Windows | half-open `[start, end)`. A run may start at `t` only if `[t, t + service)` intersects no window of that analyzer (a run ending exactly at `window_start` is allowed). If the queue head does not fit, the analyzer idles until `window_end`. No backfill: strict head of line. Record this simplification in `docs/progress.md` as a modelling choice |
| Queue policies | `fifo` (order by arrival time at that analyzer, then `seq`) and `edf` (earliest deadline, then arrival, then `seq`). Dispatch gives the head to the lowest-index idle, available analyzer first |
| Measurement instant | The analyte is read at `run_started_at`; the sample's true state is evaluated at that instant (stability effects accumulate from `sampled_at`). `measured_at` as an architecture stamps it is an L4 concern; the engine emits `run_started_at` and `run_ended_at` |
| Reruns | A failed run re-enqueues the same physical sample with `attempt + 1`, arrival time = the failure time, new `seq`. The failed attempt stays in the truth log; its result is `invalidated_qc`, the rerun's is `released` |
| RNG | `pure-rand` integer generator; stream per key `(seed, physical sample, analyte, attempt, purpose)`; stream seed from a 64-bit hash of the canonical key string (two 32-bit words). Test: no stream-seed collisions over 10^6 synthetic keys. Python never needs the RNG: SimPy consumes pre-drawn traces |
| Tolerance | Event times: exact (`===`). Real-valued truth states: `abs(a-b) <= 1e-9 * max(1, abs(b))` on the same platform; TS versus Python value parity: `1e-6` absolute |
| Log identity | Canonical JSONL (sorted keys, integers, no floats in times). `log_hash = sha256`, computed with Web Crypto. Same inputs give the same hash; a different seed gives a different hash |
| Golden files | `tests/golden/*.json` plus `tests/golden/CHECKSUMS.txt`. Created once in this session (record command and seed in `docs/progress.md`), then read-only. No script, flag or test rewrites them; a test verifies the checksums |
| Seeds | Neutral integers. A test fails any scenario seed matching `^(19|20)\d{6}$` |
| Portability | `engine/` imports no Node-only module (lint `no-restricted-imports` for `node:*`, `fs`, `process`, `Buffer`) so it runs in a Web Worker |

## Step 2 — schemas (single contract)

Write in `schemas/` (draft 2020-12), each with `schema_version` const `"1"`: `scenario.schema.json`, `profile.schema.json` (numeric parameters are `{value, unit, ref}`, `ref` pattern `^A\d{3}$|^S\d{3}$`), `event.schema.json` (truth and observable event types; hidden fields carry `"x-visibility": "hidden"`; `additionalProperties: false`), `trace.schema.json`, `trace_result.schema.json`.

- `trace`: `{schema_version, engine_version, seed, policy, analyzers:[{id, group}], setup:{from_method,to_method,seconds}[], windows:[{analyzer, start_s, end_s}], requests:[{request_id, seq, arrive_s, deadline_s?, visits:[{group, service_s, method?}]}], forced_outcomes:[{request_id, attempt, outcome}]}`. All randomness is drawn in TS and written into the trace; the SimPy side is deterministic.
- `trace_result`: `{schema_version, runs:[{request_id, attempt, visit, analyzer, start_s, end_s, outcome}]}` sorted by `(start_s, analyzer, request_id, attempt)`.
- TS types generated into `engine/src/generated/` by `npm run gen:types` (`json-schema-to-typescript`, exact version). A test regenerates to a temp path and fails on drift. Python validates samples with `jsonschema` (`uv add --dev jsonschema`).
- [ ] Tests: each schema compiles; one valid and one invalid example per schema; profile with a bare number or an unknown `ref` is rejected (cross-checked against ids in `docs/research/assumptions.yaml`).

## Step 3 — hand fixtures first (red before any engine code)

Store as JSON in `tests/fixtures/hand/F#_*.json` with `inputs`, `expected` and a `derivation` string showing the arithmetic. Service time 600 s and the clock times below are fixture-only inputs, not domain claims. Type the expected values from this brief; never copy them from engine output. Both the TS runner and, later, the author's SimPy loop read these files.

**F1 Arrival reversal** (1 analyzer, FIFO by arrival at the analyzer, service 600 s)

| sample | sampled | transport | arrives |
|---|---|---|---|
| X | 08:40:00 | 25 min | 09:05:00 |
| Y | 08:50:00 | 10 min | 09:00:00 |
| Z | 08:55:00 | 10 min | 09:05:00 |

Expected: Y 09:00:00-09:10:00 (wait 0); X 09:10:00-09:20:00 (wait 300); Z 09:20:00-09:30:00 (wait 900; ties X at arrival, X has the lower `seq`). Holding (sampled to run start): Y 600, X 1800, Z 1500. A sampling-time-ordered admission would start X at 09:05:00 and Y at 09:15:00, so this fails it.
F1b, same samples with 2 analyzers: Y AN-1 09:00:00-09:10:00; X AN-2 09:05:00-09:15:00; Z AN-1 09:10:00-09:20:00.

**F2 Window boundary** (1 analyzer, service 600 s, window `[09:30:00, 10:00:00)`; each row is its own run on a fresh engine)

| arrival | start | end |
|---|---|---|
| 09:20:00 | 09:20:00 | 09:30:00 |
| 09:20:01 | 10:00:00 | 10:10:00 |
| 09:25:00 | 10:00:00 | 10:10:00 |
| 09:45:00 | 10:00:00 | 10:10:00 |
| 10:00:00 | 10:00:00 | 10:10:00 |

The first row ends exactly at `window_start` and is allowed; every other row would overlap the window if only the start time were checked.

**F3 One rerun** (1 analyzer, FIFO, service 600 s; P arrives 09:00:00, Q 09:05:00, R 09:25:00; forced outcome: P attempt 1 = `qc_fail`)

Expected: P#1 09:00:00-09:10:00 (`invalidated_qc`); Q 09:10:00-09:20:00; P#2 09:20:00-09:30:00 (`released`); R 09:30:00-09:40:00. Control run without the forced failure: P 09:00:00, Q 09:10:00, R 09:25:00-09:35:00. Assertions: R's start differs by 300 s while R's measured values are identical in both runs (keyed RNG); P#2's noise draw differs from P#1's; the truth log keeps both attempts of P; a rerun with reason `over_range` carries `dilution_factor` on attempt 2 in the truth log.

**F4 Tandem visit** (profile `split_cellcounter_metabolite`: counter service 120 s then metabolite analyzer service 300 s, zero transfer; A arrives 09:00:00, B 09:00:30)

Expected counter: A 09:00:00-09:02:00, B 09:02:00-09:04:00. Metabolite: A 09:02:00-09:07:00, B arrives 09:04:00, runs 09:07:00-09:12:00. Each visit is its own run with its own instrument id.

**F5 Setup change** (profile `hplc`: service 600 s, setup 900 s when the method differs from the loaded one; loaded at start = method T; P (T), Q (S), R (T) all arrive 09:00:00 with `seq` 1, 2, 3)

Expected: P 09:00:00-09:10:00; Q setup 09:10:00-09:25:00, run 09:25:00-09:35:00; R setup 09:35:00-09:50:00, run 09:50:00-10:00:00. Busy 3600 s, productive 1800 s: utilisation is reported with and without setup.

**F6 Rack burst** (2 analyzers, FIFO, service 600 s, automated delivery: V1..V6 all arrive 08:30:00, `seq` 1..6)

Expected starts: V1 AN-1 and V2 AN-2 at 08:30:00; V3 AN-1 and V4 AN-2 at 08:40:00; V5 AN-1 and V6 AN-2 at 08:50:00. Waits 0, 0, 600, 600, 1200, 1200: the high-numbered vessels wait longest.

**F7 EDF** (1 analyzer, service 600 s, A/B/C all arrive 09:00:00; deadlines A 11:00:00, B 10:00:00, C 10:30:00)

Expected order B 09:00:00, C 09:10:00, A 09:20:00. FIFO on the same input gives A, B, C.

- [ ] Write a generic fixture runner and see all of F1-F7 fail (red) before writing the scheduler.

## Step 4 — scaffold (exact versions; re-check each with `npm view <pkg> version` or `uv` before installing)

| Tool | Version | Note |
|---|---|---|
| TypeScript | 6.0.3 | pinned: typescript-eslint 8.72.1 peers `typescript <6.1.0`; TS 7 is out of range |
| typescript-eslint | 8.72.1 | flat config |
| Vite | 8.3.5 | scaffold only; no UI in S1 |
| Vitest | 5.0.5 | |
| pure-rand | 8.4.2 | |
| ESLint, json-schema-to-typescript, others | latest compatible | pin exact, record in `docs/progress.md` |
| SimPy | 4.1.2 | `uv add simpy` so the author's loop can import it |
| pytest, jsonschema, duckdb | `uv add --dev` | DuckDB for the DDL acceptance test |

If a planned version does not install, use the nearest compatible one and log it; never upgrade silently. Node comes from `.nvmrc`.
- [ ] `package.json` scripts: `lint`, `typecheck`, `test`, `gen:types`, `check` (= all four). `npm run check` must pass.
- [ ] ESLint bans: `Math.random`, `Date.now`, `new Date`, Node-only imports, in `engine/`. Append the same `Math.random` grep (excluding `node_modules`, tests that assert the ban, and this lint config) to `scripts/check_all.sh`. Show the grep failing on a planted violation in a scratch copy, then passing.
- [ ] pytest config in `pyproject.toml`: register marker `user_track`; default `addopts = -m "not user_track"` so `uv run pytest -q` stays the AI-path gate.

## Step 5 — engine (build only what a red test demands)

Modules under `engine/src/`: `rng` (keyed streams), `clock/events` (queue with the contract above), `process` (L1), `sampling` (L2), `analysis` (L3), `profiles` (loader), `observe` (truth to observable projection), `trace` (export), `scenario` (loader), `mmc` (validation mode).

- **L1:** batches with staggered inoculation; simple kinetics (growth limited by nutrient, nutrient consumption proportional to viable cells, product from integrated viable cells) integrated at a fixed 60 s step; online sensor series every 60 s; scheduled events (feed, temperature shift, alarm) from the scenario. No feedback. Parameters from profiles with `ref`s.
- **L2:** planned sampling windows to actual draw (shift burst, weekend gap, handling time from the staff profile), label, transport, aliquot storage condition, stability effects between `sampled_at` and `run_started_at` (kind, container open or closed, parameters with `ref`s). An effect applied beyond the range its source covers sets `extrapolated: true` on the truth event. Volume budget from the bioreactor profile: over-budget draws are skipped and logged.
- **L3:** queue policies `fifo` and `edf`; planned windows; multi-visit routing; sequence-dependent setup; reruns (`qc_fail`, `over_range` with `dilution_factor`); instrument state series (drift random walk, lot id, inter-instrument bias, calibration reset); measurement noise from keyed streams. No unplanned breakdown (YAGNI: no catalogue scenario needs it).
- **Operator and qualification** ride on `sample_drawn` truth events (`operator_id`, `qualified`), used by S2.
- **Profiles:** defaults `bench_manual`, `allinone_atline`, staff roster all `experienced`. Also ship `micro_mini_parallel`, `pilot`, `split_cellcounter_metabolite`, `hplc` and `trainee` as data. Test that switching a profile changes only data, with no engine change (`git grep` finds no profile id in `engine/src/`).
- **Scenarios:** `scenarios/sc02_shift_burst.json` (08:30 burst versus staggered window) and `scenarios/sc05_one_analyzer_down.json` (4 h maintenance window, FIFO versus EDF). Sanity tests state relations only: staggering lowers p90 holding; the window raises holding for samples that arrive during or just before it; EDF changes who bears the cost versus FIFO.

## Step 6 — invariant tests (loop over at least 200 seeds each)

I1 no analyzer double occupancy. I2 sample conservation: every sample ends in exactly one terminal state (measured, skipped by volume budget, rejected) and counts reconcile. I3 a released result is never mutated; changes create new versions. I4 time monotone: `sampled_at <= arrived_at <= run_started_at <= run_ended_at`. I5 no run intersects a window. I6 queue discipline equals the policy's definition, recomputed independently in the test. I7 keyed-RNG independence (F3 generalised: adding or removing a rerun never changes another sample's draws). I8 observation contract: perturbing `x-visibility: hidden` fields leaves recorder-visible output byte-identical. I9 determinism: same inputs, same `log_hash`, across two Node processes. I10 volume budget never exceeded. I11 `feedback` defaults to false and truth output is independent of any L5 stub.

## Step 7 — M/M/c validation mode (engine unit test only)

`mode: "mmc_validation"`: Poisson arrivals, exponential service, `c` servers, FIFO, no transport, windows, shifts, noise or reruns.
Hand-calculated target: `c = 2`, mean service 270 s, utilisation 0.8, so `lambda = 0.8 * 2 / 270 = 0.005926 /s`, offered load `a = 1.6`. Erlang C: `P(wait) = 6.4 / (2.6 + 6.4) = 32/45 = 0.7111`; `Wq = P(wait) / (c*mu - lambda) = 0.7111 / 0.0014815 = 480 s`.
Test: 30 replications with seeds 1..30, each 20,000 departures after discarding the first 2,000. Pass if the mean of replication means is within 3% of 480 s, 480 s lies inside the 95% t-interval of the replication means, and measured utilisation is within 0.02 of 0.8. Seeds are fixed in advance; if it fails, fix the engine, never the seeds. State in the test header that integer-second rounding is a known tiny bias and that real scenarios are M/D/c-like and are not validated by this test.

## Step 8 — trace export and author-track acceptance tests (non-blocking gate)

- [ ] `trace` exporter: any scenario run, plus F1-F7, exports `trace.json` valid against its schema. Examples under `tests/fixtures/traces/`: F1-F7 and 20 engine-generated traces with `expected_result` marked `"source": "ts-engine-golden"` (parity only, not truth).
- [ ] `tests/user_track/test_sim_core_parity.py` (marker `user_track`): skip with a clear message if `reference/sim_core.py` is absent. Otherwise run `uv run python reference/sim_core.py <trace.json> <out.json>` for each trace, validate against `trace_result.schema.json`, and compare: F1-F7 against the hand expectations; the 20 traces against `expected_result`, exact equality on integer times.
- [ ] `tests/user_track/test_schema_sql.py` (marker `user_track`): skip if `sql/schema.sql` is absent. Otherwise, in in-memory DuckDB: the file executes cleanly; the required names exist (`prompts/60_user_track.md`, card A); duplicate `(request_id, analyte, version)` is rejected; `NULL` `run_id` or `measured_at` is rejected; `sampled_at` exists only on `sample`; time columns are `TIMESTAMP`-typed; `tests/fixtures/sql/single_sample.sql` loads; the portability deny-list finds nothing.
- [ ] Prove each test file collects and skips cleanly with the author files absent: paste `uv run pytest -m user_track -q`.

## Gate and report

Blocking (AI path): `npm run check` green; fixtures F1-F7 green; invariants I1-I11 green; M/M/c green; schemas valid; `uv run pytest -q` and `check_docs --all` green; guard pipe test shows exit 2; `Math.random` grep clean; no golden file changed after creation. Non-blocking (author path): `uv run pytest -m user_track` once the author has written the files.
Mutation spot check to run yourself and report: temporarily sort admission by `sampled_at` and confirm F1 fails; check the window only at start and confirm F2 fails; key the RNG without `attempt` and confirm F3/I7 fail. Revert each.
Report at most 300 words (format in `prompts/README.md`). Append the `docs/progress.md` entry.

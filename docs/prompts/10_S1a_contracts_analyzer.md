# 10 — S1a executor brief: contracts, hand fixtures, L3 analyzer core

Read `docs/prompts/00_master_build.md` first; its invariants and definition of done apply. Executor: Sonnet, effort xhigh. Estimated 2-3 h. First half of the engine session: S1b (`docs/prompts/11_S1b_process_sampling.md`) starts after this gate passed and the orchestrator recorded the rubric result. Card C of `docs/prompts/60_user_track.md` (`reference/simpy/sim_core.py`) can be written as soon as this gate passes (ADR-0022: by an AI executor, clean-room from the specification).

## Working principles (mandatory)

Principles: see `docs/prompts/PRINCIPLES.md`. Stage combination (S1a): SDD + TDD + EDD + BDD + YAGNI + HITL; always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
Hand fixtures and the analytic M/M/c values are the evals (EDD). The catalogue scenarios SC2 and SC5 (BDD) are S1b.
You never commit. Tidy First is applied by the orchestrator: report your structure-only paths and your behaviour paths as two lists.
HITL gates touched: the SQL and SimPy track of ADR-0010 and ADR-0022 (acceptance tests only), ADRs (`Proposed` only).

## Goal

The contracts (reproducibility rules, JSON Schemas, the SimPy trace interface), the L3 analyzer core in TypeScript (queue, windows, setup, routing, reruns, M/M/c-only mode), and acceptance tests for the two things written afterwards (by AI, clean-room, ADR-0022): the SimPy core loop and the canonical DDL. Judged only by hand-calculated fixtures, invariants I1-I9 and an M/M/c check. What L3 means is in `docs/design/simulation_spec.md` §2.3; this brief does not restate it.

Not in S1a (S1b): L1, L2, profiles and their loader, scenarios, instrument state series, SC2, SC5, I10-I12, the golden event logs. In S1a the L3 core takes plain input objects and reads no profile, scenario or ledger value; every number here is a fixture or test-only input.

## Allowed paths

Create or edit: `engine/` (modules in Step 5 only), `data/schemas/`, `tests/` (incl. `tests/fixtures/{hand,traces,schemas,sql}/`, `tests/golden/parity/`, `tests/user_track/`), root `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `pyproject.toml`/`uv.lock` (via `uv add --dev`), `.claude/user_owned.txt` (Step 0), `docs/design/` (only if a design doc needs an S1a clarification), `docs/progress.md`, Proposed ADRs for stack choices not already covered.
Not expected to change: `scripts/check_all.sh` already runs `npm run check` once `package.json` exists and carries the `Math.random` grep. If either is missing or wrong, report it to the orchestrator instead of editing.
Never create or edit: `reference/`, `src/` (UI, S3), `data/scenarios/` and `tests/golden/*` other than `tests/golden/parity/` (S1b), `docs/research/*.yaml`, `docs/private/`, `site/infographic/`.

## Step 0 — rails, ownership, live hooks

The session must have been started inside the repo, so the hooks of `.claude/settings.json` are live.

- [ ] Read `.guardrails.local.txt`, `.claude/CLAUDE.md`, the last entry of `docs/progress.md`, `docs/design/simulation_spec.md` (§2.3, §3), `docs/design/data_model.md` (§5, §6), `docs/research/assumptions.yaml` (ids only, for the `ref` checks of Step 2; never copy values into code).
- [ ] The SessionStart brief (last progress entry and every `Proposed` ADR) must already be printed at the top of this session. If it is not, stop and report.
- [ ] Run `bash scripts/check_all.sh --manual`, `uv run pytest -q` and `uv run --frozen python scripts/check_docs.py --all` once before changing anything (paste the tails).
- [ ] Replace the commented placeholder lines of `.claude/user_owned.txt` with the five paths of the track (the author's at the time of ADR-0010; the list has been empty since ADR-0022, so this step is history), one per line, no duplicates: `reference/sql/schema.sql`, `reference/sql/queries/asof_join.sql`, `reference/sql/queries/lineage_recursive.sql`, `reference/sql/queries/bridging_offset.sql`, `reference/simpy/sim_core.py`. Do not create these files. This is the first Write or Edit of the session: immediately afterwards `ls -l .claude/.dirty` must show the marker (the PostToolUse hook creates it; the Stop gate removes it at the end of the turn). Paste it.
- [ ] Live guard test: call the `Write` tool on `reference/simpy/sim_core.py`, which does not exist yet. Use `Write`, not `Edit`: the `Edit` tool checks that the file exists before any PreToolUse hook runs, so on a missing file it fails with file-not-found and never reaches the guard. The write must be denied by the `guard_tools` PreToolUse hook with a message naming a user-owned path. If the file is created, the guard is not live: stop and report, and delete nothing without the orchestrator. Paste the denial, then show `git status --short -uall -- sql reference` is empty.
- [ ] Any failure above (no brief, no marker, edit not denied): stop and report to the orchestrator. Do not substitute a piped hook test and do not edit hooks or settings.

## Step 1 — reproducibility contract (encode as named tests in `engine/tests/contract/`)

Test names are the documentation; do not restate the rules in another prose file. Event names follow `docs/design/simulation_spec.md` §2, state names `docs/design/data_model.md` §6.

| Rule | Contract |
|---|---|
| Time | Integer seconds from scenario t0 = day 0, 00:00:00. The engine has no timezones; clock skew is an L4 offset. Sampled continuous durations are rounded with `Math.floor(x + 0.5)`, minimum 1 s |
| Event priority at equal `t` (ascending) | 0 capacity restored (`maintenance_ended`, `qc_window_ended`); 1 `visit_finished` (frees the analyzer, emits the result, may re-enqueue a rerun); 2 `request_queued` (arrival); 3 capacity removed (`maintenance_started`, `qc_window_started`); 4 `dispatch` (internal, not logged; its effects are the logged `visit_started` and `run_started`) |
| Tie-break inside a priority | ascending `seq`, a global integer assigned when the event is scheduled (an arrival gets its `seq` when the sample is drawn; a rerun when it is re-enqueued) |
| Windows | half-open `[start, end)`. A run may start at `t` only if `[t, t + setup + service)` intersects no window of that analyzer, where `setup` is the setup that run needs at `t` (0 when the method is unchanged); a run ending exactly at the window start is allowed. If the queue head does not fit, the analyzer idles until the window ends. No backfill: strict head of line. Record this simplification in `docs/progress.md` as a modelling choice |
| Queue policies | `fifo` (order by arrival time at that analyzer, then `seq`) and `edf` (earliest deadline, then arrival, then `seq`). Dispatch gives the head to the lowest-index idle, available analyzer first |
| Time fields | `hold_time`, `turnaround` and `measured_at` are defined in `docs/design/data_model.md` §5. `sample.arrived_at` is the receipt at the analyzer bench. `visit_started` (sample loaded on an instrument) precedes `run_started` (the instrument run begins, after any setup; column `run.started_at`, written `run_started_at` in formulas). The sample's true state is evaluated at `run_started_at`. Truth `measured_at` is `run.ended_at` of the run that produced the value. `turnaround` is an S2 quantity (recorded `available_at`). The engine emits `run.started_at` and `run.ended_at`; only L4 may skew a stamp |
| Reruns | A run with outcome `qc_failed` or `over_range` emits `rerun_requested` and re-enqueues the same physical sample with `attempt + 1`, arrival time = `run.ended_at`, new `seq`. In S1 `qc_failed` is a run-level QC failure that leads to a re-run (S1a forces it; S1b draws it with probability A088); the analyzer hold of A087 (scenario SC7) is deferred to S2, so nothing in S1 holds results or blocks the analyzer. The failed attempt stays in the truth log with run QC outcome `qc_failed`; the rerun's run is `qc_passed` |
| RNG | One canonical key tuple everywhere: `(run_seed, physical_sample_id, analyte, attempt, purpose)`; a draw that belongs to a unit, an instrument or a generator puts that entity's id in the second slot and `-`, `0` in the next two. No other tuple shape exists, the M/M/c mode included (`purpose` = `arrival` or `service`, request index as id). Stream seed = splitmix64 hash of the canonical key string (fields joined by a separator no id can contain), computed with `BigInt` modulo 2^64, synchronously (no Web Crypto, no `await`), split into the words the PRNG needs. **Install check:** verify which seed width the chosen PRNG constructor accepts and record it in `docs/progress.md`; if it is narrower than 64 bits, take further words from the same splitmix64 sequence, never truncate silently. **Collision test:** sized to what a run uses: up to 200 seeds (A103 upper bound) times the streams of the default scenario, enumerated from the run itself, never hard-coded, with zero stream-seed collisions asserted. S1a runs it over the streams its modules draw (L3 noise, M/M/c, test workloads); S1b re-runs the same test on the default scenario. Python never needs the RNG: SimPy consumes pre-drawn traces |
| Tolerance | Event times: exact (`===`). Real-valued truth states: `abs(a-b) <= 1e-9 * max(1, abs(b))` on the same platform; TS versus Python value parity: `1e-6` absolute |
| Log identity | Canonical JSONL (sorted keys, integers, no floats in times). `log_hash = sha256`, computed with Web Crypto. Same inputs give the same hash; a different seed gives a different hash |
| Golden files | Created once, each with the command and seeds recorded in `docs/progress.md`, then read-only: no script, flag or test rewrites them, a test verifies the checksums, and a change needs the author's approval (`00 §2` item 9). Two sets: the 20 parity traces of Step 8 in `tests/golden/parity/` with its own `CHECKSUMS.txt` (S1a), and the default-scenario event logs of S1b Step 4 |
| Seeds | Neutral integers. A test fails any scenario seed matching `^(19|20)\d{6}$` |
| Portability | `engine/src/**` imports no Node-only module (lint `no-restricted-imports` for `node:*`, `fs`, `process`, `Buffer`) so it runs in a Web Worker. The ban covers `engine/src/**` only; tests may use Node modules to load fixtures |

## Step 2 — schemas (single contract)

Write in `data/schemas/` (draft 2020-12), each with `schema_version` const `"1"`: `scenario.schema.json`, `profile.schema.json` (numeric parameters are `{value, unit, ref}`, `ref` pattern `^A\d{3}$|^S\d{3}$`; profile ids are free strings, never an enum), `event.schema.json` (the envelope and the L3 event types; hidden fields carry `"x-visibility": "hidden"`; `additionalProperties: false`; S1b adds the L1 and L2 types additively), `trace.schema.json`, `trace_result.schema.json`. Field names follow `docs/design/data_model.md` (`00 §2`, item 11).

- `trace`: `{schema_version, engine_version, seed, policy, analyzers:[{id, group, initial_method}], setup:{from_method,to_method,seconds}[], windows:[{analyzer, start_s, end_s}], requests:[{request_id, seq, arrive_s, deadline_s?, visits:[{group, service_s, method_id?, transfer_s?}]}], forced_outcomes:[{request_id, attempt, visit, outcome}], expected_result?, source?}`. `initial_method` is the method installed on that analyzer at t0 (`null` = none, so the first run needs no setup); a trace alone must reproduce every setup. `transfer_s` is the transfer time between instruments before that visit (visits after the first, the split-analyzer case; absent or 0 on the first visit, whose arrival is `arrive_s`). `attempt` and `visit` count from 1. `outcome` is one of `qc_passed`, `qc_failed`, `over_range`. `expected_result` (a `trace_result`) and `source` (`hand` or `ts-engine-golden`) are fixture metadata kept inside the schema: examples carry them, engine exports do not, and the SimPy side ignores them. All randomness is drawn in TS and written into the trace; the SimPy side is deterministic.
- `trace_result`: `{schema_version, engine_version, seed, runs:[{request_id, attempt, visit, analyzer, setup_s, start_s, end_s, outcome}]}` sorted by `(start_s, analyzer, request_id, attempt)`. `start_s` is `run_started`, `end_s` is `run.ended_at`, `setup_s` is the setup applied immediately before the run (0 if none), so the visit began at `start_s - setup_s`. `engine_version` and `seed` are copied from the trace.
- TS types are generated into `engine/src/generated/` by `npm run gen:types` (`json-schema-to-typescript`, exact version). A test regenerates to a temp path and fails on drift. Python validates samples with `jsonschema` (`uv add --dev jsonschema`).
- Valid examples live in `tests/fixtures/schemas/valid/`, invalid ones in `tests/fixtures/schemas/invalid/` (the docs check exempts `tests/`); never under `engine/`.
- [ ] Tests: each schema compiles; one valid and one invalid example per schema; a profile with a bare number or an unknown `ref` is rejected (cross-checked against ids in `docs/research/assumptions.yaml`); a trace without `initial_method` and a result without `engine_version` or `seed` are rejected; a test fails if `profile.schema.json` or a generated type enumerates profile ids.

## Step 3 — hand fixtures first (red before any engine code)

Store as JSON in `tests/fixtures/hand/F#_*.json` with `inputs`, `expected` and a `derivation` string showing the arithmetic. Service times, setup times and clock times below are fixture-only inputs, not domain claims; analyzer configuration is inline in `inputs` (no profile is loaded in S1a, the profile names below only describe the shape). Type the expected values from this brief; never copy them from engine output. Both the TS runner and, later, the SimPy loop (written by AI, ADR-0022) read these files.

**F1 Arrival reversal** (1 analyzer, FIFO by arrival at the analyzer, service 600 s)

| sample | sampled | transport | arrives |
|---|---|---|---|
| X | 08:40:00 | 25 min | 09:05:00 |
| Y | 08:50:00 | 10 min | 09:00:00 |
| Z | 08:55:00 | 10 min | 09:05:00 |

Expected: Y 09:00:00-09:10:00 (wait 0); X 09:10:00-09:20:00 (wait 300); Z 09:20:00-09:30:00 (wait 900; ties X at arrival, X has the lower `seq`). `hold_time` (sampled to `run_started_at`): Y 600, X 1800, Z 1500. A sampling-time-ordered admission would start X at 09:05:00 and Y at 09:15:00, so this fails it.
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

**F2b Setup counts in the pre-check** (as F2 but setup 900 s because the method differs from the loaded one; `initial_method` T, the request needs S)

| arrival | setup | run | what it checks |
|---|---|---|---|
| 09:00:00 | 09:00:00-09:15:00 | 09:15:00-09:25:00 | `[t, t + setup + service)` = `[09:00:00, 09:25:00)` clears the window: allowed |
| 09:10:00 | 10:00:00-10:15:00 | 10:15:00-10:25:00 | `[09:10:00, 09:35:00)` hits the window: idle until it ends, then setup |

Row 2 is discriminating: a pre-check over the service alone (`[09:10:00, 09:20:00)`) would start the setup at 09:10:00 and run 09:25:00-09:35:00 across the window.

**F3 One rerun** (1 analyzer, FIFO, service 600 s; P arrives 09:00:00, Q 09:05:00, R 09:25:00; forced outcome: P attempt 1 visit 1 = `qc_failed`)

Expected: P#1 09:00:00-09:10:00 (`qc_failed`); Q 09:10:00-09:20:00; P#2 09:20:00-09:30:00 (`qc_passed`); R 09:30:00-09:40:00. Control run without the forced failure: P 09:00:00, Q 09:10:00, R 09:25:00-09:35:00. Assertions: R's start differs by 300 s while R's noise draws are identical in both runs (keyed RNG, drift and stability effects off); P#2's noise draw differs from P#1's; the truth log keeps both attempts of P. F3b forces `over_range` instead (same timeline): the truth log carries a fixture-only `dilution_factor` on attempt 2.

**F4 Tandem visit** (two groups modelled on the split cell-counter plus metabolite analyzer: counter service 120 s then metabolite analyzer service 300 s, `transfer_s` 0; A arrives 09:00:00, B 09:00:30)

Expected counter: A 09:00:00-09:02:00, B 09:02:00-09:04:00. Metabolite: A 09:02:00-09:07:00, B arrives 09:04:00, runs 09:07:00-09:12:00. Each visit is its own run with its own instrument id. A variant with `transfer_s` 60 on the second visit moves the metabolite arrivals to 09:03:00 and 09:05:00 and the runs to A 09:03:00-09:08:00, B 09:08:00-09:13:00.

**F5 Setup change** (an HPLC-like analyzer: service 600 s, setup 900 s when the method differs from the loaded one; the trace sets `initial_method` = T; P (T), Q (S), R (T) all arrive 09:00:00 with `seq` 1, 2, 3)

Expected: P 09:00:00-09:10:00; Q setup 09:10:00-09:25:00, run 09:25:00-09:35:00; R setup 09:35:00-09:50:00, run 09:50:00-10:00:00. Busy 3600 s, productive 1800 s (the engine emits both; utilisation per staffed window and per 24 h is an S2 metric computed from them). The same input with `initial_method` = S gives P setup 09:00:00-09:15:00, so the initial method changes the outcome and must travel in the trace.

**F6 Rack burst** (2 analyzers, FIFO, service 600 s, automated delivery: V1..V6 all arrive 08:30:00, `seq` 1..6)

Expected starts: V1 AN-1 and V2 AN-2 at 08:30:00; V3 AN-1 and V4 AN-2 at 08:40:00; V5 AN-1 and V6 AN-2 at 08:50:00. Waits 0, 0, 600, 600, 1200, 1200: the high-numbered vessels wait longest.

**F7 EDF** (1 analyzer, service 600 s, A/B/C all arrive 09:00:00; deadlines A 11:00:00, B 10:00:00, C 10:30:00)

Expected order B 09:00:00, C 09:10:00, A 09:20:00. FIFO on the same input gives A, B, C.

Two common discrete-event pitfalls are the regression targets of F1 (admission ordered by sampling time although transport can reverse arrival order) and F2 (a window checked only at the start time).

- [ ] Write a generic fixture runner and see all of F1-F7 (with F1b, F2b and the F3b and F4 variants) fail (red) before writing the scheduler.

## Step 4 — scaffold (exact versions; re-check each with `npm view <pkg> version` or `uv` before installing)

| Tool | Version | Note |
|---|---|---|
| TypeScript | 6.0.3 | pinned: typescript-eslint 8.72.1 peers `typescript <6.1.0`; TS 7 is out of range |
| typescript-eslint | 8.72.1 | flat config |
| Vite | 8.3.5 | scaffold only; no UI in S1 |
| Vitest | 5.0.5 | |
| pure-rand | 8.4.2 | seed width: see the RNG row of Step 1 |
| ESLint, json-schema-to-typescript, others | latest compatible | pin exact, record in `docs/progress.md` |
| SimPy | 4.1.2 | `uv add --dev simpy==4.1.2` so the SimPy loop can import it |
| pytest, jsonschema, duckdb | `uv add --dev` | DuckDB for the DDL acceptance test |

If a planned version does not install, use the nearest compatible one and log it; never upgrade silently. Node comes from `engines.node` in `package.json` (R3).
- [ ] `package.json` scripts: `lint`, `typecheck`, `test`, `gen:types`, `check`. `check` = lint + typecheck + test; `gen:types` is separate and not part of `check` (the drift test in `test` guards the generated types). `npm run check` must pass.
- [ ] ESLint, scope `engine/src/**` only: ban `Math.random`, `Date.now`, `new Date` and the Node-only imports of Step 1. Show the rule failing on a planted violation in a scratch copy, then passing. Show `bash scripts/check_all.sh --manual` failing on a planted `Math.random` in a scratch copy, then passing.
- [ ] pytest config in `pyproject.toml`: register marker `user_track`; default `addopts = -m "not user_track"` so `uv run pytest -q` stays the AI-path gate.

## Step 5 — L3 core (build only what a red test demands)

Modules under `engine/src/`: `rng` (keyed streams), `clock` (event queue with the contract above), `analysis` (L3 core), `observe` (truth to observable projection of the L3 events), `trace` (export), `mmc` (validation mode). `process`, `sampling`, `profiles` and `scenario` are S1b. Each module has one stated responsibility and stays at 300 lines or fewer.

- **L3 core:** queue policies `fifo` and `edf`; planned windows; multi-visit routing with per-visit transfer time; sequence-dependent setup from each analyzer's `initial_method`; reruns (`qc_failed`, `over_range` with `dilution_factor`) from forced outcomes; measurement noise from keyed streams with a standard deviation given in the input. No unplanned breakdown (YAGNI: no catalogue scenario needs it).
- **Requests also carry `sampled_s`** (not part of the trace: SimPy does not need it) so that `hold_time` and I4 can be computed from the core's output.
- **No domain values:** configuration, service times, setup times and noise arrive as plain inputs. If something the core needs has no input yet, stop and report it to the orchestrator; never invent a constant.
- **Test workload generator:** one test-support module, `engine/tests/support/workload.ts` (named by this brief, so rubric K does not flag it): a seeded random L3 workload (arrivals, services, windows, setups, policies, multi-visit routes, forced outcomes) drawn through `rng` with fixture-only ranges. Call sites: Step 6 invariants and the Step 8 parity traces.

## Step 6 — invariant tests (loop over at least 200 seeds each, on generated workloads)

I1 no analyzer double occupancy. I2 request conservation: every request ends with exactly one `qc_passed` run per visit, runs equal visits plus reruns, and counts reconcile (sample-level terminal states are S1b, once L2 exists). I3 a released result is never mutated; changes create new versions. I4 time monotone: `sampled_at <= sample.arrived_at <= run_started_at <= run.ended_at`, so `hold_time >= 0`. I5 no run intersects a window. I6 queue discipline equals the policy's definition, recomputed independently in the test. I7 keyed-RNG independence (F3 generalised: adding or removing a rerun never changes another request's noise draws, with drift and stability effects off). I8 observation contract: perturbing `x-visibility: hidden` fields leaves recorder-visible output byte-identical. I9 determinism: same inputs, same `log_hash`, across two Node processes. I10 to I12 are S1b.

## Step 7 — M/M/c check (engine unit test only)

`mode: "mmc_validation"` (a plain config, not a scenario file): Poisson arrivals, exponential service, `c` servers, FIFO, no transport, windows, shifts, noise or reruns. The numbers below are test-only inputs, not domain claims.
Hand-calculated target: `c = 2`, mean service 270 s, utilisation 0.8, so `lambda = 0.8 * 2 / 270 = 0.005926 /s`, offered load `a = 1.6`. Erlang C: `P(wait) = 6.4 / (2.6 + 6.4) = 32/45 = 0.7111`; `Wq = P(wait) / (c*mu - lambda) = 0.7111 / 0.0014815 = 480 s`.
Test: 100 replications with fixed seeds 1..100, each 20,000 departures after discarding the first 2,000. Pass if the mean of the replication means of Wq is within 3 % of 480 s (465.6 s to 494.4 s); the band is about 3.4 standard errors of that mean, per the reviewer's simulation, so a correct engine does not fail by chance. Seeds and tolerance are fixed in advance and never changed to pass. **If the check fails, stop and escalate to the orchestrator** with the replication means, their standard error and the measured utilisation; do not tune the engine, the seeds or the tolerance until it passes (the fault may be in the engine, the target or the test, and the orchestrator decides). State in the test header that integer-second rounding is a known tiny bias and that real scenarios are M/D/c-like and are not validated by this test.

## Step 8 — trace export and SQL and SimPy track acceptance tests (non-blocking gate)

- [ ] `trace` exporter: any L3 run exports `trace.json` valid against its schema. Examples: `tests/fixtures/traces/` holds F1-F7 and their variants, exported from each fixture's `inputs`, with `expected_result` converted from the hand-typed `expected` (never from engine output) and `source` = `hand`. `tests/golden/parity/` holds 20 engine-generated traces (workload seeds 1..20) with `expected_result` from the TS core and `source` = `ts-engine-golden` (parity only, not truth), created once by a recorded command with a `CHECKSUMS.txt`.
- [ ] `tests/user_track/test_sim_core_parity.py` (marker `user_track`): skip with a clear message if `reference/simpy/sim_core.py` is absent. Otherwise run `uv run python reference/simpy/sim_core.py <trace.json> <out.json>` for each trace, validate against `trace_result.schema.json`, check `engine_version` and `seed` equal the trace's, and compare: F1-F7 against the hand expectations; the 20 traces against `expected_result`, exact equality on integer times.
- [ ] `tests/user_track/test_schema_sql.py` (marker `user_track`): skip if `reference/sql/schema.sql` is absent. Otherwise implement exactly the acceptance list of Card A in `docs/prompts/60_user_track.md`, including the integrity-check queries and the good/bad fixtures under `tests/fixtures/sql/`.
- [ ] Prove each test file collects and skips cleanly with the five files absent: paste `uv run pytest -m user_track -q`.

## Gate and report

Blocking (AI path): `npm run check` green; fixtures F1-F7 and variants green; invariants I1-I9 green; M/M/c green; schemas valid; `uv run pytest -q`, `check_docs --all` and `bash scripts/check_all.sh --manual` green; the Step 0 live guard denial and `.dirty` marker shown; `Math.random` grep clean; no golden file changed after creation. `sim-adversary` is not called at the end of S1a (it runs once, at the end of S1b). Non-blocking (SQL and SimPy track): `uv run pytest -m user_track` once the files are written (ADR-0022: by AI, clean-room).
Mutation spot check to run yourself and report, in a scratch copy: sort admission by `sampled_at` and confirm F1 fails; check the window at the start time only and confirm F2 rows 2 and 3 fail; leave setup out of the pre-check and confirm F2b row 2 fails; key the RNG without `attempt` and confirm F3/I7 fail.
Report at most 300 words (format in `docs/prompts/README.md`). Append the `docs/progress.md` entry.

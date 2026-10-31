# 11 — S1b executor brief: L1 process, L2 sampling and logistics, profiles, SC2 and SC5

Read `prompts/00_master_build.md` first; its invariants and definition of done apply. Executor: Sonnet, effort xhigh. Estimated 2-3 h. Second half of the engine session: it starts only after the S1a gate passed and the orchestrator recorded the S1a rubric result in `docs/progress.md`, and only when its ledger inputs exist (Step 0). The golden event logs (Step 4) are generated after the orchestrator has reviewed the engine.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination (S1b): SDD + TDD + EDD + BDD + YAGNI + HITL; always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
Scenarios SC2 and SC5 become Given-When-Then acceptance tests in the format of PRINCIPLES.md section 2 (BDD). The S1a hand fixtures stay green and the golden event logs are the evals (EDD).
You never commit. Tidy First is applied by the orchestrator: report your structure-only paths and your behaviour paths as two lists.
HITL gates touched: ADRs (`Proposed` only). Step 4 runs only on the orchestrator's go-ahead.

## Goal

The rest of the deterministic TypeScript engine: L1 process model, L2 sampling and logistics, the profile and scenario loaders with the profiles of `docs/design/simulation_spec.md` §4, the instrument state series and measurement parameters of L3, the default scenario, SC2 and SC5, invariants I10-I12 and I1-I9 on the full engine, and the golden event logs. What L1, L2, the profiles and the scenarios mean is in the spec (§2, §4, §7); this brief does not restate it. The L3 core, the contracts and the schemas are S1a and are reused as they are.

## Allowed paths

Create or edit: `engine/` (new modules `process`, `sampling`, `profiles`, `scenario`; additions to `analysis`, `observe`, `trace`), `schemas/` (additive only: the L1 and L2 event types of `event.schema.json`, and the scenario and profile content; `trace.schema.json` and `trace_result.schema.json` are frozen because the author's code reads them, a change needs the orchestrator), `scenarios/` (incl. `scenarios/profiles/`), `tests/` (incl. `tests/fixtures/`, `tests/golden/`), `docs/design/` (only if a design doc needs an S1b clarification), `docs/progress.md`, Proposed ADRs. Dependencies: nothing new without a Proposed ADR.
Not expected to change: `package.json`, `eslint.config.js`, `scripts/check_all.sh`; if one is wrong, report it to the orchestrator instead of editing.
Never create or edit: `sql/`, `reference/`, `src/` (UI, S3), `tests/user_track/`, `docs/research/*.yaml`, `docs/private/`, `site/infographic/`.

## Step 0 — inputs and rails

- [ ] Read `.guardrails.local.txt`, `.claude/CLAUDE.md`, the S1a progress entry and everything it lists as open, `docs/design/simulation_spec.md` (§2, §3, §4, §7), `docs/design/data_model.md` (§5, §6), `schemas/`.
- [ ] Ledger inputs: every `A###` and `S###` id cited in `simulation_spec.md` §2 and §4, and in the SC2 and SC5 rows of §7, resolves in `docs/research/assumptions.yaml` or `docs/research/sources.yaml` with a default, range and unit (`uv run --frozen python scripts/check_docs.py --all` passes in strict mode). List any that do not. If a value the engine needs has no id, stop and report it to the orchestrator; never invent one.
- [ ] Run `npm run check`, `uv run pytest -q`, `uv run --frozen python scripts/check_docs.py --all` and `bash scripts/check_all.sh --manual` once before changing anything (paste the tails). The S1a fixtures and the M/M/c test must be green at the start.

## Step 1 — engine (build only what a red test demands)

Modules under `engine/src/`: `process` (L1), `sampling` (L2), `profiles` (loader), `scenario` (loader), plus additions to `analysis`, `observe` and `trace`. Every parameter value comes from a profile or scenario with a `ref`, read via the ids cited in the spec; the RNG contract, the reruns row and the time fields of `10_S1a_contracts_analyzer.md` Step 1 apply unchanged.

- **L1:** batches with staggered inoculation; simple kinetics (growth limited by nutrient, nutrient consumption proportional to viable cells, product from integrated viable cells) at the integration step and online sensor cadence the spec names; scheduled events (feed, temperature shift, alarm) from the scenario. No feedback.
- **L2:** planned sampling windows to actual draw (shift burst, weekend gap, handling time from the staff profile), label, transport, aliquot storage condition, stability effects between `sampled_at` and `run_started_at` (kind, container open or closed, parameters with `ref`s). An effect applied beyond the range its source covers sets `extrapolated: true` on the truth event. Volume budget from the bioreactor profile: over-budget draws are skipped (state `skipped`) and logged.
- **L3 additions:** instrument state series (drift random walk, lot id, inter-instrument bias, calibration reset); measurement noise from keyed streams with profile values; `qc_failed` drawn with probability A088 and `over_range` with `dilution_factor` as the spec defines them. No analyzer hold (A087, deferred to S2) and no unplanned breakdown (YAGNI).
- **Operators:** the staff profile gives each operator `operator.qualified` (training status); `sample_drawn` carries `operator_id`. Both are truth-side facts for S2.
- **Profiles:** defaults and the extra profiles the spec lists (§4), all as data. Profile ids are free strings in `profile.schema.json`, so no generated type enumerates them. Test that switching a profile changes only data: the profile-id grep of `90_review_rubric.md` B (the quoted ids) over `engine/src`, generated files included, is empty.
- **Scenarios:** `scenarios/default.json` (the defaults of ADR-0009 and the SC1 row of spec §7), `scenarios/sc02_shift_burst.json` and `scenarios/sc05_one_analyzer_down.json` (settings per spec §7). Their Given-When-Then tests (`describe("SC2 shift-start burst")`, `describe("SC5 one analyzer down")`) gate structural facts only, because metrics are reported, not gated (spec §8; `00` §2 item 8): for example, where each plan puts the planned times, that runs started before a window opens are identical with and without it, that no run occupies an analyzer inside its window. The metric questions (p90 `hold_time` with the burst versus the staggered window; `hold_time` of samples that arrive during or just before the maintenance window; who bears the cost under EDF versus FIFO) are reported in `docs/progress.md` over 20 seeds with the mean and the spread, whatever their sign, and are never asserted.
- **Trace export:** a scenario run exports the `trace.json` of its L3 part, valid against the schema; a test replays it through the S1a core and gets the same runs.

## Step 2 — invariant tests (default scenario, at least 200 seeds each)

I1-I9 of `10_S1a_contracts_analyzer.md` Step 6, re-run on the full engine with these extensions: I2 also at sample level (every sample ends in exactly one terminal state, `closed`, `discarded` or `skipped`, data_model §6, and counts reconcile); I4 over the whole chain with `sample.arrived_at`; I7 for L2 draws (identical draws, with drift and stability effects off); I8 over the L1 and L2 events; the stream-seed collision test of the RNG row, now on the default scenario (up to 200 seeds, A103 upper bound, times its streams). New here:
I10 volume budget never exceeded. I11 `feedback` defaults to false and truth output is independent of any L5 stub. I12 budget (`00 §4`): the engine run of the default scenario with one seed, from the call that starts it to the complete in-memory truth log and observable events, takes at most 1 s, median of 5 runs under Node as the proxy for the Web Worker; sensor-tick serialisation and log hashing are not in the measurement. The test header names the start and stop marks, and the report states the median.

## Step 3 — report and orchestrator review

Report as in `prompts/README.md`. Do not run Step 4 in this call. The orchestrator verifies on disk, applies the rubric, runs `sim-adversary` once on the engine (you do not call it), and orders at most one rework round.

## Step 4 — golden event logs (only on the orchestrator's go-ahead)

Runs in a short follow-up call after the rubric and adversary findings are closed. One recorded command (not an npm script, not a test) writes, for `scenarios/default.json` with seeds 1, 2 and 3: `tests/golden/default_seed{1,2,3}.trace.jsonl` (the canonical event log) and `tests/golden/default_seed{1,2,3}.summary.json` (`schema_version`, `engine_version`, `seed`, event count, `log_hash`, count per event type), plus `tests/golden/CHECKSUMS.txt`. Record the command, seeds and base commit in `docs/progress.md`. Afterwards a test verifies the checksums and that the engine reproduces each log byte-identically, comparing and never regenerating; S2 compares against the same files. Nothing may change these files without the author's approval recorded in `docs/progress.md`.

## Gate and report

Blocking (AI path): `npm run check` green; S1a fixtures and the M/M/c test still green; invariants I1-I12 green; SC2 and SC5 green; the profile-id grep clean; I12 measured; after Step 4, the golden checksum test green and `git status --short -uall -- tests/golden` showing only the files of Step 4; `uv run pytest -q`, `check_docs --all` and `bash scripts/check_all.sh --manual` green. Then the orchestrator runs `sim-adversary` once on the engine.
Mutation spot check to run yourself and report, in a scratch copy: add a branch on a profile id in `engine/src` and confirm the grep test fails; let a recorder-side function read a hidden field and confirm I8 fails; apply a stability effect beyond its source range without `extrapolated` and confirm its test fails.
Report at most 300 words (format in `prompts/README.md`). Append the `docs/progress.md` entry.

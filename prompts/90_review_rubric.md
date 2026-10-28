# 90 — Orchestrator review rubric

Used by the orchestrator after every executor delivery (S1, S2, and later sessions). The orchestrator verifies on disk, judges, and orders rework. It does not bulk-write deliverables.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination: every stage is reviewed against the full canon (SDD, TDD, BDD, EDD, YAGNI, AHA, SRP, Tidy First, HITL) in sections A-K below.
The orchestrator reviews and orders rework; it does not build. Rails: PRINCIPLES.md section 6. A rework order never waives a HITL gate.

## Procedure

1. **Evidence first.** An executor's report is a claim, not evidence. Run the commands yourself: `git status --short`, `ls -l` and `wc -l` on every claimed file, `uv run pytest -q`, `uv run --frozen python scripts/check_docs.py --all`, `bash scripts/check_all.sh`, and from S1 on `npm run check`. Compare claimed test counts with the real output.
2. **One pass of sections A-K.** Record each finding as `ID | severity | file:line or section | failing scenario | required evidence for the fix`. Severity: **blocker** (invalidates a result, leaks, or breaks a rail), **major** (a check fails or a required test is absent), **minor** (style, naming, nicety; goes to Parked, never blocks).
3. **Verdict.** PASS when there are no blockers and no majors. Otherwise REWORK with the ordered list.
4. **Rework.** One round. The executor fixes exactly the listed items and returns evidence for each. Re-check only those items. A second failure goes to the author. No new review rounds after PASS: report.
5. Mutation spot checks run in a scratch copy of the repo (`rsync -a --exclude node_modules --exclude .venv ./ <scratchpad>/copy/`), never in place.

## A. Test evidence on disk

- [ ] Every behaviour in the brief maps to a named test file that exists and ran in your run. List the mapping.
- [ ] Red evidence was reported for hand fixtures and invariants; spot-check one by the mutations in section B.
- [ ] No disabled tests: `git grep -nE "\.(only|skip)\(|xit\(|xdescribe|pytest\.mark\.skip\b" -- engine tests` is empty (the `user_track` skips for absent author files are the only exception).
- [ ] Goldens untouched since creation: the checksum test passes and `docs/progress.md` records the one creation command; any later golden diff without a recorded author approval is a blocker.
- [ ] Expected values in fixtures match the brief's tables (re-derive one by hand), not engine output.

## B. Model validity (try to break it)

- [ ] Queue admission is by arrival time at that analyzer, then `seq`. Mutation: order by `sampled_at`; F1 must fail.
- [ ] Windows are checked over the whole run, half-open. Mutation: check only the start; F2 must fail.
- [ ] RNG key includes `attempt`. Mutation: drop it; F3 and the rerun-independence invariant must fail.
- [ ] Time is integer seconds everywhere; `git grep -nE "Date\.now|new Date|Math\.random" -- engine/src` is empty.
- [ ] M/M/c test uses the fixed seeds 1..30 and the targets from the brief; seeds and tolerances unchanged since written.
- [ ] Stability effects respect the range their source covers; outside it `extrapolated` is set. Check one effect against the ledger entry.
- [ ] Utilisation states whether setup counts. Holding time is `run_started_at - sampled_at`, not queue wait alone.
- [ ] Volume-budget skips remain in every metric denominator.
- [ ] Experiment 2: feedback off reproduces experiment 1 truth; arms share draws; zero bias gives zero paired difference; at least 20 seeds.
- [ ] The engine is generic: `git grep -nE "['\"](bench_manual|micro_mini_parallel|pilot|allinone_atline|split_cellcounter_metabolite|hplc|trainee|experienced)['\"]" -- engine/src` is empty; same for preset ids `a_manual|b_lims_lite|c_context`.

## C. Truth/recorded leakage

- [ ] Recorders and L5 import nothing from truth modules (lint rule exists and was shown failing on a planted import).
- [ ] The answer key is imported only by the injector (writer) and `engine/src/evaluate/` (reader): `git grep -ln "answer_key" -- engine/src`.
- [ ] Hidden-field perturbation test exists. Mutation: let a recorder read a hidden field; the test must fail.
- [ ] `observable_events` schema has `additionalProperties: false` and none of the fields marked `x-visibility: hidden`.
- [ ] Recorded outputs and the FAIR export contain no truth-only field (names like `true_`, `hidden_`, tube-swap markers).

## D. Determinism

- [ ] Run the same scenario and seed twice, in two processes: identical `log_hash`. A different seed differs.
- [ ] No reliance on object key order or `Map` iteration order of unsorted data in emitted logs; canonical JSONL is sorted.
- [ ] Seeds are neutral (not date-shaped); test exists.
- [ ] Parallel or repeated runs share no mutable module state.

## E. Metric gaming

- [ ] Each metric states its denominator; all analysis requests including missing, rejected and skipped. Recall is over injected errors, not over flagged samples; false-alarm rate is over clean requests.
- [ ] No combined score anywhere (`git grep -niE "overall|composite|total score"` in evaluator, UI strings, docs).
- [ ] The answer key never feeds a recorder or a detector.
- [ ] No ordering is guaranteed by construction: `git grep -nE "architecture(Id)? *(===|==) *['\"][abc]"` and the preset ids return nothing in recorder or evaluator code. C keeps residual errors; ablations each move their listed metric.
- [ ] Seed lists are fixed in config, not chosen after seeing results; aggregates show seed count and spread; inconclusive or negative results are kept in the report.
- [ ] Common error opportunities are identical across architectures (test exists and passes).

## F. Source ids and verification levels

- [ ] Every number shown in public docs or UI has `S###` or `A###`; ids resolve in the ledgers (`check_docs --all` passes in strict mode).
- [ ] Public numbers cite only sources with `verification: main-reread`. Grade `A` values are labelled as assumptions.
- [ ] Every profile and scenario parameter has a `ref`; no domain constant is hard-coded (`git grep -nE "[^0-9A-Za-z_.][0-9]+\.[0-9]+" -- engine/src` and review each hit; counts and fixture-only numbers are fine).
- [ ] For new claims: dispatch `fact-checker` (Sonnet, xhigh) to compare claim and source text; the orchestrator judges the result and re-reads the source for anything that becomes public.

## G. Overclaiming

- [ ] `git grep -niE "\b(first|only|novel|validated|proves?|predicts?|industry standard|compliant|conforms|guarantees?)\b"` over README, docs, UI strings: each hit justified or removed.
- [ ] Experiment 2 text says "model-internal effect under assumptions"; no claim about any real lab.
- [ ] No compliance claims (Part 11, Annex 11, ASM, SiLA, OPC UA); Annex 11 current text and the draft revision are both mentioned where it appears.
- [ ] No simulation result numbers appear in README or the infographic before results exist; "synthetic data, design phase" notice present until then.
- [ ] Extrapolation warnings accompany any effect applied beyond its source range.

## H. Origin leakage

- [ ] `check_docs --all` passes. Before the author pushes: `uv run --frozen python scripts/check_docs.py --history` also passes.
- [ ] Read every new prose file once for fingerprints: hints about where the scenario came from, a hiring context, a task being "given", unusual precision in defaults, personal names, absolute paths (`git grep -nE "/Users/|/home/"`).
- [ ] The only mention of the private prior prototype is the generic line; no ported code, names or structure. Default is 24 reactors in two bays of 12, 2 analyzers; seeds neutral.
- [ ] `git log --format=%ae` and the repo-local `user.email` are the portfolio address.

## I. YAGNI

- [ ] File inventory (`git status --short`) matches the brief's allowed paths; anything else is a finding.
- [ ] `git diff -- package.json pyproject.toml` shows only dependencies the brief names.
- [ ] No extra feature flag (exactly eight), profile mechanism, scenario or UI code beyond the session's scope. PAT model absent unless requested.
- [ ] Ideas the executor did not build are listed under "Parked" in `docs/progress.md`.

## J. Boundaries and decisions

- [ ] `git diff --stat -- sql reference` is empty; `.claude/user_owned.txt` lists all five author paths; the guard pipe test was shown (exit 2).
- [ ] Every ADR is `Proposed`; each `## Decider's note` still holds the placeholder; `git log -p -- docs/adr` shows no AI edit to a note.
- [ ] No commit, push, remote, or publishing command appears in the executor's transcript or scripts.
- [ ] Browsers were headless and closed.

## K. Principles (canon in `PRINCIPLES.md`)

- [ ] AHA: list every new shared module (`utils`, `common`, `base`, helper files, generic wrappers) with its call sites. Fewer than three call sites, or three that change for different reasons, is a finding unless the brief names the module.
- [ ] SRP and file size: `git ls-files 'engine/src/*.ts' 'src/*.ts' | xargs wc -l | awk '$1 > 300 && $2 != "total"'` is empty, or each hit is a generated file or a recorded exception in `docs/progress.md`. No single giant model file; each module has one stated responsibility.
- [ ] Tidy First: no commit and no reported step mixes structure-only changes (rename, move, reformat) with behaviour changes. `git log --stat` and the executor's report show them apart.
- [ ] BDD: every scenario the brief lists has a Given-When-Then acceptance test named after its id (SC1-SC11). Give the mapping; a scenario without a test is a major.
- [ ] EDD: after your own check runs, `git status --short -- tests/golden` shows no change; hand fixtures, M/M/c targets and the evaluator's answer key are unchanged since written (see A and B).
- [ ] YOLO did not skip a HITL gate: no `Accepted` flip or decider's note, no push or visibility change, no author-owned file written, no approval or hook bypass (`--no-verify`, `ALLOW_PUSH`, edits to `.claude/settings.json` or `scripts/hooks/`, disabled permission prompts). Any hit is a blocker.

## Output format

```
VERDICT: PASS | REWORK
Evidence: <commands run, one line each with result>
Findings:
R1 | blocker | engine/src/analysis/dispatch.ts:88 | <failing scenario as an input> | <evidence required>
...
Parked (minor): ...
```
Keep it under 300 words unless there are blockers. Do not soften a failed check into a pass; do not add checks mid-review.

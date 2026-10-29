# 90 — Orchestrator review rubric

Used by the orchestrator after every executor delivery (S1, S2, and later sessions). The orchestrator verifies on disk, judges, orders rework, and commits after PASS. It does not bulk-write deliverables.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination: every stage is reviewed against the full canon (SDD, TDD, BDD, EDD, YAGNI, AHA, SRP, Tidy First, HITL) in sections A-K below.
The orchestrator reviews and orders rework; it does not build. Rails: PRINCIPLES.md section 6. A rework order never waives a HITL gate.

## Procedure

1. **Evidence first.** An executor's report is a claim, not evidence. Run the commands yourself: `git status --short -uall` (untracked files included), `git ls-files -co --exclude-standard` for inventories, `ls -l` and `wc -l` on every claimed file, `uv run pytest -q`, `uv run --frozen python scripts/check_docs.py --all`, `bash scripts/check_all.sh --manual`, and from S1 on `npm run check`. Every search in this rubric uses `git grep --untracked`, because a plain `git grep` or `git diff` misses files the executor created and has not staged. Compare claimed test counts with the real output.
2. **One pass of sections A-K.** Record each finding as `ID | severity | file:line or section | failing scenario | required evidence for the fix`. Severity: **blocker** (invalidates a result, leaks, or breaks a rail), **major** (a check fails or a required test is absent), **minor** (style, naming, nicety; goes to Parked, never blocks).
3. **Adversary pass (end of S1 and end of S2 only).** When A-K leave no blocker or major, call `sim-adversary` once (Opus, `high`) with the engine or deliverable paths and the contract, not with your verdict. Its findings enter the same finding list.
4. **Verdict.** PASS when there are no blockers and no majors. Otherwise REWORK with the ordered list.
5. **Rework.** One round. The executor fixes exactly the listed items and returns evidence for each. Re-check only those items. A second failure goes to the author. No new review rounds after PASS: report, then commit by kind (structure-only first, then behaviour; `git add <paths>` each).
6. Mutation spot checks run in a scratch copy of the repo (`rsync -a --exclude node_modules --exclude .venv ./ <scratchpad>/copy/`), never in place.

## A. Test evidence on disk

- [ ] Every behaviour in the brief maps to a named test file that exists and ran in your run. List the mapping.
- [ ] Red evidence was reported for hand fixtures and invariants; spot-check one by the mutations in section B.
- [ ] No disabled tests: `git grep --untracked -nE "\.(only|skip)\(|xit\(|xdescribe|pytest\.mark\.skip\b" -- engine tests` is empty (the `user_track` skips for absent author files are the only exception).
- [ ] Goldens untouched since creation: the checksum test passes and `docs/progress.md` records the one creation command; any later golden diff without a recorded author approval is a blocker.
- [ ] Expected values in fixtures match the brief's tables (re-derive one by hand), not engine output.

## B. Model validity (try to break it)

- [ ] Queue admission is by arrival time at that analyzer, then `seq`. Mutation: order by `sampled_at`; F1 must fail.
- [ ] Windows are checked over the whole run, half-open. Mutation: check only the start; F2 rows 2 and 3 must fail.
- [ ] RNG key includes `attempt`. Mutation: drop it; F3 and the rerun-independence invariant must fail.
- [ ] The RNG is the one canonical tuple of `00 §2` item 2, hashed with splitmix64 over `BigInt`, synchronous; the install check of the seed width is in `docs/progress.md`; the collision test enumerates the keys a run really uses.
- [ ] Time is integer seconds everywhere; `git grep --untracked -nE "Date\.now|new Date|Math\.random" -- engine/src` is empty.
- [ ] M/M/c test uses the fixed seeds 1..30, the 99% interval and the targets from the brief; seeds and tolerances unchanged since written. A failed M/M/c run must have been escalated, never "fixed until green".
- [ ] Stability effects respect the range their source covers; outside it `extrapolated` is set. Check one effect against the ledger entry.
- [ ] `hold_time` and `turnaround` follow `data_model.md` §5 (hold time is not queue wait alone). Utilisation is reported per staffed window and per 24 h, and says whether setup counts.
- [ ] Volume-budget skips remain in every metric denominator.
- [ ] Experiment 2: feedback off reproduces experiment 1 truth; arms share draws; zero bias gives exactly zero paired difference; at least 20 seeds.
- [ ] The engine is generic: `git grep --untracked -nE "['\"](bench_manual|micro_mini_parallel|pilot|allinone_atline|split_cellcounter_metabolite|hplc|trainee|experienced)['\"]" -- engine/src` is empty; same for preset ids `a_manual|b_lims_lite|c_context`.

## C. Truth/recorded leakage

- [ ] Lint zones exist and each was shown failing on a planted import: truth modules importable only from `engine/src/observe/`, `experiments/assembly/`, `experiments/oracle/` and `evaluate/`; nothing in `record/`, `ingest/`, `inject/`, `export/` or `experiments/arms/` imports them. The Node-only import ban applies to `engine/src/**` only.
- [ ] The answer key is importable only inside `engine/src/evaluate/`: `git grep --untracked -nE "from ['\"].*answer_key" -- engine/src` hits only files under `engine/src/evaluate/`.
- [ ] `git diff HEAD -- eslint.config.js` (read the file if it is untracked) shows only added zones and no loosened rule.
- [ ] Hidden-field perturbation test exists. Mutation: let a recorder read a hidden field; the test must fail.
- [ ] `observable_events` schema has `additionalProperties: false` and none of the fields marked `x-visibility: hidden`.
- [ ] Recorded outputs and the FAIR export contain no truth-only field (names like `true_`, `hidden_`, tube-swap markers); the dictionary test for hidden visibility exists.

## D. Determinism

- [ ] Run the same scenario and seed twice, in two processes: identical `log_hash`. A different seed differs.
- [ ] No reliance on object key order or `Map` iteration order of unsorted data in emitted logs; canonical JSONL is sorted.
- [ ] Seeds are neutral (not date-shaped); test exists.
- [ ] Parallel or repeated runs share no mutable module state.

## E. Metric gaming

- [ ] Each metric states its denominator; all analysis requests including missing, rejected and skipped. Recall is over injected errors, not over flagged samples; false-alarm rate is over clean requests.
- [ ] No combined score anywhere (`git grep --untracked -niE "overall|composite|total score"` in evaluator, UI strings, docs).
- [ ] The answer key never feeds a recorder or a detector.
- [ ] No ordering is guaranteed by construction: `git grep --untracked -nE "architecture(Id)? *(===|==) *['\"][abc]"` and the preset ids return nothing in recorder or evaluator code.
- [ ] Gates are structural: each error class has a forced-error fixture with hand-typed prevent/detect/invisible cells per architecture and per ablation. No test asserts a stochastic ordering or sign across architectures (read the evaluator and experiment tests for `toBeGreaterThan`/`toBeLessThan` on aggregated metrics); stochastic results are reported with at least 20 seeds and intervals, and inconclusive ones stay in the report.
- [ ] Seed lists are fixed in config before the runs; aggregates show seed count and spread.
- [ ] Common error opportunities are identical across architectures (test exists and passes); each flag changes at least one forced-error cell when ablated, or is reported as dead code.

## F. Source ids and verification levels

- [ ] Every number shown in public docs or UI has `S###` or `A###`; ids resolve in the ledgers (`check_docs --all` passes in strict mode), and an `A###` is followed to its sources.
- [ ] Public numbers cite only sources with `verification: main-reread`. Grade `A` values are labelled as assumptions.
- [ ] Every profile and scenario parameter has a `ref`; no domain constant is hard-coded (`git grep --untracked -nE "[^0-9A-Za-z_.][0-9]+\.[0-9]+" -- engine/src` and review each hit; counts and fixture-only numbers are fine). A value the engine needed without an id must appear as an escalation, not as a made-up constant.
- [ ] For new claims: dispatch `fact-checker` (Sonnet, xhigh) to compare claim and source text; the orchestrator judges the result and re-reads the source for anything that becomes public.

## G. Overclaiming

- [ ] `git grep --untracked -niE "\b(first|only|novel|validated|proves?|predicts?|industry standard|compliant|conforms|guarantees?)\b"` over README, docs, UI strings: each hit justified or removed.
- [ ] Experiment 2 text says "model-internal effect under assumptions"; no claim about any real lab.
- [ ] No compliance claims (Part 11, Annex 11, ASM, SiLA, OPC UA); Annex 11 current text and the draft revision are both mentioned where it appears.
- [ ] No simulation result numbers appear in README or the infographic before results exist; "synthetic data, design phase" notice present until then.
- [ ] Extrapolation warnings accompany any effect applied beyond its source range.

## H. Public-source hygiene

- [ ] `check_docs --all` passes. Before the author pushes: `uv run --frozen python scripts/check_docs.py --history` also passes.
- [ ] No personal names, no absolute paths (`git grep --untracked -nE "/Users/|/home/"`), no machine-specific details in tracked files.
- [ ] Every domain statement rests on a public source with a ledger id (ADR-0001); no ported code or structure from any earlier implementation.
- [ ] `git log --format=%ae` and the repo-local `user.email` are the portfolio address.

## I. YAGNI

- [ ] File inventory (`git status --short -uall`) matches the brief's allowed paths; anything else is a finding.
- [ ] `git diff HEAD -- package.json pyproject.toml` shows only dependencies the brief names (read the file when it is untracked).
- [ ] No extra feature flag (exactly eight), profile mechanism, scenario or UI code beyond the session's scope. PAT model absent unless requested.
- [ ] Ideas the executor did not build are listed under "Parked" in `docs/progress.md`.

## J. Boundaries and decisions

- [ ] `git diff HEAD --stat -- sql reference` is empty and `git ls-files -o --exclude-standard -- sql reference` is empty; `.claude/user_owned.txt` lists all five author paths; the guard pipe test was shown (exit 2).
- [ ] ADRs: this delivery's new or modified ADR files (`git ls-files -m -o --exclude-standard -- docs/adr`) keep `- **Status:** Proposed` and the placeholder under `## Decider's note`. History: no commit carrying the AI trailer changed an ADR's status line or decider's note. Run
  ```bash
  note() { git show "$1:$2" 2>/dev/null | sed -n "/^## Decider's note/,\$p" | grep -v '^$'; }
  tmpl="$(note HEAD docs/adr/0000-template.md)"
  stat() { git show "$1:$2" 2>/dev/null | grep -m1 '^- \*\*Status:\*\*'; }
  for h in $(git log --format=%H --grep='Co-Authored-By: Claude' -- docs/adr); do
    for f in $(git diff-tree --no-commit-id --name-only -r "$h" -- 'docs/adr/[0-9][0-9][0-9][0-9]-*.md'); do
      b="$(note "$h^" "$f")"; [ -n "$b" ] || b="$tmpl"; [ "$(note "$h" "$f")" = "$b" ] || echo "AI commit $h changed the note in $f"
      b="$(stat "$h^" "$f")"; [ -n "$b" ] || b='- **Status:** Proposed'; [ "$(stat "$h" "$f")" = "$b" ] || echo "AI commit $h changed the status in $f"
    done
  done
  ```
  Any output is a blocker. An `Accepted` ADR written by the author's own commit is not a finding.
- [ ] The executor made no commit: `git rev-parse HEAD` equals the base commit recorded when the brief was sent. No push, remote or publishing command appears in the executor's transcript or scripts.
- [ ] Browsers were headless and closed.

## K. Principles (canon in `PRINCIPLES.md`)

- [ ] AHA: list every new shared module (`utils`, `common`, `base`, helper files, generic wrappers) with its call sites. Fewer than three call sites, or three that change for different reasons, is a finding unless the brief names the module.
- [ ] SRP and file size: `git ls-files -co --exclude-standard -- 'engine/src/*.ts' 'src/*.ts' | xargs wc -l | awk '$1 > 300 && $2 != "total"'` is empty, or each hit is a generated file or a recorded exception in `docs/progress.md`. No single giant model file; each module has one stated responsibility.
- [ ] Tidy First: the executor's report lists structure-only paths and behaviour paths apart, and the lists are consistent with the diff. You commit them as separate `git add <paths>` commits.
- [ ] BDD: every scenario the brief lists has a Vitest `describe("SC<n> ...")` with `Given`/`When`/`Then` `it` titles (`git grep --untracked -nE 'describe\("SC[0-9]+' -- engine tests`). Give the mapping; a scenario without a test is a major. No Gherkin files or runner.
- [ ] EDD: after your own check runs, `git status --short -uall -- tests/golden` shows no change; hand fixtures, M/M/c targets and the evaluator's answer key are unchanged since written (see A and B).
- [ ] Budgets of `00 §4` are met where measurable in this session (I12 in S1; gzip sizes in S3), measured not estimated.
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

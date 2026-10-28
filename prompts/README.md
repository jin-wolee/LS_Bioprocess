# Prompts — map and operating manual

These prompts are the build contract for AI sessions in this repo. They are public. They say what to build, how it is judged and what is off limits. Domain numbers live in `docs/research/assumptions.yaml` and `docs/research/sources.yaml`, never in a prompt.

## Working principles

Principles: see `prompts/PRINCIPLES.md` (definitions, stage table, rails, brief header). Nothing is defined twice.
Stage combination for this file: PDD + DRY + KISS. These prompts are versioned assets: change them like code, log it in `docs/progress.md`. Every brief starts with the header from PRINCIPLES.md section 7.

## Map

| File | Used when | By | Produces |
|---|---|---|---|
| `PRINCIPLES.md` | read with `00` in every session; its header opens every brief | orchestrator, every executor, reviewer | nothing (definitions, stage table, rails, brief header) |
| `00_master_build.md` | loaded first in every session | orchestrator, every executor | nothing (invariants, layers, flags, experiments, metrics, gates) |
| `10_S1_engine.md` | session S1 | executor | contracts, schemas, hand fixtures, TS engine L1-L3 with profiles, scaffold, acceptance tests for the author's code |
| `20_S2_capture_metrics.md` | session S2, after the S1 gate | executor | flags and presets, error injector, evaluator, experiments 1 and 2, CSV parser, FAIR export, SQL acceptance tests |
| `60_user_track.md` | whenever the author works, and for any AI reviewing it | author, reviewer | the author's DDL, three SQL queries, SimPy loop; reviews in `docs/user_track/reviews/` |
| `90_review_rubric.md` | after every executor delivery | orchestrator | PASS or an ordered REWORK list |
| `91_external_review.md` | at a milestone, when asked | orchestrator | private raw reviews, public disposition table in `docs/reviews/` |

`30_*` (Lab UI), `40_*` (DSP genealogy, HPLC contention) and `50_*` (release) are written at the start of their sessions, not before; a prompt written early goes stale. Gaps in numbering are intentional.

If a prompt and a design doc disagree, follow the prompt and log the discrepancy under "Open questions" in `docs/progress.md`. If a prompt and an Accepted ADR disagree, the ADR wins and the orchestrator fixes the prompt.

## Roles and model routing

| Role | Model and effort | Does | Never does |
|---|---|---|---|
| Orchestrator | strongest available (Opus-class or above), judges itself | reads `docs/progress.md`, writes the brief, spawns executors, verifies on disk, applies `90_review_rubric.md`, orders rework | bulk-write deliverables, accept a self-report as evidence |
| Executor | Sonnet, effort `xhigh` | builds exactly the brief; TDD; reports with evidence | commit, push, edit author-owned files, add scope |
| `fact-checker` | Sonnet, `xhigh` | compares a claim with the source text, fan-out per claim | decide; the orchestrator judges |
| `sim-adversary` | Opus, `high` | tries to break model validity and the metrics | write code |
| External reviewers | codex and agy via `91_external_review.md` | independent findings on identical input | edit anything |
| Author (human) | - | owns `sql/`, `reference/`, ADR decider notes and `Accepted`, commits of those, `git push`, visibility change | - |

Set `model` and `effort` explicitly on every agent call; an unset model inherits the orchestrator's. Every brief starts with the header from `PRINCIPLES.md` section 7.

## Handing a prompt to an executor

1. Read the last entry of `docs/progress.md` and the `Proposed` ADRs. Confirm the previous gate passed.
2. Build the brief from this template and send it to a fresh executor (an agent call with `model: sonnet`, `effort: xhigh`, or a new session started at the repo root):

```
You are the executor for <session>. Work in the repo root.
Read first: CLAUDE.md, docs/progress.md (last entry), prompts/PRINCIPLES.md,
prompts/00_master_build.md, prompts/<NN>_<name>.md, and .guardrails.local.txt (never write its tokens).
<header: Stage, Principles, HITL gates touched, Done — the four lines from prompts/PRINCIPLES.md section 7>
Scope: <paths you may create or edit>. Everything else is out of scope.
Report (at most 300 words): files with line counts; commands run with output tails;
deviations from the brief; Parked ideas; Blocked items.
Tool budget: about <N> calls.
```

3. Parallel executors only on disjoint path sets declared in their briefs; two executors never edit `package.json`, `pyproject.toml` or `scripts/check_all.sh` at the same time.
4. When the report arrives, verify on disk (`90_review_rubric.md`, Procedure). One rework round at most. After PASS, report to the author; no extra verification rounds.
5. Each session ends with a `docs/progress.md` entry written by the executor: date, what changed, evidence, Parked, Open questions. The orchestrator checks that it exists.

## Report format (executors)

```
Result: <one sentence: gate passed or not>
Files: <path (lines)>, ...
Evidence: <command -> last lines>, ...
Deviations: <none or list with reason>
Parked: <ideas not built>
Blocked: <none or list>
```

## Who commits and publishes

Executors leave changes uncommitted. The orchestrator or the author commits locally. Commits that carry an AI trailer are AI-assisted; ADR `Accepted` flips and decider notes are the author's own commits without it. Push, remote creation, visibility change and Pages are the author's, run by the author with `!`; the hooks and git hooks refuse everything else.

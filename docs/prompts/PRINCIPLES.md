# Development principles (canon)

The one place where the working principles are defined. Every brief and rubric points here and names its stage combination; none of them restates a definition. Fixed by the author on 2026-10-29. Change this file like code (see PDD): small diff, reviewed, logged in `docs/progress.md`.

## 1. Autonomy

- **YOLO** — decide inside the brief without asking.
  In this repo: names, structure and wording are the executor's call. It never disables approvals and never bypasses a HITL gate or a hook.
- **FAFO** — fast, ambitious, fun, keep the options open.
  In this repo: only for throwaway UI and interaction exploration in S3. Never for engine, schema, ledger or data code that ships.
- **HITL** — a human decides at the gate.
  In this repo: the gates are (1) an ADR `Accepted` flip and its decider's note, (2) any publishing, push or visibility change, (3) the author-owned paths (`.claude/user_owned.txt`; empty since ADR-0022, which has AI write the SQL and SimPy track clean-room from the specification), (4) release.

## 2. The -DD methods

- **SDD** (spec) — the spec is the single source of truth; spec changes first, then code.
  In this repo, highest first: ADRs, `docs/design/*`, `data/schemas/*.schema.json`. Prompts point to them and never restate them; on a conflict the design wins.
- **TDD** (test) — failing test first, see it fail for the stated reason, then the smallest code that passes. The test is the contract.
  In this repo: expected values come from the brief or hand arithmetic, never from the code under test. Report red, then green.
- **BDD** (behaviour) — behaviour is written as Given-When-Then acceptance tests.
  In this repo: scenarios SC1-SC14 each get a Given-When-Then test named after the scenario id. Format: a Vitest `describe("SC2 shift-start burst", ...)` whose `it` blocks are titled `Given ...`, `When ...`, `Then ...` (one behaviour per `it`, shared setup in `beforeAll`). No Gherkin files and no Gherkin runner.
- **PDD** (prompt) — prompts are versioned assets.
  In this repo: `docs/prompts/` and `CLAUDE.md` are changed like code and logged in `docs/progress.md`.
- **EDD** (eval) — answers that exist before the code are the evals.
  In this repo: hand-calculated fixtures, M/M/c analytic values, golden traces and the metric evaluator's answer key. A check never regenerates a golden; a golden change needs the author's approval recorded in `docs/progress.md`.

## 3. Anti-bloat

- **YAGNI** — build only what the brief lists.
  In this repo: no extra flags, options, abstractions, files, dependencies or UI; a good unlisted idea goes under "Parked" in `docs/progress.md`.
- **KISS** — the simplest thing that satisfies the test.
  In this repo: plain functions and data over frameworks and class hierarchies.
- **DRY** — one definition per fact.
  In this repo: rules live in one prompt, one schema or one ledger entry; everything else references it.
- **AHA** — avoid hasty abstractions.
  In this repo: duplicate twice, extract on the third use, and only when the three copies change for the same reason.
- **SOLID / SRP** — one responsibility per module, small files.
  In this repo: target 300 lines or fewer per source file; no single giant model file; split by responsibility, not by size alone.

## 4. Change management

- **Tidy First** — structure-only changes and behaviour changes never share a commit.
  In this repo: renames, moves and reformatting land first and alone, tests green before and after; then the behaviour commit. The orchestrator makes the commits, one `git add <paths>` per kind; an executor reports its structure-only paths and behaviour paths as two lists.
- **Small Batches** — every step ends in something testable and committable.
  In this repo: a brief covers one increment whose done-criteria command passes by itself.

## 5. Stage table

| Stage | Combination |
|---|---|
| S0 design | SDD + PDD + HITL |
| S1a, S1b, S2 engine, capture, metrics | SDD + TDD + EDD + BDD + YAGNI + HITL |
| S3 UI exploration | YOLO + FAFO + KISS; then lock what stays with TDD + E2E |
| S3 break-out events (engine) | SDD + TDD + EDD + BDD + YAGNI + HITL (ADR-0013) |
| S4-S5 and maintenance | Tidy First + DRY + SRP + TDD |
| Always | KISS, AHA, SRP, Small Batches |

## 6. Rails (the boundary of YOLO, never relaxed)

1. Executors never run `git commit`, `git push`, remote commands, `gh`, `npm publish`, Pages, shared links or any other publishing; leave changes uncommitted. The orchestrator commits locally; push, remotes and visibility belong to the author.
2. Touch only paths the brief allows. Author-owned files (`.claude/user_owned.txt`) are review-only. ADRs stay `Proposed` with an empty decider's note. Do not read or write `docs/private/` unless the brief says so.
3. Read `.guardrails.local.txt` once at the start; never write any token it lists, in any file, report or commit message.
4. Synthetic data only. Public sources only (ADR-0001); do not port code from any earlier implementation.
5. Headless only: no visible browser window (`playwright-headless`; never `mcp__playwright__*`).
6. Verify before you report: run the commands, paste the last lines, list files with line counts.

## 7. Brief header

Every brief to an executor starts with these four lines, filled in:

```
Stage: <S0 | S1a | S1b | S2 | S3 | S4 | S5 | maintenance> — <session name>
Principles: <combination from the stage table>, plus always KISS, AHA, SRP, Small Batches. Rails: docs/prompts/PRINCIPLES.md section 6.
HITL gates touched: <none | list from section 1>
Done: <command that must pass, e.g. uv run pytest -q && uv run --frozen python scripts/check_docs.py --all && bash scripts/check_all.sh --manual>
```

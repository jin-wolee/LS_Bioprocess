# Sample Lineage Lab

A portfolio simulator. N bioreactors share two at-line analyzers, and every sample that reaches an
analyzer is tracked by lineage. The lab runs the same synthetic run through several data
architectures and compares what each one can reconstruct afterwards. The point is a clear,
honest comparison, not a prediction about any real plant.

## Repo map (directories appear as the work lands)
- `engine/`, `src/`: TypeScript simulation engine and UI. Seeded PRNG only.
- `reference/`, `sql/`: the author's own implementation track (see `.claude/user_owned.txt`).
- `tests/`: pytest for the hooks and `check_docs`; engine tests live beside the engine.
- `scripts/`: `check_docs.py`, `check_all.sh`, `hooks/` (Claude Code guards), `git-hooks/` (pre-commit, pre-push), QA scripts.
- `docs/`: `adr/`, `research/`, `design/`, `progress.md`.
- `prompts/`: briefs for executors (`00_master_build.md` first).
- `docs/private/`: gitignored raw material. Never copy text, numbers or file names out of it into tracked files.
- `.guardrails.local.txt`: gitignored banned-token list. Never print it into a tracked file.
- `.claude/`: `settings.json` (hooks), `skills/`, `agents/`, `user_owned.txt`.

## Invariants
1. Truth world and recorded world stay separate. Recorders see observable events only, never the hidden truth state.
2. Determinism. Seeded integer PRNG only, no `Math.random`. Randomness is keyed by one canonical tuple `(run_seed, physical_sample_id, analyte, attempt, purpose)`.
3. Every number in public docs or UI carries an `S###` or `A###` id from the `docs/research/` ledgers. Public numbers use only `main-reread` sources, and an `A###` is followed to its `S###` sources.
4. ADRs: Claude writes `Proposed` only. Never fill "Decider's note", never flip a status to `Accepted`.
5. Files listed in `.claude/user_owned.txt` are the author's implementation track. Review them, never write them (reviews go to `docs/user_track/reviews/`).
6. No publishing. Push, remote changes and GitHub writes belong to the author; the hooks block them. Give the author the command to run with `!`.
7. Headless browsers only (`mcp__playwright-headless__*` or the QA scripts), and always close them.
8. Python dependencies through `uv` only (never pip, conda or base). Node through `npm` with exact versions.
9. Synthetic data only. Never claim real plant data, and never state simulation results before they exist.
10. Work split: the orchestrator verifies, orders rework and commits; executors (Sonnet, xhigh) build and never commit. Every brief starts with the header from `prompts/PRINCIPLES.md` (stage + principle combination + HITL gates).
11. Source of truth, highest first: ADRs, `docs/design/*`, `schemas/*`, `prompts/*`. Prompts carry process and pointers; if a prompt and a design file disagree, the design wins.
12. "Done" means `uv run pytest -q`, `uv run --frozen python scripts/check_docs.py --all` and `bash scripts/check_all.sh --manual` all pass.

## Commands
```bash
uv run pytest -q                                      # hook, guard and check_docs tests
uv run --frozen python scripts/check_docs.py --all    # banned tokens, ADR format, ledgers, id references
uv run python scripts/qa_infographic.py               # headless page QA, output in qa_out/ (when it exists)
npm run check                                         # Node-side checks (when package.json exists)
bash scripts/check_all.sh --manual                    # the Stop-hook gate on demand (docs check, pytest, Node checks, Math.random grep)
git ls-files -co --exclude-standard                   # inventory incl. untracked; search with `git grep --untracked`
git config core.hooksPath scripts/git-hooks           # once per clone
ALLOW_PUSH=1 git push ...                             # author only
```

## Hooks (`.claude/settings.json`)
- SessionStart prints the last progress entry and every `Proposed` ADR.
- PreToolUse: `guard_bash.py` blocks publishing commands; `guard_tools.py` blocks GitHub write tools, the headed browser and user-owned paths.
- PostToolUse runs `check_docs.py --hook` on the edited file. Stop runs `check_all.sh` once per turn in which the working tree changed; `--manual` runs the same gate on demand.
- Git: `pre-commit` checks staged content, `pre-push` needs `ALLOW_PUSH=1` and scans the whole history.

## Docs map
- `docs/adr/`: decisions, `0000-template.md` is the format. Skill: `adr-new`.
- `docs/research/`: `sources.yaml` (`S###`), `assumptions.yaml` (`A###`). Skills: `source-add`, `assumption-check`.
- `docs/design/`: `simulation_spec.md`, `data_model.md` (canonical names), `data_dictionary.yaml` (created in S2). `docs/progress.md`: dated log, newest entry last.
- `prompts/`: briefs for executors; `prompts/README.md` is the map and holds the public tool verdicts.
- Skill `page-qa` runs the headless page check. Agents: `fact-checker` (numbers vs sources), `sim-adversary` (tries to break the engine).

## Session start
Read the last entry of `docs/progress.md` and the `Proposed` ADRs, then continue from there.

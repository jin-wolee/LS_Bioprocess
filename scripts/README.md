# scripts/

What is where. Run the Python ones with `uv run python scripts/<name>` from the repository root.

| Path | What it does |
|---|---|
| `check_docs.py` | the document checks: banned tokens, ADR format, ledgers, id references (`--all`, `--staged`, `--history`, `--hook`) |
| `docs_rules.py` | the per-file rules `check_docs.py` applies (banned tokens, ADR format) |
| `ledger_rules.py` | the ledger rules `check_docs.py` and `lab_ledger.py` share (schema, grades, `S###` and `A###` references, the public-number gate) |
| `lab_ledger.py` | writes the ledger view of the lab page into `src/generated/`; `--check` fails when a committed file is stale (`npm run build:lab` runs it) |
| `assemble_site.py` | builds the public lab and assembles `dist/site/` (the explainer at the root, the lab under `lab/`) |
| `adr_accept.py` | applies the author's recorded ADR decisions (status line, decider's note, index row); the author runs it |
| `check_all.sh` | the full gate: docs check, pytest, Node checks, the `Math.random` rule; `--manual`, `--lab`, `--plant` run it on demand |
| `hooks/` | the Claude Code hooks named in `.claude/settings.json`: `guard_bash.py`, `guard_tools.py`, `session_brief.sh` |
| `git-hooks/` | the git hooks (`git config core.hooksPath scripts/git-hooks`): `pre-commit`, `pre-push` |
| `qa/` | the headless page QA, one family per page; each `qa_*.py` is a module of its page's script, and the tests import them from here |
| `qa/qa_infographic.py`, `qa/qa_checks.py` | the explainer page: the script and its check functions |
| `qa/qa_lab.py`, `qa/qa_lab_*.py` | the lab page: the script, its checks, helpers and browser plumbing |
| `qa/qa_plant.py`, `qa/qa_plant_*.py` | the plant: the script and its checks, helpers and browser plumbing, one file per concern |
| `qa/qa_site.py`, `qa/qa_site_plant.py` | the assembled `dist/site/`, the plant route included |
| `qa/qa_timing.py` | the timing mode (`judge` or `report`) the three browser QA scripts share |

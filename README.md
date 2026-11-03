# Sample Lineage Lab

In a synthetic plant, bench-scale bioreactors share a few at-line analyzers, and the same run is recorded under several data architectures so that each record can be compared on what it can still reconstruct afterwards: which reactor a sample came from, which moment it describes, which instrument state measured it. All data are synthetic, and nothing here predicts a real plant (ADR-0001).

## The two pages

- [Explainer](https://jin-wolee.github.io/LS_Bioprocess/): a scroll page on the problem, with a slider that moves the measurement time and a matrix of which flag covers which error.
- [Lab](https://jin-wolee.github.io/LS_Bioprocess/lab/): runs the synthetic plant in the browser and shows what the record of each architecture can reconstruct. It also lets you walk through that plant (next section), follows one sample through each record, and sets a challenge: find the planted error in a record.

The site goes live when the author publishes it. Until then these addresses do not answer, and the pages can be built and served locally (see "Run it"). Both pages open in English and have a Korean toggle (ADR-0006); the language chosen on one page is kept when you follow the link to the other.

## The plant in the lab

The Home screen of the lab opens the plant, a three-dimensional scene of the same synthetic run (a text version stands in where the browser has no WebGL). You walk through it by click or keyboard. The clock plays, pauses, changes speed and moves to any instant of the run. Each data architecture has a record hall whose shelves hold a card for each sample that record keeps, and a lens picks the hall that the record panel reads. The truth overlay is off until you ask: it shows what the simulation knows and no record can hold, and labels it the simulation's own view. Operator actions (adding a feed, moving a draw, taking an analyzer down, switching a flag, changing the capture path, and three more) rerun the plant, and the ones that name a reactor or an analyzer carry over to Results. A card, a sample, a reactor or an analyzer links to the Lineage, Results and Notes screens, and each link brings you back to the same instant. A short guided scene follows one sample that was drawn before a feed and measured after it.

The plant of a Break-out case (the lot rack, the equipment stations, the confirming tests) is in the local build only. The public build refuses the Break-out screen and the cases with it (see "Numbers").

## What is compared

The standing example is a feed in the gap. A sample is drawn at 08:40, a bolus feed happens at 09:00 and the analyzer measures the sample at 09:25 (example times, A102). A record that keeps only the time of measurement joins the result to the process state after the feed, although the sample was drawn before it. A record that also keeps the time of the draw joins it correctly.

A data architecture is a set of ten flags, each one a property of the record. Presets switch groups of them on (ADR-0005, ADR-0017, ADR-0020).

| Flag | When it is on, the record keeps |
|---|---|
| `system_issued_id` | the sample key, issued by the system when the label is made |
| `two_clocks` | the time of the draw and the time of the measurement, separately |
| `available_at` | for each row, when it became knowable |
| `instrument_state_snapshot` | the link from a run to the instrument, its calibration and its reagent lot |
| `append_only_versions` | corrections, reruns and reprocessing as new versions |
| `write_time_keys` | the sample, unit and batch keys, fixed when written and never re-keyed |
| `ingest_idempotency` | a duplicated or replayed file as a no-op |
| `audit_trail` | what changed and when (the old and the new value of a rerun, its version and its time), and the operator and qualification of the draw; not who changed a result or why |
| `material_lot_links` | the lot used in an inoculation or addition, as a key |
| `equipment_links` | the equipment item used by a batch, as a key |

The last two matter only when a contamination event is scripted: they decide whether an investigation can reach the other batches that shared a lot or an item.

- A, manual or Excel: no flag on.
- B, LIMS-lite: `system_issued_id`, `ingest_idempotency`, `audit_trail` and `equipment_links`. It is modelled on what simple laboratory systems already do.
- C, context-preserving: all ten. What the flags cannot remove is still reported, for example the results that the hold-time rule rejects (see "How to read the comparison"). A correct barcode stuck on the wrong tube is not modelled: the label error here is an id typed or written by hand, which `system_issued_id` prevents.

C with one flag off, for each flag, shows which flag carries which effect. Two settings are independent of the flags: how a sample is labelled, and how a result becomes a record, by typing from the instrument screen or by parsing a synthetic device file (ADR-0005, ADR-0014).

The gate is structural: each flag has a forced-error case whose expected outcome is written by hand before any run. Across seeds the lab shows a range per metric, with no composite score and no ranking column. It calls a run a comparison only when it has at least the minimum number of seeds (A103).

## How to read the comparison

A and B do not store the draw time or the link from a run to the instrument state that exact reconstruction asks for, so their exact reconstruction is zero by construction, whatever the seed. The comparison is a constructive example of what a record keeps, and so of which question it can answer afterwards. It is not a measure of the quality, the efficiency or the return of real spreadsheets or laboratory systems.

The spread across seeds is the variation of operations and measurement that the inputs allow. The constants of the cell line do not change with the seed, so the spread is not the uncertainty of the model. The minimum number of seeds (A103) is a threshold of the design, not a proof of statistical sufficiency.

The hold-time rule (`VR-010`; A046 and A213, both provisional, since their sources are not re-read in full) rejects a result whose sample waited too long between the draw and the run. Its limit is a proxy taken from blood-gas handling and applied, as an assumption, to every analyte. The lab shows how many requests the rule rejected and what exact reconstruction and availability would be if those were not counted as failures. That is the share of a model's result that one assumption makes, not the accuracy of a real laboratory.

In the Break-out screen a hold is a state of the record and stops no culture. Its containment figures are the effect of tracking and holding on the record, not of a control of the culture or of how a contamination spreads, and its confirming tests are judged by coverage, not by a sensitivity.

## Numbers

Every number on the pages carries the id of a ledger entry: `S###` in `docs/research/sources.yaml` for a source, `A###` in `docs/research/assumptions.yaml` for a simulator parameter. An assumption has a grade (sourced, proxy, derived or assumed) and a source has a verification level (snippet, agent-read or main-reread). Only main-reread sources back a figure on a public page. A figure that rests on a weaker source is shown with a dashed provisional chip, and `scripts/check_docs.py` fails a public file that cites one without that label. `docs/research/README.md` explains the grades.

The lab's Break-out screen, a contamination walk-back, and the Break-out cases in the plant are held back. Their inputs rest on sources that have not been re-read, so the public build refuses the screen and offers no case; a local build shows the screen marked not for publication and the cases in the plant. They stay out of the public build until those sources are re-read.

The pages ship no result. The lab computes its results in your browser on each visit, from the scenario and the seeds you choose.

## Repository map

```
engine/              the TypeScript simulation engine (seeded, no Math.random); its tests sit beside it
src/                 the lab page (Preact), its Web Worker, the English and Korean dictionaries
site/infographic/    the explainer: src/ -> build.py -> index.html
data/scenarios/      scenarios, profiles, architectures and experiments, as data with ledger references
data/schemas/        JSON schemas for the data the engine reads and writes
reference/sql/       the canonical DDL and three SQL queries, written by AI from the specification (ADR-0022)
reference/simpy/     the SimPy core loop, written by AI from the specification (ADR-0022)
docs/                adr/ decisions, design/ specifications, research/ ledgers, reviews/, progress.md
docs/prompts/        the briefs and principles that the AI sessions work from
scripts/             checks, site assembly, Claude Code hooks, git hooks; qa/ holds the headless page QA (scripts/README.md)
tests/               pytest for the scripts, the hooks, the docs check and the Pages workflow
.github/workflows/   the Pages workflow, started by hand; it checks and runs the browser QA before any deploy
.claude/             CLAUDE.md, hook settings, skills, agents, the list of author-owned paths (empty since ADR-0022)
```

The root also holds the project files: `package.json` with `package-lock.json`, `pyproject.toml` with `uv.lock`, `tsconfig.json`, `eslint.config.js`, `vite.config.ts` (the Vitest settings), `.nvmrc`, `.python-version` and `LICENSE`.

## Run it

```bash
npm ci                                          # Node as in .nvmrc
uv sync --frozen                                # Python through uv
git config core.hooksPath scripts/git-hooks     # once per clone

uv run pytest -q                                # scripts, hooks, docs check, site
uv run --frozen python scripts/check_docs.py --all   # banned tokens, ADR format, ledgers, id references
npm run check                                   # lint, typecheck, Vitest, then the I12 budget alone
bash scripts/check_all.sh --manual              # the full gate; add --lab and --plant for the end-to-end checks of the lab and the plant

uv run python site/infographic/build.py         # rebuild the explainer page
uv run python scripts/qa/qa_infographic.py   # headless check of the explainer, output in qa_out/
uv run python scripts/assemble_site.py          # build dist/site/: the explainer at the root, the lab under lab/
uv run python scripts/qa/qa_site.py          # headless check of dist/site/, the plant route included
uv run python -m http.server --directory dist/site 8000   # then open http://127.0.0.1:8000/
```

The lab needs a web server, not a file URL, because its Worker fetches a file.

The Pages workflow is started by the author by hand. It runs the checks above and the browser checks of the lab, the plant and the assembled site in headless Chromium before it can deploy, so a failed check blocks the deploy. A CI runner is not the machine the time budgets were measured on, so there the frame times, the action round trip and the engine run are printed with their conditions and not judged (`--timing report`).

## How the work is done

Decisions are written as ADRs in `docs/adr/`. The AI tools write them as Proposed; the decider's note and the change to Accepted are the author's own commits (ADR-0002).

Much of the engine, the lab and the documents were written with AI coding tools (Claude Code) working from written briefs in `docs/prompts/`. Scripts and tests check what they produce, and the author decides at set gates: accepting an ADR, anything published, the author's own track, and release (`docs/prompts/PRINCIPLES.md`, section 1). Pushing and publishing are the author's alone, and hooks stop the tools from doing either.

The database schema (`reference/sql/schema.sql`), three SQL queries (an as-of join of results to process context, a recursive lineage query and a bridging correction) and a SimPy core loop (`reference/simpy/sim_core.py`) were written by AI (Claude Code) under ADR-0022, clean-room from the specification: the writer read the design documents, the schemas, the fixtures and the acceptance tests, and did not read the engine's source. The author did not write them. ADR-0022 replaces ADR-0010's plan that the author writes these five files, for these five files only. Agreement with the TypeScript engine is measured by `tests/user_track/` (`uv run pytest -m user_track -q`), which runs the SimPy loop on the hand traces and the engine's golden traces and compares integer times exactly, and runs the schema and the queries against hand-typed fixtures; all of its tests pass. The files are a second implementation that does not copy the engine's code; they are not independent of the model family that wrote the specification.

## Licences

Code is under the MIT licence (`LICENSE`). Text, figures and data tables in `docs/`, `docs/prompts/` and the explainer are under CC BY 4.0 (`docs/LICENSE-docs.md`). Sources cited in the ledgers keep their own terms; the ledgers hold only short quotes and links (ADR-0008).

## 한국어 요약

합성 데이터로 만든 시뮬레이터입니다. 바이오리액터 여러 대가 분석기 몇 대를 공유하는 가상의 플랜트를 한 번 돌려, 같은 실행을 여러 데이터 아키텍처로 기록하고 각 기록이 나중에 무엇을 복원할 수 있는지 비교합니다. 실제 설비를 예측하지 않습니다.
비교는 기록이 무엇을 보존하는지를 보여 주는 구성적 예시이며, 실제 스프레드시트나 실험실 시스템의 품질을 재는 것이 아닙니다. 시드에 걸친 분포는 모형의 불확실성이 아닙니다.
해설 페이지와 랩 두 곳이 있고, 저자가 공개하면 위 주소에서 열립니다. 랩에서는 같은 합성 실행을 걸어 다니며 볼 수 있는 플랜트 장면도 열립니다(시계, 아키텍처별 기록 보관실, 요청하면 켜지는 시뮬레이션의 시점, 운영자 조작, 안내 장면). 모든 수치에는 근거 장부의 id(`S###`, `A###`)가 붙고, 오염 이벤트 역추적 화면과 플랜트 안의 이탈 사례는 근거 출처를 다시 읽을 때까지 공개 빌드에서 빠져 있습니다.
DDL, SQL 쿼리 세 개, SimPy 핵심 루프는 저자가 쓴 것이 아니라 AI(Claude Code)가 명세만 보고(엔진 소스는 읽지 않고) 작성했습니다(ADR-0022). TypeScript 엔진과의 일치는 `tests/user_track/`이 측정하며, 그 테스트는 모두 통과합니다.

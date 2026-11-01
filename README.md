# Sample Lineage Lab

In a synthetic plant, bench-scale bioreactors share a few at-line analyzers, and the same run is recorded under several data architectures so that each record can be compared on what it can still reconstruct afterwards: which reactor a sample came from, which moment it describes, which instrument state measured it. All data are synthetic, and nothing here predicts a real plant (ADR-0001).

## The two pages

- [Explainer](https://jin-wolee.github.io/Lineage-Simulator-Bioprocessing/): a scroll page on the problem, with a slider that moves the measurement time and a matrix of which flag covers which error.
- [Lab](https://jin-wolee.github.io/Lineage-Simulator-Bioprocessing/lab/): runs the synthetic plant in the browser and shows what the record of each architecture can reconstruct. It also follows one sample through each record, and sets a challenge: find the planted error in a record.

The site goes live when the author publishes it. Until then these addresses do not answer, and the pages can be built and served locally (see "Run it"). Both pages open in English and have a Korean toggle (ADR-0006); the language chosen on one page is kept when you follow the link to the other.

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
| `audit_trail` | who changed what, and when |
| `material_lot_links` | the lot used in an inoculation or addition, as a key |
| `equipment_links` | the equipment item used by a batch, as a key |

The last two matter only when a contamination event is scripted: they decide whether an investigation can reach the other batches that shared a lot or an item.

- A, manual or Excel: no flag on.
- B, LIMS-lite: `system_issued_id`, `ingest_idempotency`, `audit_trail` and `equipment_links`. It is modelled on what simple laboratory systems already do.
- C, context-preserving: all ten. Some errors remain even here, for example a correct barcode stuck on the wrong tube, and the comparison reports them.

C with one flag off, for each flag, shows which flag carries which effect. Two settings are independent of the flags: how a sample is labelled, and how a result becomes a record, by typing from the instrument screen or by parsing a synthetic device file (ADR-0005, ADR-0014).

The gate is structural: each flag has a forced-error case whose expected outcome is written by hand before any run. Across seeds the lab shows a range per metric, with no composite score and no ranking column. It calls a run a comparison only when it has at least the minimum number of seeds (A103).

## Numbers

Every number on the pages carries the id of a ledger entry: `S###` in `docs/research/sources.yaml` for a source, `A###` in `docs/research/assumptions.yaml` for a simulator parameter. An assumption has a grade (sourced, proxy, derived or assumed) and a source has a verification level (snippet, agent-read or main-reread). Only main-reread sources back a figure on a public page. A figure that rests on a weaker source is shown with a dashed provisional chip, and `scripts/check_docs.py` fails a public file that cites one without that label. `docs/research/README.md` explains the grades.

The lab's Break-out screen, a contamination walk-back, is held back. Its inputs rest on sources that have not been re-read, so the public build refuses the screen; a local build shows it marked not for publication. It stays out of the public build until those sources are re-read.

The pages ship no result. The lab computes its results in your browser on each visit, from the scenario and the seeds you choose.

## Repository map

```
engine/              the TypeScript simulation engine (seeded, no Math.random); its tests sit beside it
src/                 the lab page (Preact), its Web Worker, the English and Korean dictionaries
site/infographic/    the explainer: src/ -> build.py -> index.html
scenarios/           scenarios, profiles, architectures and experiments, as data with ledger references
schemas/             JSON schemas for the data the engine reads and writes
docs/                adr/ decisions, design/ specifications, research/ ledgers, reviews/, progress.md
prompts/             the briefs and principles that the AI sessions work from
scripts/             checks, site assembly, headless page QA, Claude Code hooks, git hooks
tests/               pytest for the scripts, the hooks, the docs check and the Pages workflow
.github/workflows/   the Pages workflow, started by hand
.claude/             CLAUDE.md, hook settings, skills, agents, the list of author-owned paths
```

The root also holds the project files: `package.json` with `package-lock.json`, `pyproject.toml` with `uv.lock`, `tsconfig.json`, `eslint.config.js`, `vite.config.ts` (the Vitest settings), `.nvmrc`, `.python-version` and `LICENSE`. `sql/` and `reference/` are reserved for the author's own implementation track (see "How the work is done") and are not in the repository yet.

## Run it

```bash
npm ci                                          # Node as in .nvmrc
uv sync --frozen                                # Python through uv
git config core.hooksPath scripts/git-hooks     # once per clone

uv run pytest -q                                # scripts, hooks, docs check, site
uv run --frozen python scripts/check_docs.py --all   # banned tokens, ADR format, ledgers, id references
npm run check                                   # lint, typecheck, Vitest, then the I12 budget alone
bash scripts/check_all.sh --manual              # the full gate; add --lab for the end-to-end checks of the lab

uv run python site/infographic/build.py         # rebuild the explainer page
uv run python scripts/qa_infographic.py         # headless check of the explainer, output in qa_out/
uv run python scripts/assemble_site.py          # build dist/site/: the explainer at the root, the lab under lab/
uv run python scripts/qa_site.py                # headless check of dist/site/
uv run python -m http.server --directory dist/site 8000   # then open http://127.0.0.1:8000/
```

The lab needs a web server, not a file URL, because its Worker fetches a file.

## How the work is done

Decisions are written as ADRs in `docs/adr/`. The AI tools write them as Proposed; the decider's note and the change to Accepted are the author's own commits (ADR-0002).

Much of the engine, the lab and the documents were written with AI coding tools (Claude Code) working from written briefs in `prompts/`. Scripts and tests check what they produce, and the author decides at set gates: accepting an ADR, anything published, the author's own track, and release (`prompts/PRINCIPLES.md`, section 1). Pushing and publishing are the author's alone, and hooks stop the tools from doing either.

The author writes the database schema, three SQL queries (an as-of join of results to process context, a recursive lineage query and a bridging correction) and a SimPy core loop personally. The tools may review those files but not write them, and an edit guard enforces that (ADR-0010). Because the files do not exist yet, the tests that would compare the SimPy loop with the TypeScript engine skip, and agreement between the two is unproven.

## Licences

Code is under the MIT licence (`LICENSE`). Text, figures and data tables in `docs/`, `prompts/` and the explainer are under CC BY 4.0 (`docs/LICENSE-docs.md`). Sources cited in the ledgers keep their own terms; the ledgers hold only short quotes and links (ADR-0008).

## 한국어 요약

합성 데이터로 만든 시뮬레이터입니다. 바이오리액터 여러 대가 분석기 몇 대를 공유하는 가상의 플랜트를 한 번 돌려, 같은 실행을 여러 데이터 아키텍처로 기록하고 각 기록이 나중에 무엇을 복원할 수 있는지 비교합니다. 실제 설비를 예측하지 않습니다.
해설 페이지와 랩 두 곳이 있고, 저자가 공개하면 위 주소에서 열립니다. 모든 수치에는 근거 장부의 id(`S###`, `A###`)가 붙고, 오염 이벤트 역추적 화면은 근거 출처를 다시 읽을 때까지 공개 빌드에서 빠져 있습니다.
DDL, SQL 쿼리 세 개, SimPy 핵심 루프는 저자가 직접 작성합니다(ADR-0010).

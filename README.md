# Sample Lineage Lab

A portfolio simulator for one question: when a bioreactor sample is analysed later on a shared instrument, how much of its process context can still be recovered, and which parts of the data architecture decide that?

> **Status: design phase.** All data are synthetic. The scenario is generic, built from public sources and labelled assumptions (ADR-0001). No engine code exists yet and there are no simulation results. Nothing here predicts a real laboratory.

## The problem

In a process-development laboratory, a few at-line analyzers serve many bench-scale bioreactors. Samples queue, so a result is measured some time after the draw, on an instrument with its own clock, calibration and reagent lot. If the record keeps only the time of measurement, the result can be joined to the wrong process state, a rerun can overwrite the original, and a replayed file can count twice.

The simulator records one synthetic "truth" run under several data architectures, so the only thing that changes is how data is captured and stored. It then scores what each architecture can reconstruct afterwards. The default scenario has 24 reactors in two bays and 2 analyzers (A001, A022; ADR-0009). Average load is low, 12.6 to 14.4 percent of analyzer time over a 10 h staffed window (design arithmetic from A074 and A098, not a simulation result). If samples still wait, the cause would be bursts rather than average capacity; that is a hypothesis the simulator tests.

## The central case: feed in the gap

Example times (A102): a sample is drawn at 08:40, a bolus feed happens at 09:00, and the analyzer measures the sample at 09:25.

```
08:40 sampled_at ---- 09:00 feed ---- 09:25 measured_at      (draw to measurement: 45 min, A102, derived)
```

A record that stores only `measured_at` pairs the result with the post-feed process state, although the sample was drawn before the feed. A record that also stores `sampled_at` pairs it correctly. The simulator replays the same synthetic sample under each architecture and compares the outcome. Whether and how often this matters in a given lab is what the experiments are for, and they have not run yet.

## What the simulator will compare

- **Feature flags** (ADR-0005), each tied to the error it targets: `system_issued_id`, `two_clocks`, `available_at`, `instrument_state_snapshot`, `append_only_versions`, `write_time_keys`, `ingest_idempotency`, `audit_trail`.
- **Presets** built from the flags: A manual/Excel (no flags), B LIMS-lite (issued id, idempotent ingest, audit trail), C context-preserving (all flags). B is meant as a fair baseline, not a straw man. Ablations switch one flag off from C.
- **Labelling setting** (layer L2, independent of the flags): handwritten, pre-printed barcode, or issued at draw (ADR-0005).
- **Capture path setting** (ADR-0014; read when the optional raw device layer is on): `manual_transcription`, where a person types the value from the instrument screen or printout (preset A default), or `adapter_ingest`, where synthetic device files modeled on public documentation are parsed by adapters (B and C default). Any preset can switch it, so automatic linkage can be tested on its own.
- **Judging**: the gate is structural, with hand-typed forced-error fixtures. Stochastic comparisons run over at least 20 seeds (A103), are reported with intervals and are never gated. Orderings between presets must emerge from mechanisms; C is not built to win, and its residual errors are reported.

## What you can inspect today

- **Infographic**: open `infographic/index.html` in a browser. A scroll explainer of the problem, English first with a Korean toggle (ADR-0006), with a measurement-time slider and a flag-by-error outcome matrix.
- **Design**: `docs/design/simulation_spec.md` (layers, the truth/recorded-world contract, profiles, flags, experiments) and `docs/design/data_model.md` (canonical names and time fields).
- **Decisions**: `docs/adr/`, ADR-0001 to ADR-0014. All are Proposed; the author decides.
- **Evidence ledgers**: `docs/research/`. Sources (`S###`) and assumptions (`A###`) carry a grade (S sourced, P proxy, D derived, A assumed) and a verification level (snippet, agent-read, main-reread). Only main-reread sources back numbers on public pages; anything else is labelled provisional.
- **Harness and tests**: `scripts/check_docs.py` (ADR format, ledger ids, the public-number rule), Claude Code hooks, git hooks and the pytest suite in `tests/`.

## What comes next

| Session | Builds |
|---|---|
| S1 engine | Contracts, schemas, hand-calculated fixtures, TypeScript engine for process, sampling and analysis (L1 to L3); the author's SimPy core loop and DDL |
| S2 capture and metrics | Flags and presets, error injector, evaluator, experiments 1 and 2, raw device layer, data dictionary; the author's three SQL queries |
| S3 lab UI | Browser UI with presets and a lineage view, end-to-end tests; contamination break-out events and the investigation walk-back (ADR-0013, SC12) |
| S4 downstream | Genealogy (many-to-many lineage) and HPLC contention; cell-line and operating-mode profiles (ADR-0013, SC13, SC14) |
| S5 release | Model card, demo, case write-up, external-review dispositions |

Planned extensions (ADR-0013) are designed but not built before S2: contamination break-out events come with S3, cell-line profiles and operating modes with S4.

## Repository map

```
docs/adr/         decision records (0000-template.md is the format)
docs/design/      simulation_spec.md, data_model.md
docs/research/    sources.yaml, assumptions.yaml, README.md (grades, verification)
docs/reviews/     review dispositions
docs/progress.md  dated log, newest entry last
infographic/      src/ -> build.py -> index.html
prompts/          briefs, principles, review rubric
scripts/          check_docs.py, check_all.sh, hooks, QA scripts
tests/            pytest for the guards and the docs check
.claude/          hook settings, skills, agents, author-owned path list
```

`engine/`, `src/`, `schemas/`, `scenarios/`, `sql/` and `reference/` appear as the sessions above land.

## Run the checks

```bash
uv run pytest -q
uv run --frozen python scripts/check_docs.py --all
bash scripts/check_all.sh --manual                 # the full gate: docs check, pytest, Node checks
uv run python infographic/build.py                 # rebuild infographic/index.html from infographic/src
uv run python scripts/qa_infographic.py            # headless page QA, output in qa_out/
```

Python dependencies go through `uv` (`uv.lock`). Run `git config core.hooksPath scripts/git-hooks` once per clone.

## How this was built

- AI coding tools implement the work under an orchestrator. The orchestrator writes a brief per increment, spawns executors, verifies the result on disk against a rubric and commits locally. Executors never commit or push.
- Design decisions, assumptions and acceptance criteria are recorded as ADRs. Tools write them as Proposed only; the decider's note and the Accepted flip are the author's own commits.
- The author implements the canonical DDL, three SQL queries (an as-of join of results to process context, a recursive lineage query, a bridging correction) and the SimPy core loop personally (ADR-0010). AI may review these files but not write them, and an edit guard enforces that. None of them exist yet, so parity between the TypeScript engine and the SimPy loop is unproven.
- Principles, briefs and the review rubric live in `prompts/` (`PRINCIPLES.md` first, then `README.md`).
- Pushing, remote changes and publishing are done by the author.

## 한국어 요약

Sample Lineage Lab은 합성 데이터로 만드는 포트폴리오용 시뮬레이터입니다. 바이오리액터 여러 대가 분석기 두 대를 공유할 때, 샘플이 나중에 측정되면서 잃게 되는 공정 맥락(어느 리액터, 어느 시점, 어떤 장비 상태)을 데이터 아키텍처별로 얼마나 복원할 수 있는지 비교합니다.
현재는 설계 단계입니다. 엔진 코드와 시뮬레이션 결과는 아직 없고, 모든 데이터는 합성이며 실제 설비를 예측하지 않습니다.
지금 볼 수 있는 것은 인포그래픽(`infographic/index.html`, 영어 기본에 한국어 전환), 설계 문서, ADR, 근거 장부(`S###`, `A###`), 검증 하네스입니다.
ADR은 모두 Proposed 상태이며 Accepted 전환은 저자가 합니다. DDL, SQL 쿼리 세 개, SimPy 핵심 루프는 저자가 직접 구현합니다(ADR-0010).

# 30 — S3 executor brief: lab UI, lineage view, challenge, break-out events

Read `prompts/00_master_build.md` first. Start only after the S2 close is recorded (check `docs/progress.md`, "S2 close (orchestrator)") and the author has decided ADR-0016, ADR-0017 and ADR-0018: `Accepted` in the repository, or decided in chat with the decision quoted in the ADR and in `docs/progress.md` and the acceptance file waiting for the author's own commit (2026-10-30). The status lines stay as the author leaves them. The orchestrator splits this brief into batches (S3a, S3b, ...) and sends one at a time, each with the header of `PRINCIPLES.md` section 7; a batch names the steps it covers. Executor: Sonnet, effort xhigh; Opus 5.5 in the cases of `prompts/README.md`.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combinations (S3): UI exploration YOLO + FAFO + KISS, then lock what stays with TDD + E2E; break-out events (engine) SDD + TDD + EDD + BDD + YAGNI + HITL (ADR-0013). Always KISS, AHA, SRP, Small Batches. Rails: PRINCIPLES.md section 6.
A spike (exploration) lives in a scratch copy or is deleted before the report; what stays is written test first. Scenarios become Given-When-Then acceptance tests named after the scenario id. Goldens are never regenerated.
You never commit; report structure-only paths and behaviour paths as two lists.
HITL gates touched: ADRs (new ones `Proposed` only); the public flip of the repository and of GitHub Pages is the author's (00 section 4) and no step publishes anything.

## Goal

A static lab page in which a reader runs the synthetic plant in the browser, records it under architectures A, B and C (and C with one flag off), sees what each record can reconstruct, follows one sample's lineage through each architecture, and tries the challenge. Then the first break-out event: a contamination with its signals, confirming tests, holds, retro-flags and the investigation walk-back (SC12), with the ninth flag `material_lot_links` (ADR-0017). Synthetic data only; the page never claims real plant data.

Decisions already made by the author (do not reopen them): Preact pinned, no other UI dependency, the lineage view is SVG drawn by the page, the engine in a Web Worker (ADR-0018, ADR-0003); the browser check of ADR-0016; the challenge is "find the error in the record" (chat, 2026-10-30): the page plants one error into a run, the reader sees only one architecture's record and looks for the affected sample or decision, then the truth and what A, B and C could each have shown are revealed; the label error of C without `system_issued_id` is shown with its numbers unchanged and a sentence that a VR-008b conflict cannot tell a replay from a label collision (S2g, spec section 5); English first with a Korean toggle (ADR-0006).

## Allowed paths

`src/` (the lab page, new), `engine/src/` (the Worker-facing entry and the break-out modules of Step 5), `scenarios/`, `schemas/`, `tests/` (incl. `tests/fixtures/`, `tests/e2e/` if the design puts the end-to-end tests there), `scripts/` (a lab QA script beside `qa_infographic.py`; `check_all.sh` only if the design adds the lab checks to it), `docs/design/` (the new `lab_ui.md` and clarifications), `docs/progress.md`, Proposed ADRs. `package.json` and `package-lock.json` only in the batch that installs Preact (exact versions, each release at least two weeks old). `vite.config.ts`, `tsconfig.json` and `eslint.config.js` only to add what the lab needs: no existing rule loosened, removed or downgraded; the report includes their diff. `.github/workflows/` only in Step 6 (a Pages build workflow; nothing is published).
Never touch: `sql/`, `reference/`, `docs/research/*.yaml` (a new number goes to the orchestrator as a ledger request), `docs/private/`, `infographic/`, `tests/golden/`.

## Step 0

- [ ] Read `.guardrails.local.txt` once (never write its tokens), `CLAUDE.md`, ADR-0003, ADR-0005, ADR-0006, ADR-0013 to ADR-0018, `docs/design/simulation_spec.md` sections 5, 7, 8 and 11, `docs/design/data_model.md` sections 7, 8 and 15, `docs/design/single_sample_trace.md`, and the last entries of `docs/progress.md`. Confirm the three Done gates are green before changing anything (paste the tails).

## Step 1 — the lab design note (SDD; a spike allowed)

Write `docs/design/lab_ui.md`: the screens and what each shows, from which data; the Worker protocol (messages of plain data; what runs in the Worker; the page never imports truth modules, and the challenge reveal and the evaluator results arrive as plain data); how numbers are shown under invariant 3 (inputs carry their `S###` or `A###`; outputs are labelled as simulation results with scenario and seeds, never as facts); the English and Korean texts; the browser check of ADR-0016 (the page recomputes the default scenario's log hash in the Worker and compares it with the hash built with the page, and says plainly when they differ); the challenge (which errors it plants, how a guess is scored, what is revealed); the lineage view (which records, which architectures, how an unanswerable field is drawn); the size and time budgets and how they are measured; the end-to-end tests (headless only) and where they run; the Pages workflow. A throwaway spike may measure the budgets (Preact plus Vite build of a minimal page running the default scenario in a Worker: gzip size of the first load, Worker run time in headless Chromium); report the numbers and delete the spike. The orchestrator reviews the note before any build step starts.

## Step 2 — the lab shell (TDD + E2E)

The build of `src/` with Vite and Preact; the engine in a Web Worker; the browser check of ADR-0016; import zones that keep `src/` away from truth modules (only the Worker entry may import the engine assembly, as the design says); the headless end-to-end harness; the budgets measured in the gate: first load at most 300 KB gzip (`gzip -c <file> | wc -c` over the built files), the default scenario's engine run at most 1 s in the Worker in headless Chromium.

## Step 3 — presets, controls and results

Preset picker (A, B, C and C with one flag off), capture path, scenario picker, the N by M controls with profiles per bay and per analyzer (ADR-0015), seeds; the section 8 metrics per architecture with their intervals across seeds; the label-error sentence; the English and Korean texts; the flags in every place that lists them, including the ninth once Step 5 lands.

## Step 4 — lineage view and challenge

The lineage view of one sample per architecture (SVG; the single-sample trace of S2d is the reference case); the challenge as the design note states it. Every planted error comes from the injector's catalogue, keyed like every other draw (invariant 2).

## Step 5 — break-out events and SC12 (engine; SDD + TDD + EDD + BDD + YAGNI + HITL)

Spec section 11.4 and data_model section 15 as written: the contamination event script, signals before tests, confirming tests with long turnaround on `external_lab`, `deviation` and `quality_hold`, the retro-flag (VR-022), VR-021, material lots with `consumed_in` and `seeded_from` edges, and the ninth flag `material_lot_links` (ADR-0017: presets A off, B off, C on; nothing reads it without the extension, so earlier outputs keep every recorded value; outputs that list the flags gain an entry, listed in the report). The walk-back covers directions 1 and 3 (data_model 15.4); the recursion SQL stays the author's. SC12 as catalogued in spec section 11.5, with A176 and A177 as scenario inputs printed with every result. Forced-error fixture typed by hand before any run: a contaminated batch that shares a medium lot with a clean batch; with the flag on, direction 3 reaches the clean batch; with it off, it does not. A gap that needs a number without a ledger entry is listed as blocked, never filled. The orchestrator runs `sim-adversary` once on this step's deliverables.

## Step 6 — break-out in the lab, Pages workflow, release checks

SC12 in the lab (the walk-back and the retro-flag shown per architecture); a GitHub Pages build workflow that builds and uploads the static files when the author runs it (nothing is published by the executor); the full-history banned-token scan (`pre-push` scans the whole history; run its scan without pushing) reads 0; the end-to-end tests and the budgets green.

## Gate and report

Blocking (AI path): headless end-to-end tests green; the full-history banned-token scan reads 0; the size and time budgets met (a breach is a major finding); the browser check of ADR-0016 present and tested; the SC12 forced-error fixture exact; the ninth flag's ablation fixture exact; earlier outputs unchanged in every recorded value; `npm run check`, `uv run pytest -q`, `check_docs --all` and `bash scripts/check_all.sh --manual` green.
Mutation spot checks to run in a scratch copy and report: let the page import a truth module outside the Worker entry (the zone must fail); make the browser check compare against a wrong hash (its test must fail); let the challenge reveal arrive before the guess (its test must fail); drop the lot edge when `material_lot_links` is on (the SC12 fixture must fail); let direction 3 walk two steps back (the walk-back test must fail); key a break-out draw by the label (invariant 2 test must fail). Revert each.
Report at most 300 words per batch; append the `docs/progress.md` entry.

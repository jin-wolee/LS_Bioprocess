# Progress log

Newest entry last. Each entry: what was done, what is open for the author, what comes next.

## 2026-10-29 — S0a: harness, research ledgers, design, ADRs, prompts

**Done**
- Harness: Claude Code hooks (publishing guard, tool guard, per-edit doc check, Stop check, session brief), git hooks (pre-commit token scan, pre-push needs `ALLOW_PUSH=1` and scans history), `scripts/check_docs.py`, 86 pytest cases.
- Research: `docs/research/sources.yaml` (52 sources; 11 re-read by the orchestrator and marked `main-reread`), `docs/research/assumptions.yaml` (76 parameters graded S/P/D/A), `docs/research/README.md`.
- Re-reading the sources changed the design: neat-sample viability does not decline within the tested hold (A038–A040), so hold-time viability loss is a scenario knob, not the headline. The headline cases are "feed in the gap" (joining by measured time pairs a pre-feed value with post-feed process state) and offline pH used to re-standardise the online probe (S013).
- Design: `docs/design/simulation_spec.md`, `docs/design/data_model.md`.
- Decisions: ADR-0001 to ADR-0012, all `Proposed`.
- Prompts: `prompts/PRINCIPLES.md` (stage-by-stage principle combinations) plus master, S1, S2, author-track, review-rubric and external-review briefs.

**Open for the author (HITL)**
- Create the private backup repository and push (command given in chat; the AI does not push).
- Read ADR-0001 to ADR-0012; flip the ones you agree with to `Accepted`, write the decider's note, and commit that change yourself.

**Next (S0b, start a new session inside this repo)**
1. Confirm the hooks fire live (session brief, publishing guard, edit check, Stop check).
2. README (English first, Korean summary).
3. Infographic (`infographic/src` → `build.py` → `index.html`), headless QA script, private preview link.
4. Vault hub note.

## 2026-10-29 — S0a review round and rework

**Done**
- Three independent reviews (two Opus agents, one external codex `gpt-6.1-sol` xhigh); 31 findings, all accepted. Public summary: `docs/reviews/2026-10-29_s0a_review.md`.
- Harness: `check_all.sh --manual` gate, change detection by repository state (catches shell edits), tests in the gate, public-number check extended to `docs/research/README.md` with assumption → source tracing, ledger schema (range/unit, bundle components, weakest-grade rule), two more publishing commands blocked. 155 tests.
- Research: 118 assumptions (A077–A118 added), 56 sources; grades corrected (cell-free pH offset → P, vendor bead study → P, unsourced range ends marked); neat-sample viability wording corrected.
- Design: `data_model.md` is the naming authority; `hold_time`/`turnaround` defined once; `two_clocks` vs `write_time_keys` separated; as-of covers result versions and historian rows; S2 gates are structural forced-error fixtures, stochastic comparisons are reported, never gated; false-alarm rate and M/M/c step added.
- Prompts: design is the source of truth; `00_master_build.md` trimmed to invariants, gates, ownership and pointers; author-track cards aligned with `data_model.md`; untracked-aware commands; tool verdicts listed.

**Open for the author (HITL)**
- Private backup repository and first push (command in chat).
- ADR-0001 to ADR-0012: decide, write the decider's note, commit yourself.

**Open questions**
- The evaluator may read the truth world (needed to score); recorders and the decision layer may not. Recorded in `simulation_spec.md` observation contract.
- `scripts/check_docs.py` is 346 lines (target ≤300): split it in a structure-only commit at the start of S1.
- Before S0b puts numbers on a public page, the orchestrator must re-read the sources behind them (currently 11 are `main-reread`; new kinetics and precision sources S003, S053–S056 are `agent-read`).

**Next**: S0b in a new session started inside the repo.

## 2026-10-29 — Infographic, planned extensions, device output adapters

**Done**
- Infographic (`infographic/`, built from `infographic/src` by `build.py`): seven sections, English first with a Korean toggle, light/dark plus opt-in neon theme and story mode, two interactions (measurement-time slider, feature-flag outcome matrix). Headless QA (`scripts/qa_infographic.py`, 8 checks incl. SVG clipping) passes; private preview published.
- Planned extensions (ADR-0013, Proposed): per-reactor cell-line profiles, operating-mode profiles, break-out events (contamination/sterility failure) with the investigation walk-back; SC12–SC14; entities for material lots, deviations, quality holds and retro-flagging. Scheduled after S2.
- Device output adapters (ADR-0014, Proposed): a raw device layer between L3 and L4 — synthetic files and controller records modeled on public documentation (three analyzer dialects, two controller families), parsed into the canonical schema; no compatibility claims; no manual text or licensed schema files in the repository.
- Ledgers: 103 sources, 177 assumptions.

**Open for the author (HITL)**
- Private backup repository and first push.
- ADR-0001 to ADR-0014: decide, write the decider's note, commit yourself.
- ADR-0014 open question: preset A has no adapter (results typed by hand) — confirm or change.

**Open questions**
- S2 Step 7 (controller emitters) needs ledger entries first: logging deadband and maximum interval for tags other than agitation, gas-flow/pump/off-gas CO2 signal parameters, alarm acknowledgement time, pH/DO alarm deadbands (`simulation_spec.md` §2.4.8). Without them Step 7 stops and reports.
- Lot withdrawal schedule for SC12: now A187 (P); the time from a confirmed positive to the recall decision has no source (inside A176).
- Before any number from a non-re-read source goes on a public page, the orchestrator re-reads it.

## 2026-10-29 — Ready to start development (pre-S1 complete)

**Done**
- Author decisions recorded: preset A types results by hand (no adapter); a separate `capture_path` setting (manual_transcription / adapter_ingest) lets any preset switch, so automatic linkage can be compared on its own (ADR-0014, spec §5).
- Controller emitter inputs (A178–A187) and S1b process/logistics inputs (A188–A211) in the ledgers: 117 sources, 211 assumptions.
- README (English first, Korean summary); vault hub note and two MOC lines (vault left uncommitted for the author).
- `scripts/check_docs.py` split (structure only, behaviour proven identical).
- Independent readiness review: GO WITH FIXES; all 5 blockers and 12 fixes applied. S1 split into `prompts/10_S1a_contracts_analyzer.md` and `prompts/11_S1b_process_sampling.md`.

**State**: S1a can start now; S1b inputs exist. All gates pass (`bash scripts/check_all.sh --manual`).

**Open for the author (HITL)**
- Private backup repository and first push.
- ADR-0001 to ADR-0014: decide, write the decider's note, commit yourself.
- Vault: review and commit the new hub note and the two MOC lines.
- Author track (non-blocking): canonical DDL, three SQL queries, SimPy core loop (`prompts/60_user_track.md`).

**Next**: start a new session inside the repo; S1a Step 0 checks that the hooks fire live, then contracts and the analyzer DES.

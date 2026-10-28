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

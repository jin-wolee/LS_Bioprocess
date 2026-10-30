# ADR-0018: Lab UI stack: Preact, with the engine in a Web Worker
- **Status:** Proposed
- **Date:** 2026-10-30
## Context

Session S3 builds the lab UI (`prompts/00_master_build.md` section 4): presets, the N by M controls (ADR-0015), a lineage view, the challenge, end-to-end tests and a GitHub Pages workflow. Its budgets are measured, not estimated: the lab's first load at most 300 KB gzip, and the engine run of the default scenario at most 1 s in a Web Worker (ADR-0003). The page is static. It needs English and Korean (ADR-0006). Vite is already a pinned dev dependency. The infographic is a separate page in plain JavaScript (ADR-0011) and is not part of this decision. No ADR names a UI library.

## Options

1. **Preact.**
   - Pro: a component model with hooks at a few KB gzip; the stateful screens (presets, N by M controls, result tables, lineage, challenge) get a structure; one runtime dependency.
   - Con: one more dependency to pin and update; JSX needs a compiler setting and lint rules.
2. **Plain TypeScript, no library.**
   - Pro: no dependency; the same approach as the infographic.
   - Con: every screen update is written by hand, so the code grows and state bugs are easier to make.
3. **Svelte.**
   - Pro: a compiler with a small runtime.
   - Con: a build plugin and its own lint and type tooling on top of the TypeScript toolchain.
4. **React.**
   - Pro: the most familiar ecosystem.
   - Con: the heaviest of the four, tens of KB gzip, with no feature the lab needs that Preact lacks.

## Decision

Proposed: option 1.

- Preact is pinned to an exact version, the newest release at least two weeks old when S3 installs it (11.0.1 of 2026-10-08 at the time of writing; the 10.x line is the fallback if 11 breaks a tool the lab needs). A Vite plugin for Preact is added only if Vite cannot compile Preact JSX by itself, pinned the same way.
- No other UI dependency: no router, no state library, no chart or graph library. The lineage view is SVG drawn by the page.
- The engine runs in a Web Worker and the page talks to it by messages of plain data. The browser check of ADR-0016 lives in that Worker.
- The size budget is checked in the S3 gate with `gzip -c <file> | wc -c` on the built files.

## Consequences

- Positive: a small, structured UI within the budget; the engine stays free of UI code; a later move away from Preact touches the page, not the engine.
- Negative: one more dependency and its update cadence; lint rules for JSX; the two pages (infographic and lab) use two styles of code.
- Open: whether Preact's signals package is worth its size is left to the first screen that needs shared state (not added now).

## Evidence

- Decisions it builds on: ADR-0003 (engine in a Web Worker), ADR-0006 (English first with a Korean toggle), ADR-0011 (the infographic, a separate page), ADR-0015 (the N by M controls), ADR-0016 (the browser check).
- Budgets: `prompts/00_master_build.md` section 4.
- No `S###` or `A###` applies: the choice is a tooling decision, not a domain number.

## Author statement (verbatim, if any)

> Chose "Preact (Recommended)" (chat, 2026-10-30, asked which UI library the lab uses)

## Decider's note
_(author only — Claude never writes here)_

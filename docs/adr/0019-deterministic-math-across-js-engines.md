# ADR-0019: Deterministic maths across JavaScript engines
- **Status:** Proposed
- **Date:** 2026-10-30
## Context

Invariant 2 says a run is deterministic: the same seed gives the same bytes. The S3a spike (`docs/design/lab_ui.md` sections 7 and 12) ran the engine unchanged in Node and in headless Chromium, Firefox and WebKit on one machine. The strict log hash of the default scenario differed in every browser from the golden, and the browsers differed from each other, on seeds 1 to 5. Only float fields differed, by at most 9.3e-15 relative in Chromium (seed 1); ids, counts, integer times and the event order were equal. The cause is the engines' maths libraries: ECMAScript leaves `Math.log`, `Math.exp`, `Math.cos` and the other transcendental functions, and the exponent operator, "implementation-approximated", and a probe of 20,000 inputs found `log`, `cos`, `sin`, `exp` and `atan` different in all four engines. The operations IEEE 754 defines exactly (`+`, `-`, `*`, `/`, `Math.sqrt`, comparisons, `Math.floor` and the like) agreed.

The engine calls such functions in five places: `Math.log` twice and `Math.cos` once in `engine/src/rng.ts` (the Gaussian and exponential draws), `Math.exp` in `engine/src/sensors.ts` and in `engine/src/stability.ts`; and the exponent operator once in `engine/src/evaluate/stats.ts`. So a result is byte-identical per engine build only. The lab (S3, ADR-0018) runs the engine in the reader's browser, and its browser check (ADR-0016) compares the browser's run with a reference built in Node.

## Options

1. **Keep the native functions and check in two tiers** (the S3a design): a strict hash, and a hash of the log rounded to 6 significant digits.
   - Pro: no engine change; the goldens stand.
   - Con: a browser reproduces the reference only to about 14 digits, so the page can claim "equal to 6 digits" and not "the same bytes"; a value that sits on a rounding edge can still fail the rounded tier; invariant 2 holds per engine, not per run.
2. **Replace every implementation-approximated operation in `engine/src` by code that uses only exactly specified IEEE 754 operations, and regenerate the goldens once.**
   - Pro: the same seed gives the same bytes in Node and in every browser, so the browser check is one strict comparison and the claim of invariant 2 holds as written; a lint rule keeps it so.
   - Con: the last digits of float fields in the goldens change once, which is a regeneration that needs the author's approval; the ported functions are slower than native ones; their code must be shown correct to within the accuracy the draws need.
3. **Round every float at the point it enters the log.**
   - Pro: small code change.
   - Con: a value rounded on one engine and not another can still flip at a rounding edge; it changes every logged value and hides precision the evaluator uses.

## Decision

Proposed: option 2.

- A small module of the engine (for example `engine/src/xmath.ts`) provides `log`, `exp` and `cos` (and any other function a later change needs) using only `+`, `-`, `*`, `/`, `Math.sqrt`, comparisons and exact integer and bit operations. It is a port of a published, permissively licensed implementation, cited with its licence in the file header, and its tests compare it with known values and with the native function to the accuracy the draws need.
- The five call sites use it; `x ** 2` becomes `x * x`. A lint rule refuses `Math.log`, `Math.exp`, `Math.cos`, `Math.sin`, `Math.tan`, `Math.atan`, `Math.atan2`, `Math.pow`, the other transcendental `Math` members and the exponent operator in `engine/src`, as `Math.random` is refused today.
- The goldens are regenerated once, in the batch that makes the change, only if the regenerated logs differ from the old ones in float fields alone (no id, count, integer time or event order changes), with the largest relative difference stated. Any other difference stops the batch for the author.
- The browser check of the lab becomes one strict comparison with the reference built in Node under the ADR-0016 flag, plus the repeats inside the Worker.

## Consequences

- Positive: invariant 2 holds across Node and browsers; the lab can say "this browser reproduced the reference byte for byte"; a later Node or browser upgrade cannot move a result through its maths library.
- Negative: one regeneration of the goldens, recorded with the author's approval; slower draws (measured in the batch against the I12 budget); one more engine module to maintain.
- Open: whether any other engine behaviour differs across engines (the S3a spike saw none beyond the maths functions); the lab's end-to-end test in Firefox and WebKit will show it.

## Evidence

- Measurements: `docs/design/lab_ui.md` sections 7 and 12 (S3a spike, 2026-10-30) and `docs/progress.md`, "S3a: the lab design note" and "S3a review (orchestrator)".
- Code: `engine/src/rng.ts` (Gaussian and exponential draws), `engine/src/sensors.ts`, `engine/src/stability.ts`, `engine/src/evaluate/stats.ts`.
- Decisions it builds on: ADR-0003 (engine in a Web Worker), ADR-0016 (the browser check), ADR-0018 (the lab); invariant 2 of `CLAUDE.md`.
- No `S###` or `A###` applies: the evidence is the project's own measurement of its runtime.

## Author statement (verbatim, if any)

> Chose "결정적 수학 함수로 교체" over "2단 검사 유지 (Recommended)" (chat, 2026-10-30; the option text named the golden regeneration it needs)

## Decider's note
_(author only — Claude never writes here)_

# ADR-0003: Stack: TypeScript engine in a Web Worker, SimPy reference, DuckDB for SQL
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The simulator must run in a browser from a static site (no server, no accounts), be deterministic, and have an independent check on its core event loop. The author intends to write a reference core loop in Python (ADR-0010). Lineage and as-of queries need a SQL dialect with an as-of join and recursive queries, and the same SQL should run in Python tests and, optionally, in the browser.

## Options

Engine:

1. **TypeScript engine in a Web Worker, plus a SimPy reference used for golden fixtures.** The two read the same trace file in integer seconds and must agree exactly on event times.
   - Pro: runs in any modern browser with no download beyond the page; the Python reference gives an independent implementation; parity failures expose logic errors in either.
   - Con: two implementations of the core loop to keep in step; parity cannot be judged until the reference exists (see the separate gates in ADR-0010).
2. **Python only, in the browser through Pyodide.**
   - Pro: one implementation.
   - Con: a multi-megabyte runtime download before anything runs; slower start; the other browser-side Python route in the survey states it does not work in Firefox (S034). A browser-based discrete-event lab with seeded trace replay does use Pyodide (S033), so the route is viable but heavy.
3. **TypeScript only, no reference.**
   - Pro: least work.
   - Con: the engine would be judged only by its own tests; no independent check of event ordering.
4. **Python engine behind a server.** Rejected: a server is a stated non-goal.

SQL dialect:

1. **DuckDB.** Supports `ASOF JOIN` and recursive CTEs; the same SQL runs in Python (`uv`) and, optionally and lazily loaded, in the browser through DuckDB-WASM. DDL is written in standard SQL so it stays portable to Postgres.
2. **SQLite.** Ubiquitous, recursive CTEs work, but there is no as-of join; the as-of query would be a correlated sub-query that hides the idea the query is meant to show.
3. **Postgres.** Portable and strict, but needs a server and has no as-of join either.

TypeScript version:

1. **Pin TypeScript 6.0.3.** A registry check on 2026-10-28 showed `typescript-eslint` 8.72.1 declaring a peer range of `typescript <6.1.0`, which excludes TypeScript 7.0.2.
2. **TypeScript 7.0.2 with Biome 2.6.3 instead of `typescript-eslint`.**
   - Pro: current compiler, one fast tool.
   - Con: fewer type-aware rules; the `Math.random` ban would rest on a weaker rule plus the grep in `scripts/check_all.sh`.

## Decision

Proposed: TypeScript engine in a Web Worker with a SimPy reference; DuckDB as the SQL dialect (DuckDB-WASM lazy-loaded and off by default); TypeScript pinned to 6.0.3 with `typescript-eslint`; Biome with TypeScript 7 stays the documented fallback. Node packages are pinned to exact versions, and Python dependencies go through `uv` only. Versions quoted here come from the registry check above and are re-verified at install time. Randomness is a seeded integer generator only; `Math.random`, `Date.now()` and `new Date()` are banned by lint and by a grep (determinism invariant).

## Consequences

- Positive: browser-only deployment; an independent reference; SQL that expresses the as-of and lineage ideas directly.
- Negative: dual maintenance of the core loop; a version pin that has to be revisited when `typescript-eslint` widens its peer range; DuckDB-WASM is heavy, so it is an optional lazy load and not part of the default bundle.
- The TypeScript engine is accepted on invariants, hand-calculated fixtures and an M/M/c-only test mode. SimPy parity is a separate gate that does not block the engine (`docs/prompts/00_master_build.md`, section 4).
- Pyodide and a server are out of scope.

## Evidence

- S033 (browser discrete-event lab using Pyodide with seeded trace replay), S034 (SimPy-in-browser route that does not work in Firefox).
- Version facts (TypeScript 6.0.3, 7.0.2, `typescript-eslint` 8.72.1, Biome 2.6.3) are software facts from the 2026-10-28 registry check; they carry no ledger id and are not domain parameters.

## Author statement (verbatim, if any)

> Chose "TS 엔진 + SimPy 기준 구현" (chat, 2026-10-28)

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".

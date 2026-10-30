# ADR-0016: Runtime flag against a V8 miscompile that breaks determinism
- **Status:** Accepted
- **Date:** 2026-10-30
## Context

Invariant 2 of the project says a run is deterministic: the same seed gives the same bytes. The two-process test of S2d (`engine/tests/assembly/two_process_determinism.test.ts`) and the S2c3 report found rare mismatches of experiment 2 that nobody could explain. The S2 adversary pass and the orchestrator traced them to the runtime, not to the engine:

- On Node v25.6.1 (V8 14.1.146.11-node.19, darwin arm64), Maglev escape analysis with concurrent on-stack replacement lets distinct object literals share their HeapNumber field boxes. An object pushed at `engine/src/experiments/assembly/closed_loop_arm.ts:110` then holds the values of a later reactor after the push. Nothing in `engine/src` writes those fields after construction.
- Measured: default flags, 24 of 480 runs of the experiment 2 runner differ (adversary pass), and 4 of 160 (orchestrator), each of those 4 showing an object changed after its push. With `--no-maglev-escape-analysis`, 0 of 160 in both passes, every output equal to the majority output. `--no-maglev`, `--no-turbofan`, `--no-use-osr` and `--no-concurrent-osr` also give 0 (120 to 160 runs each).
- Node 24 LTS, measured on 2026-10-30 at the author's request: on v24.22.2 (V8 13.6.233.17-node.63, darwin arm64) the canary (`engine/tests/support/v8_canary.ts`, 160 runs per set) gives 2 runs that differ from the majority without the flag (3 distinct outputs) and 0 with it, and the majority output is the same bytes as on Node 25. The faulty pass is in the 24 line too, and the flag works there.
- The truth run, the default scenario hash and experiment 1 showed no mismatch in 160 runs each. That the truth path can never be hit is not proven: it builds object literals with float fields in hot loops too.
- The flag cannot be passed through `NODE_OPTIONS` (Node refuses it); it must be on the command line of each process, or set by `v8.setFlagsFromString` before the code is compiled.
- The engine also runs in the browser, in a Web Worker (ADR-0003), where no V8 flag can be set.

## Options

1. **Keep the defaults and rely on the two-process test.**
   - Pro: nothing to change.
   - Con: about 2 to 5 percent of runs give silently wrong numbers; twelve test runs catch a 5 percent flake about half the time; a reported table can be wrong without any sign.
2. **Run every Node entry point with `--no-maglev-escape-analysis`, keep Node 25.**
   - Pro: the narrowest flag measured to stop it; no byte of the correct output changes, so the S1 goldens and every reported result stand; the author already chose Node 25.
   - Con: hides the bug rather than removing it; a process started without the flag can still hit it; each entry point (Vitest workers, CLI scripts, spawned children) must carry it.
3. **Switch to another Node line (24 LTS).**
   - Pro: none found: measured, the 24 line carries the same fault (2 of 160 runs differ without the flag, see Context).
   - Con: still needs the flag; reverses the author's choice of Node 25; the browser problem stays.
4. **Rewrite the known site (a Float64Array instead of an object literal).**
   - Pro: no flag.
   - Con: protects one site; the same pattern exists in other hot loops (`capture_contrast.ts`, `aggregate.ts`, `evaluate/closed_loop.ts`).
5. **`--no-maglev` (the whole mid-tier compiler).**
   - Pro: removes the tier that holds the faulty pass.
   - Con: broader than needed, and slower. Measured on 2026-10-30 at the author's request (Node v25.6.1, five interleaved rounds, medians, a shared machine at load 7 to 9): the first run of the default scenario in a process takes 122 ms against 113 ms with no flag and 110 ms with the flag of option 2; the experiment 2 runner (two seeds) takes 459 ms against 426 and 421 ms; warm runs of the default scenario are equal (88, 87 and 86 ms). So option 5 costs about 8 percent on cold and short runs, and option 2 costs nothing measurable.

## Decision

Proposed: option 2.

- Every Node process that runs engine code carries `--no-maglev-escape-analysis`: the Vitest workers, the CLI scripts and the child processes that tests spawn. A guard test fails when a worker or a spawned child runs without the flag.
- A canary script outside the gate runs the experiment 2 runner many times without the flag and prints the mismatch count. It is run when Node is upgraded; when it reads 0 over a run count stated in its output, the flag can be proposed for removal in a new ADR.
- Node stays at 25 (`.nvmrc`). A switch to the 24 LTS line would not remove the flag: the fault is there too (Context).
- Browser (S3 and S4): open. The page cannot set the flag. S3 designs a check for the browser: for example, the page recomputes the default scenario's log hash and compares it with the hash shipped with the page, and warns when they differ. No result is shown as reproducible in the browser until that check exists.
- A bug report to V8 is drafted outside the repository; filing it is the author's call.

## Consequences

- Positive: the gate stops flaking on this bug; results produced in Node are the correct bytes; the reason is written down with its measurements.
- Negative: an entry point added later without the flag is exposed again, which the guard test only catches where it looks; the canary must be run by hand on upgrades.
- Open: the browser check of S3; whether a later Node or V8 release fixes the pass.

## Evidence

- Measurements: `docs/progress.md`, "2026-10-30 — S2e2 review (orchestrator)", item Determinism; the S2c3 entry of the same file for the first sighting; the Node 24 canary run and the speed measurement of option 5 in the S2g review entry of the same file.
- Code: `engine/src/experiments/assembly/closed_loop_arm.ts:110`, `engine/src/evaluate/closed_loop.ts:25`, `engine/tests/support/determinism_cli.ts`.
- Decisions it builds on: ADR-0003 (engine in a Web Worker); invariant 2 of `CLAUDE.md`.
- No `S###` or `A###` applies: the evidence is the project's own measurement of its runtime, not a domain number.

## Author statement (verbatim, if any)

> Chose "플래그 고정 + ADR 제안 (Recommended)" and "초안만 작성 (Recommended)" (chat, 2026-10-30)

> Chose "Node 24 측정 후 결정" (chat, 2026-10-30, asked to decide ADR-0016)

> Chose "옵션 5 측정 후 결정" (chat, 2026-10-30, after the Node 24 measurement)

## Decider's note
Decided by the author in chat on 2026-10-30: "옵션 2 수락 (Recommended)", after the Node 24 measurement and the speed measurement of option 5.

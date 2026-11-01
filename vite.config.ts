import { configDefaults, defineConfig } from "vitest/config";
import { ENGINE_NODE_FLAGS } from "./engine/tests/support/node_flags.ts";

// S1a scaffold only: no UI yet (S3). The test block is read by Vitest.
// ADR-0016: every test worker runs with the engine's Node flags. The pool stays the default (forks): a forked worker takes execArgv on its command line, a worker thread cannot take
// V8 flags. engine/tests/node_flags.test.ts fails if a worker lacks them.
// H1: the I12 time budget is measured outside the parallel suite. A time limit among 200 files that run side by side measures the machine, not the engine, so the default run leaves
// engine/tests/perf_i12.test.ts out and `npm run test:perf` (mode "perf") runs it alone, after the suite, inside `npm run check`.
export const PERF_I12 = "engine/tests/perf_i12.test.ts";

export default defineConfig(({ mode }) => {
  const perf = mode === "perf";
  return {
    test: {
      include: perf ? [PERF_I12] : ["engine/tests/**/*.test.ts", "src/**/*.test.ts"],
      exclude: perf ? [...configDefaults.exclude] : [...configDefaults.exclude, PERF_I12],
      environment: "node",
      execArgv: [...ENGINE_NODE_FLAGS],
      // H1: the heaviest test that has no timeout of its own (raw/contrast.test.ts, the contrast runner) took 1.9 s with the machine as it was, 2.9 s beside 6 busy loops, 4.4 s beside 12.
      // Beside 24 busy loops, with only the six heaviest of those files running, three tests passed the old 5 s limit (contrast 6.2 s, sc12 5.5 s, decisions 5.1 s) and failed; the same
      // run with this limit passed, the worst test taking 7.2 s. 15 s is twice that; it is not raised further because a test that hangs should still fail in seconds.
      testTimeout: 15_000,
    },
  };
});

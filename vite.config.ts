import { defineConfig } from "vitest/config";
import { ENGINE_NODE_FLAGS } from "./engine/tests/support/node_flags.ts";

// S1a scaffold only: no UI yet (S3). The test block is read by Vitest.
// ADR-0016: every test worker runs with the engine's Node flags. The pool stays the default (forks): a forked worker takes execArgv on its command line, a worker thread cannot take
// V8 flags. engine/tests/node_flags.test.ts fails if a worker lacks them.
export default defineConfig({
  test: {
    include: ["engine/tests/**/*.test.ts"],
    environment: "node",
    execArgv: [...ENGINE_NODE_FLAGS],
  },
});

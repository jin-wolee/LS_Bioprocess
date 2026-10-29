import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

// Two-process determinism of the experiment runners (S2c3 open item, orchestrator decision 5 of S2d): the same experiment on the same seeds, run in two separate Node
// processes, writes byte-identical report text. Two seeds each, so it runs in seconds; the full seed lists are not needed to show that nothing in a run depends on the process
// (a wall clock, an address, an iteration order of a hash, a module-level state left by an earlier run). The runner is engine/tests/support/determinism_cli.ts.

const cli = join(ROOT, "engine", "tests", "support", "determinism_cli.ts");
const run = (experiment: string): string => execFileSync(process.execPath, [cli, experiment], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

describe.each([["experiment1"], ["experiment2"]])("%s in two processes", (experiment) => {
  it("Given the first two seeds of its seed list When it runs in two separate processes Then the two reports are byte-identical", () => {
    const first = run(experiment);
    const second = run(experiment);
    expect(first.length).toBeGreaterThan(1000);
    expect(second).toBe(first);
    const report = JSON.parse(first) as { seeds?: number[]; n_seeds?: number };
    expect(report.n_seeds ?? report.seeds?.length).toBe(2);
  }, 120_000);
});

import { describe, expect, it } from "vitest";
import { runKeyOf } from "../../../src/ui/run_key.ts";
import { runKey } from "../../src/experiments/assembly/lab/challenges.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";

// P5c (docs/design/plant_ui.md section 7): the page names the run of a challenge by the key the Worker locks it by, so that it can empty what it holds of that run when the challenge starts. The page
// cannot import the engine, so its key is a copy of the engine's; this test is what keeps the two the same.

const base: RunSpec = { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual"], seeds: [1] };
const specs: [string, RunSpec, number][] = [
  ["the plain run", base, 1],
  ["settings in another order", { ...base, settings: { reactor_count: 6, bay_size: 6 } }, 41],
  ["the same settings the other way", { ...base, settings: { bay_size: 6, reactor_count: 6 } }, 41],
  ["lists and a capture path", { ...base, bay_profiles: ["pilot"], analyzer_profiles: ["hplc"], capture_path: "adapter_ingest" }, 7],
  ["another architecture list", { ...base, architectures: ["c_context", "b_lims_lite"], seeds: [9] }, 1],
];

describe("the key of a run: the page's copy is the engine's", () => {
  it.each(specs)("Given %s Then both keys are the same string", (_n, spec, seed) => {
    expect(runKeyOf(spec, seed)).toBe(runKey(spec, seed));
  });

  it("Given two runs that differ in the architectures only Then they are one run (a challenge holds the truth, not the records), and given another seed Then they are two", () => {
    const other: RunSpec = { ...base, architectures: ["c_context"] };
    expect(runKeyOf(base, 1)).toBe(runKeyOf(other, 1));
    expect(runKeyOf(base, 1)).not.toBe(runKeyOf(base, 2));
  });
});

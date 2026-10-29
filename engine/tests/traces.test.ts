import { describe, expect, it } from "vitest";
import { runL3 } from "../src/analysis.ts";
import type { L3Input } from "../src/analysis.ts";
import type { TraceResult } from "../src/generated/trace_result.schema";
import { ENGINE_VERSION, exportTrace, toTraceResult } from "../src/trace.ts";
import { listFiles, readJson } from "./support/paths.ts";
import { isValid, makeAjv } from "./support/schemas.ts";
import type { Json } from "./support/schemas.ts";
import { makeWorkload } from "./support/workload.ts";

// Step 8: trace export. Hand traces carry the hand-typed expectation (source "hand"); the 20 parity traces carry the
// TS core's own output (source "ts-engine-golden"): parity only, not truth.

interface HandCase {
  case: string;
  inputs: L3Input;
  expected: { runs: unknown[] };
}
const ajv = makeAjv();

describe("Trace export: hand fixtures F1-F7 and their variants", () => {
  const cases = listFiles("tests", "fixtures", "hand")
    .filter((f) => /^F\d.*\.json$/.test(f))
    .flatMap((f) => readJson<{ cases: HandCase[] }>("tests", "fixtures", "hand", f).cases);

  it("there is one trace per fixture case", () => {
    expect(listFiles("tests", "fixtures", "traces").filter((f) => f.endsWith(".json"))).toEqual(cases.map((c) => `${c.case}.json`).sort());
  });

  for (const c of cases) {
    describe(c.case, () => {
      const onDisk = (): Json => readJson("tests", "fixtures", "traces", `${c.case}.json`);

      it("the file is the export of the fixture inputs with the hand-typed expected_result (source hand)", () => {
        const expected = { schema_version: "1" as const, engine_version: c.inputs.engine_version, seed: c.inputs.seed, runs: c.expected.runs as TraceResult["runs"] };
        expect(onDisk()).toEqual(exportTrace(c.inputs, expected, "hand"));
      });

      it("it validates against trace.schema.json and carries no engine-only fields", () => {
        const t = onDisk();
        expect(isValid(ajv, "trace", t), JSON.stringify(ajv.errors)).toBe(true);
        expect(JSON.stringify(t)).not.toMatch(/sampled_s|noise_sd|true_value|dilution_factor|"analyte"|"kind"/);
      });

      it("running the engine on the exported trace alone reproduces the hand expectation", () => {
        const t = onDisk() as unknown as L3Input & { expected_result: { runs: unknown[] } };
        expect(toTraceResult(t, runL3(t).runs).runs).toEqual(t.expected_result.runs);
      });
    });
  }
});

describe("Trace export: the 20 golden parity traces (workload seeds 1..20)", () => {
  const files = listFiles("tests", "golden", "parity").filter((f) => f.endsWith(".json"));

  it("there are 20 traces named parity_01 .. parity_20", () => {
    expect(files).toEqual(Array.from({ length: 20 }, (_, i) => `parity_${String(i + 1).padStart(2, "0")}.json`));
  });

  files.forEach((f, i) => {
    const seed = i + 1;
    describe(f, () => {
      const t = (): Json => readJson("tests", "golden", "parity", f);

      it("validates against trace.schema.json with source ts-engine-golden and the workload seed", () => {
        expect(isValid(ajv, "trace", t()), JSON.stringify(ajv.errors)).toBe(true);
        expect(t().source).toBe("ts-engine-golden");
        expect(t().seed).toBe(seed);
        expect(t().engine_version).toBe(ENGINE_VERSION);
      });

      it("equals the current export of workload seed N and its expected_result is the core's output", () => {
        const input = makeWorkload(seed);
        const result = toTraceResult(input, runL3(input).runs);
        expect(t()).toEqual(exportTrace(input, result, "ts-engine-golden"));
      });

      it("running the engine on the trace alone reproduces expected_result exactly", () => {
        const trace = t() as unknown as L3Input & { expected_result: unknown };
        expect(toTraceResult(trace, runL3(trace).runs)).toEqual(trace.expected_result);
      });
    });
  });
});

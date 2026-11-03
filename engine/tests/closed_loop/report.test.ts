import { describe, expect, it } from "vitest";
import { buildClosedLoopReport, resultText } from "../../src/experiments/assembly/closed_loop_report.ts";
import type { ClosedLoopHead } from "../../src/experiments/assembly/closed_loop_report.ts";
import type { ClosedLoopResult } from "../../src/experiments/assembly/closed_loop.ts";
import type { ArmOutcome } from "../../src/experiments/assembly/closed_loop_arm.ts";
import { makeEvalAjv, validates } from "../support/eval_schemas.ts";

// The report of experiment 2 (spec 6.2 and 8): per arm the median and spread across seeds of the per-seed mean over reactors, and for every arm but the oracle the paired
// difference against the oracle with a bootstrap interval across seeds. Hand-built result, test-only numbers: four seeds, two reactors each, the oracle at (0.01, 0.02, 0.03),
// arm A at (0.02, 0.02, 0.05) in every reactor, so the paired differences are 0.01, 0 and 0.02 with no spread.

const reactor = (a: number, b: number, c: number) => ({ offset_mean_abs: a, excursion_mean_abs: b, excursion_max_abs: c });
const counts = (readjusted: number, skipped: number, none: number, values = 0, extrapolated = 0) => ({ slots: readjusted + skipped + none, readjusted, skipped_known_bias: skipped, no_new_result: none, values, extrapolated });
const arms = (): ArmOutcome[] => [
  { id: "oracle", kind: "oracle", reactors: [reactor(0.01, 0.02, 0.03), reactor(0.01, 0.02, 0.03)], counts: counts(3, 0, 1) },
  { id: "a_manual", kind: "architecture", reactors: [reactor(0.02, 0.02, 0.05), reactor(0.02, 0.02, 0.05)], counts: counts(3, 0, 1, 5, 1) },
  { id: "c_context", kind: "architecture", reactors: [reactor(0.02, 0.02, 0.05), reactor(0.02, 0.02, 0.05)], counts: counts(2, 1, 1, 5, 2) },
];
const RESULT: ClosedLoopResult = { scenario_id: "t", engine_version: "0.1.0", seeds: [11, 12, 13, 14], outcomes: [11, 12, 13, 14].map((seed) => ({ seed, arms: arms() })) };
const HEAD: ClosedLoopHead = { experiment_id: "x2", min_seeds: 4, bootstrap: { seed: 9011, resamples: 300 }, assumptions: ["A108", "A041", "A051", "A094", "A095", "A064", "A046"] };

describe("SC8 report: the result text is the template of spec 6.2", () => {
  it("Given the five named assumptions and two others Then the text names the five, then the others used in order, and says it is not a prediction", () => {
    expect(resultText(HEAD.assumptions)).toBe("model-internal effect under assumptions A041, A051, A094, A095, A108 (and the others used: A046, A064), not a prediction");
  });

  it("Given no others Then the parenthesis is left out", () => {
    expect(resultText(["A041", "A051", "A094", "A095", "A108"])).toBe("model-internal effect under assumptions A041, A051, A094, A095, A108, not a prediction");
  });
});

describe("SC8 report: the numbers", () => {
  const report = buildClosedLoopReport(RESULT, HEAD);
  const armRow = (id: string) => report.arms.find((a) => a.id === id) as (typeof report.arms)[number];
  const metric = (id: string, name: string) => armRow(id).metrics.find((m) => m.metric === name) as (typeof report.arms)[number]["metrics"][number];

  it("Given four seeds of two reactors Then the report carries the seed count, the reactor pairs and the result text", () => {
    expect(report.n_seeds).toBe(4);
    expect(report.seeds).toEqual([11, 12, 13, 14]);
    expect(report.n_reactor_pairs).toBe(8);
    expect(report.meets_min_seeds).toBe(true);
    expect(report.result_text).toBe(resultText(HEAD.assumptions));
  });

  it("Then the arms are listed in the order of the result and the oracle has no paired difference", () => {
    expect(report.arms.map((a) => a.id)).toEqual(["oracle", "a_manual", "c_context"]);
    for (const m of armRow("oracle").metrics) expect(m.paired).toBeNull();
  });

  it("Then the paired difference of arm A is +0.01 (offset), exactly 0 (excursion) and +0.02 (largest excursion), with intervals that do not widen over constant differences", () => {
    const o = metric("a_manual", "offset_mean_abs").paired;
    expect(o?.mean).toBeCloseTo(0.01, 12);
    expect(o?.lo).toBeCloseTo(0.01, 12);
    expect(o?.hi).toBeCloseTo(0.01, 12);
    expect(metric("a_manual", "excursion_mean_abs").paired).toEqual({ mean: 0, lo: 0, hi: 0 });
    expect(metric("a_manual", "excursion_max_abs").paired?.mean).toBeCloseTo(0.02, 12);
  });

  it("Then the median and the spread across seeds are over the per-seed means: 0.02 for arm A's offset, 0.01 for the oracle's", () => {
    expect(metric("a_manual", "offset_mean_abs")).toMatchObject({ median: 0.02, p05: 0.02, p95: 0.02, unit: "pH", per_seed: [0.02, 0.02, 0.02, 0.02] });
    expect(metric("oracle", "offset_mean_abs")).toMatchObject({ median: 0.01, p05: 0.01, p95: 0.01 });
  });

  it("Then the slots are summed over seeds and reactors with nothing dropped: C readjusted 8, skipped 4, no new value 4 over four seeds; 20 values held, 8 of them extrapolated", () => {
    expect(armRow("c_context").counts).toEqual({ slots: 16, readjusted: 8, skipped_known_bias: 4, no_new_result: 4, values: 20, extrapolated: 8 });
  });

  it("Then the report states its bootstrap, the interval wording and the simulator choices", () => {
    expect(report.bootstrap).toEqual({ seed: 9011, resamples: 300, level: 0.95, unit: "seeds" });
    expect(report.interval).toMatch(/not a confidence interval/);
    expect(report.notes.join(" ")).toMatch(/grade A/);
  });

  it("Then it validates against data/schemas/closed_loop_report.schema.json", () => {
    const ajv = makeEvalAjv();
    expect(validates(ajv, "closed_loop_report", report), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("Given a document with a gated field or an extra key Then the schema refuses it", () => {
    const ajv = makeEvalAjv();
    expect(validates(ajv, "closed_loop_report", { ...report, verdict: "pass" })).toBe(false);
  });
});

describe("SC8 report: the seed minimum and the pairing", () => {
  it("Given fewer seeds than the minimum (A103) Then the report is refused", () => {
    expect(() => buildClosedLoopReport({ ...RESULT, seeds: [11, 12], outcomes: RESULT.outcomes.slice(0, 2) }, { ...HEAD, min_seeds: 20 })).toThrow(/at least 20 seeds/);
  });

  it("Given an arm with other reactors than the oracle Then the pairing is refused", () => {
    const odd = structuredClone(RESULT);
    (odd.outcomes[0]?.arms[1] as ArmOutcome).reactors.pop();
    expect(() => buildClosedLoopReport(odd, HEAD)).toThrow(/same reactors/);
  });

  it("Given the same result twice Then the report is identical (the bootstrap is keyed)", () => {
    expect(buildClosedLoopReport(RESULT, HEAD)).toEqual(buildClosedLoopReport(RESULT, HEAD));
  });
});

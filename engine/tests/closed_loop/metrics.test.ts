import { describe, expect, it } from "vitest";
import { bootstrapMean, pairedMean, reactorMetrics } from "../../src/evaluate/closed_loop.ts";
import type { ReactorMetrics } from "../../src/evaluate/closed_loop.ts";
import { oracleReference } from "../../src/experiments/oracle/closed_loop.ts";
import { createRng } from "../../src/rng.ts";
import type { PhSeries } from "../../src/sensors.ts";

// SC8 outputs (spec 8, "Experiment 2"): probe offset and control excursion (true pH minus the set point) per reactor over the run, and the paired difference against the
// oracle with a bootstrap interval across seeds. Expected values are hand arithmetic on the series below; nothing here asserts a sign, a size or an order of the arms.

const SERIES: PhSeries = {
  t0_s: 0, cadence_s: 60, n: 6,
  truth: Float64Array.from([7, 7, 7, 6.976, 6.976, 6.952]),
  offset: Float64Array.from([0, 0.012, 0.024, 0.036, 0.048, 0.06]),
  pv: Float64Array.from([7, 7.012, 7.024, 7.012, 7.024, 7.012]),
};

describe("SC8 outputs: probe offset and control excursion of one reactor", () => {
  const m = reactorMetrics(SERIES, 7);

  it("Given the series Then the mean absolute probe offset is (0 + .012 + .024 + .036 + .048 + .06) / 6 = 0.03", () => {
    expect(m.offset_mean_abs).toBeCloseTo(0.03, 12);
  });

  it("Then the mean absolute excursion is (0 + 0 + 0 + .024 + .024 + .048) / 6 = 0.016 and the largest is 0.048", () => {
    expect(m.excursion_mean_abs).toBeCloseTo(0.016, 12);
    expect(m.excursion_max_abs).toBeCloseTo(0.048, 12);
  });

  it("Given an upward excursion Then it counts by its size, not its sign: truth 7.1 and 6.9 against a set point of 7 give a mean of 0.1", () => {
    const up: PhSeries = { ...SERIES, n: 2, truth: Float64Array.from([7.1, 6.9]), offset: Float64Array.from([-0.1, 0.1]), pv: Float64Array.from([7, 7]) };
    const u = reactorMetrics(up, 7);
    expect(u.excursion_mean_abs).toBeCloseTo(0.1, 12);
    expect(u.offset_mean_abs).toBeCloseTo(0.1, 12);
  });
});

describe("SC8 outputs: the paired difference against the oracle", () => {
  const mk = (a: number, b: number, c: number): ReactorMetrics => ({ offset_mean_abs: a, excursion_mean_abs: b, excursion_max_abs: c });

  it("Given arm and oracle metrics per reactor Then the paired value is the mean of the differences arm - oracle: (0.5 - 0.25 + 0.75 - 0.25) / 2 = 0.375", () => {
    const arm = [mk(0.5, 0, 0), mk(0.75, 0, 0)];
    const oracle = [mk(0.25, 0, 0), mk(0.25, 0, 0)];
    expect(pairedMean(arm, oracle, "offset_mean_abs")).toBe(0.375);
  });

  it("Given identical metrics Then the paired difference is exactly 0, for every metric", () => {
    const x = [mk(0.0123, 0.0456, 0.0789), mk(0.001, 0.002, 0.003)];
    for (const k of ["offset_mean_abs", "excursion_mean_abs", "excursion_max_abs"] as const) expect(pairedMean(x, x, k)).toBe(0);
  });

  it("Given reactor lists of different length Then the pairing is refused", () => {
    expect(() => pairedMean([mk(1, 1, 1)], [mk(1, 1, 1), mk(1, 1, 1)], "offset_mean_abs")).toThrow(/same reactors/);
  });
});

describe("SC8 outputs: the bootstrap interval of a mean across seeds (A103)", () => {
  const stream = (id: string) => createRng().stream([4001, id, "offset_mean_abs", 0, "bootstrap"]);

  it("Given constant differences Then the mean and both ends of the interval are that constant", () => {
    expect(bootstrapMean([0.5, 0.5, 0.5, 0.5], 200, stream("a"), 0.95)).toEqual({ mean: 0.5, lo: 0.5, hi: 0.5 });
  });

  it("Given all-zero differences Then the interval is exactly [0, 0]", () => {
    expect(bootstrapMean(new Array<number>(20).fill(0), 200, stream("a"), 0.95)).toEqual({ mean: 0, lo: 0, hi: 0 });
  });

  it("Given two values 0 and 2 Then every resample mean is 0, 1 or 2 and with 1000 resamples the 95 percent interval is [0, 2] (P(0) = P(2) = 1/4)", () => {
    const b = bootstrapMean([0, 2], 1000, stream("a"), 0.95);
    expect(b).toEqual({ mean: 1, lo: 0, hi: 2 });
  });

  it("Given the same stream key twice Then the interval is identical (determinism); the end points lie on resample means", () => {
    const xs = [0.1, 0.4, 0.2, 0.9, 0.3, 0.5];
    const one = bootstrapMean(xs, 500, stream("a"), 0.95);
    const two = bootstrapMean(xs, 500, stream("a"), 0.95);
    expect(two).toEqual(one);
    expect(one.lo).toBeLessThanOrEqual(one.mean);
    expect(one.hi).toBeGreaterThanOrEqual(one.mean);
  });

  it("Given no values Then there is no interval", () => {
    expect(() => bootstrapMean([], 10, stream("a"), 0.95)).toThrow(/at least one/);
  });
});

describe("SC8 oracle: the reference is the true pH of the newest sample whose result exists", () => {
  const values = [
    { sample_id: "S1", result_t: 1500, true_ph: 7.0 },
    { sample_id: "S2", result_t: 4600, true_ph: 6.98 },
    { sample_id: "S3", result_t: 3900, true_ph: 7.02 },
  ];

  it("Given three samples When the oracle decides at 4000 Then it uses S3 (result at 3900), the newest that exists, whatever the order of the list", () => {
    expect(oracleReference(values, 4000, -1)).toEqual({ onto: 7.02, sample_id: "S3", result_t: 3900 });
  });

  it("Given a value already used (since = 3900) Then nothing new exists at 4000; at 4600 it is S2", () => {
    expect(oracleReference(values, 4000, 3900)).toBeNull();
    expect(oracleReference(values, 4600, 3900)).toEqual({ onto: 6.98, sample_id: "S2", result_t: 4600 });
  });

  it("Given a time before every result Then there is nothing", () => {
    expect(oracleReference(values, 1000, -1)).toBeNull();
  });
});

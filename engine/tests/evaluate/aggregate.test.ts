import { describe, expect, it } from "vitest";
import { aggregate, flatten } from "../../src/evaluate/aggregate.ts";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import type { Metrics } from "../../src/generated/metrics.schema";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { readJson } from "../support/paths.ts";
import { ledgerIds, refsOf } from "../support/schemas.ts";
import { seedInput } from "../support/eval_fixture.ts";

// S2b Step 3: the seed-aggregate table (median and spread across seeds, with the seed count) and the evaluation settings as data.
// Cells below are the hand-world cell of architecture C with the seed and one share replaced by hand-typed values.

const base = runSeed(seedInput()).cells[1] as Metrics;
const cell = (seed: number, exact: number, den = 20): Metrics => {
  const c = structuredClone(base);
  c.seed = seed;
  c.metrics.exact_reconstruction = { num: exact, den, denominator: "all analysis requests", value: den === 0 ? null : exact / den };
  return c;
};
const twenty = Array.from({ length: 20 }, (_, i) => cell(i + 1, i + 1));

describe("The seed-aggregate table", () => {
  // The shares are 1/20 ... 20/20 over seeds 1 to 20. Nearest rank: median = the 10th = 0.5, p05 = the 1st = 0.05, p95 = the 19th = 0.95.
  const table = aggregate(twenty, 20);
  const row = (metric: string) => table.rows.find((r) => r.metric === metric);

  it("Given 20 seeds Then the table carries the seed count, the seeds and the minimum, and the median and spread of a share", () => {
    expect(table).toMatchObject({ scenario_id: "hand", architecture: "C", n_seeds: 20, min_seeds: 20, meets_min_seeds: true });
    expect(table.seeds).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(row("exact_reconstruction")).toEqual({ metric: "exact_reconstruction", n_seeds: 20, n_defined: 20, median: 0.5, lo: 0.05, hi: 0.95 });
  });
  it("Given the spread Then the table says what it is: a spread across seeds, not a confidence interval", () => {
    expect(table.interval).toMatch(/spread across seeds/);
    expect(table.interval).toMatch(/not a confidence interval/);
  });
  it("Given 19 seeds Then the table says it does not reach the minimum of A103", () => {
    expect(aggregate(twenty.slice(0, 19), 20)).toMatchObject({ n_seeds: 19, meets_min_seeds: false });
  });
  it("Given a share with no denominator in 5 of the seeds Then it is undefined there: n_defined is 15 and the five are not read as zeros", () => {
    const some = twenty.map((c, i) => (i < 5 ? cell(c.seed, 0, 0) : c));
    expect(aggregate(some, 20).rows.find((r) => r.metric === "exact_reconstruction")).toMatchObject({ n_seeds: 20, n_defined: 15 });
  });
  it("Given the rows Then counts are not rows (a share contributes its value) and every number of the metrics document is covered", () => {
    expect(table.rows.map((r) => r.metric).filter((m) => /\.(num|den|denominator)$/.test(m))).toEqual([]);
    expect(row("holding_time.median_s")?.median).toBe(400);
    expect(row("detection.by_type.label_error.recall")).toMatchObject({ n_seeds: 20, n_defined: 0 }); // no realised label error in C: undefined in every seed
    expect(table.rows.length).toBe(flatten(base.metrics).length);
  });
  it("Given cells of two architectures Then the table refuses to mix them", () => {
    const other = structuredClone(twenty[0] as Metrics);
    other.architecture = "A";
    expect(() => aggregate([...twenty, other], 20)).toThrow(/one scenario and one architecture/);
    expect(() => aggregate([], 20)).toThrow(/no cells/);
  });
});

describe("Evaluation settings are data with ledger refs", () => {
  const doc = readJson<{ params: unknown }>("data", "scenarios", "evaluation", "default.json");
  it("Then the SLA threshold, staffed window, hold limit and seed minimum are read in seconds and seeds (A097, A098, A046, A103)", () => {
    expect(evaluationSettings(doc)).toEqual({ sla_s: 1800, staffed_window_s: 36000, hold_limit_s: 1800, min_seeds: 20 });
  });
  it("Then every ref is a ledger id", () => {
    const refs = refsOf(doc);
    expect(refs.sort()).toEqual(["A046", "A097", "A098", "A103"]);
    for (const r of refs) expect(ledgerIds().has(r), r).toBe(true);
  });
  it("Then a changed unit fails loudly and a bare number is refused", () => {
    const p = (doc as { params: Record<string, unknown> }).params;
    expect(() => evaluationSettings({ schema_version: "1", params: { ...p, staffed_window_h: { value: 10, unit: "min", ref: "A098" } } })).toThrow(/unit/);
    expect(() => evaluationSettings({ schema_version: "1", params: { ...p, min_seeds: 20 } })).toThrow(/ledger ref/);
  });
});

import { describe, expect, it } from "vitest";
import { runL3 } from "../../src/analysis.ts";
import type { L3Input } from "../../src/analysis.ts";
import { truthFrom } from "../../src/evaluate/truth.ts";
import { buildReport } from "../../src/experiments/assembly/report.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { SeedInput } from "../../src/experiments/assembly/run_seed.ts";
import type { Event } from "../../src/generated/event.schema";
import { observeEvents } from "../../src/observe.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import { ROSTER } from "../support/eval_fixture.ts";
import { arch } from "../support/record_fixture.ts";
import { REVIEW } from "../support/review_setup.ts";

// Audit A1, finding F9 (2026-11-02), built in A2: the hold-time rule (VR-010, the limit of A046 with the rejection of A213) is a proxy applied to every analyte, and the report shows its share
// of the result on its own (spec section 8, "The hold-time rule and its share of the result"): the requests it rejected, and the exact reconstruction and the availability of the same record
// with the limit lifted. Expected values are typed by hand from the hand world below, never read back from the code under test.
//
// The hand world: two units, each inoculated at 0 (U1 with batch B1, U2 with B2); one analyzer AN-1, calibrated at 0 with LOT-1; two samples, both drawn by OP-1 (qualified from 0).
//   S1 on U1: drawn at 0, received at 0, run 0 to 10 s: hold time 0 s. Decision time 1000 s.
//   S2 on U2: drawn at 100, received at 3000 (a long transport), run 3000 to 3010 s: hold time 2900 s. Decision time 86400 s.
// The limit of the rules is 1800 s (RULES of the fixture, test-only), so VR-010 flags the results of S2 only. Truth releases S1 at 10 s and S2 at 3010 s, both before their decision times.
// Architecture C (every flag) stores the hold time, so the rule runs; A (no flag) stores one time only, so the rule cannot run.
// Expected, by hand, for C as it is: S1 passes every rule and is released at once; S2's result is held by VR-010 and rejected at the review (A213), so it is never read: exactly reconstructed 1 of 2,
// available 1 of 2, rejected by the limit 1 of 2. With the limit lifted S2's result is released at its ingest, before its decision time, from a run linked to LOT-1, the lot in force at its start in
// truth: exactly reconstructed 2 of 2, available 2 of 2.

const C = { ...arch(...FLAG_NAMES), id: "C" };
const A = { ...arch(), id: "A" };
const QUALIFICATIONS = [{ qualification_id: "Q1", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: null }];

const world = (transport_s: number, over: { s1_operator?: string; review?: SeedInput["review"] } = {}): SeedInput => {
  const l3: L3Input = {
    schema_version: "1", engine_version: "0.1.0", seed: 1, policy: "fifo",
    analyzers: [{ id: "AN-1", group: "first", initial_method: null }], setup: [], windows: [],
    requests: [
      { request_id: "S1", seq: 1, arrive_s: 0, visits: [{ group: "first", service_s: 10 }] },
      { request_id: "S2", seq: 2, arrive_s: 100 + transport_s, visits: [{ group: "first", service_s: 10 }] },
    ],
    forced_outcomes: [],
  };
  const events: Event[] = [
    { type: "calibration_recorded", t: 0, analyzer: "AN-1", lot_id: "LOT-1", drift_before_pct: 0 },
    { type: "inoculation", t: 0, unit_id: "U1", batch_id: "B1", density_e6_per_ml: 1 },
    { type: "inoculation", t: 0, unit_id: "U2", batch_id: "B2", density_e6_per_ml: 1 },
    { type: "sample_drawn", t: 0, sample_id: "S1", unit_id: "U1", batch_id: "B1", operator_id: over.s1_operator ?? "OP-1", volume_ul: 200, true_state: {} } as unknown as Event,
    { type: "sample_received", t: 0, sample_id: "S1" },
    { type: "sample_drawn", t: 100, sample_id: "S2", unit_id: "U2", batch_id: "B2", operator_id: "OP-1", volume_ul: 200, true_state: {} } as unknown as Event,
    { type: "sample_received", t: 100 + transport_s, sample_id: "S2" },
    ...runL3(l3).events.filter((e) => e.type !== "log_header"),
  ];
  const truth = truthFrom(events, { visits: { S1: 1, S2: 1 }, deadlines: { S1: 1000, S2: 86400 }, operators: [{ operator_id: "OP-1", qualified: true }, { operator_id: "OP-9", qualified: false }], analyzers: ["AN-1"] });
  return {
    scenario_id: "hand", seed: 1, engine_version: "0.1.0", truth, events: observeEvents(events), sensors: [], architectures: [A, C], forced: [], qualifications: QUALIFICATIONS,
    rules: { hold_limit_s: 1800 }, review: over.review ?? REVIEW, config: { sla_s: 600, roster: ROSTER, days: 1 }, with_hold_limit: true,
  };
};

describe("F9: the hold-time rule's share of the result, typed by hand", () => {
  const out = runSeed(world(2900));
  const c = out.cells.find((x) => x.architecture === "C");
  const figure = out.hold_limit.C;

  it("Given C with one of two requests over the limit Then the rule rejected 1 of 2, and with the limit lifted exact reconstruction and availability are 2 of 2", () => {
    expect(c?.metrics.exact_reconstruction).toMatchObject({ num: 1, den: 2 }); // the metrics as they are: S2's result was rejected
    expect(c?.metrics.availability.available).toMatchObject({ num: 1, den: 2 });
    expect(figure?.rejected).toMatchObject({ num: 1, den: 2, value: 0.5 });
    expect(figure?.exact_reconstruction_limit_lifted).toMatchObject({ num: 2, den: 2, value: 1 });
    expect(figure?.availability_limit_lifted).toMatchObject({ num: 2, den: 2, value: 1 });
  });

  it("Given A, whose record stores one time only Then the rule cannot run and the figure is absent (null), not zero", () => {
    expect(out.hold_limit.A).toBeNull();
  });

  it("Given the figure Then the per-cell metrics document does not carry it, so a cell and its hash are as before", () => {
    expect(Object.keys(c?.metrics ?? {})).not.toContain("hold_limit");
  });

  it("Given every denominator Then it is all analysis requests, 2, and the wording says what was counted", () => {
    expect(figure?.rejected.denominator).toMatch(/all analysis requests.*VR-010/);
    expect(figure?.exact_reconstruction_limit_lifted.denominator).toMatch(/limit lifted/);
  });
});

describe("F9: the figure counts what VR-010 rejected, and lifts nothing that another rule rejected", () => {
  // S1 is drawn by OP-9, who has no qualification record, so VR-015 flags S1 (sample:S1) and the sensitivity variant of the review (`reject_also`, A214) rejects S1's result for that rule. S2 is
  // as before, over the limit and rejected for VR-010. By hand, for C as it is: neither result is read, so exact reconstruction 0 of 2 and availability 0 of 2. VR-010 flagged S2 only, so
  // `rejected` is 1 of 2 (a count of every rejected result would say 2 of 2). With the limit lifted S2's result is released at its ingest, as in the first world, and S1's stays rejected
  // for VR-015, which the limit does not touch: 1 of 2 for both lifted figures, not 2 of 2.
  const out = runSeed(world(2900, { s1_operator: "OP-9", review: { ...REVIEW, reject_also: ["VR-015"] } }));
  const c = out.cells.find((x) => x.architecture === "C");
  it("Given one request rejected for another rule and one for VR-010 Then rejected is 1 of 2 and only the VR-010 one is lifted: 1 of 2 and 1 of 2", () => {
    expect(c?.metrics.exact_reconstruction).toMatchObject({ num: 0, den: 2 });
    expect(c?.metrics.availability.available).toMatchObject({ num: 0, den: 2 });
    expect(out.hold_limit.C?.rejected).toMatchObject({ num: 1, den: 2 });
    expect(out.hold_limit.C?.exact_reconstruction_limit_lifted).toMatchObject({ num: 1, den: 2 });
    expect(out.hold_limit.C?.availability_limit_lifted).toMatchObject({ num: 1, den: 2 });
  });
});

describe("F9: no request over the limit", () => {
  // A transport of 500 s gives S2 a hold of 400 s, under the limit: nothing is rejected, and lifting the limit changes nothing: 0 of 2, and the lifted figures equal the metrics (2 of 2 and 2 of 2).
  const out = runSeed(world(500));
  const c = out.cells.find((x) => x.architecture === "C");
  it("Given the rule runs and flags nothing Then rejected is 0 of 2 (not absent) and the lifted figures equal the metrics", () => {
    expect(out.hold_limit.C?.rejected).toMatchObject({ num: 0, den: 2, value: 0 });
    expect(out.hold_limit.C?.exact_reconstruction_limit_lifted).toMatchObject({ num: c?.metrics.exact_reconstruction.num, den: 2 });
    expect(out.hold_limit.C?.availability_limit_lifted).toMatchObject({ num: c?.metrics.availability.available.num, den: 2 });
    expect([c?.metrics.exact_reconstruction.num, c?.metrics.availability.available.num]).toEqual([2, 2]);
  });
});

describe("F9: the report carries the three rows, and a record without the hold time says why it has none", () => {
  const seed = runSeed(world(2900));
  const result = {
    scenario_id: "hand", engine_version: "0.1.0", seeds: [1], review: { timing: "next_shift_start" as const, reject_also: [] },
    outcomes: [{ seed: 1, truth_log_hash: "h", key_text: seed.key_text, cells: seed.cells, hold_limit: seed.hold_limit }],
  };
  const report = buildReport(result, { experiment_id: "hand", min_seeds: 20, ablations_of: "C" });
  const rows = (id: string) => report.architectures.find((b) => b.id === id)?.rows.filter((r) => r.metric.startsWith("hold_limit.")) ?? [];

  it("Given C Then its rows are reported with the median over the one seed, the seed count and the denominator count", () => {
    expect(rows("C").map((r) => [r.metric, r.status, r.median, r.n_defined, r.den?.median])).toEqual([
      ["hold_limit.rejected", "reported", 0.5, 1, 2],
      ["hold_limit.exact_reconstruction_limit_lifted", "reported", 1, 1, 2],
      ["hold_limit.availability_limit_lifted", "reported", 1, 1, 2],
    ]);
  });

  it("Given A Then the three rows read not evaluable, with the reason of the validation and no number", () => {
    const a = rows("A");
    expect(a.map((r) => [r.metric, r.status, r.median, r.denominator])).toEqual([
      ["hold_limit.rejected", "not_evaluable", null, null],
      ["hold_limit.exact_reconstruction_limit_lifted", "not_evaluable", null, null],
      ["hold_limit.availability_limit_lifted", "not_evaluable", null, null],
    ]);
    expect(a.every((r) => r.reason === "sampled_at is not stored (two_clocks off)")).toBe(true);
  });

  it("Given the report Then no existing row of C changed: its metric rows are those of the cells alone", () => {
    const without = report.architectures.find((b) => b.id === "C")?.rows.filter((r) => !r.metric.startsWith("hold_limit.")).find((r) => r.metric === "exact_reconstruction");
    expect(without).toMatchObject({ status: "reported", median: 0.5 });
  });
});

import { describe, expect, it } from "vitest";
import { runL3 } from "../../src/analysis.ts";
import type { L3Input } from "../../src/analysis.ts";
import { parseKey } from "../../src/evaluate/answer_key.ts";
import { availability } from "../../src/evaluate/availability.ts";
import { evaluate } from "../../src/evaluate/evaluate.ts";
import { lookupAll } from "../../src/evaluate/query.ts";
import { exactReconstruction } from "../../src/evaluate/reconstruction.ts";
import { factsOf, truthFrom } from "../../src/evaluate/truth.ts";
import { labSeed } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { keyFile } from "../../src/experiments/assembly/key_file.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { Event } from "../../src/generated/event.schema";
import { observeEvents } from "../../src/observe.ts";
import { FLAG_NAMES, parseArchitecture } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { labData } from "../support/lab_data.ts";
import { arch } from "../support/record_fixture.ts";
import { SMALL } from "../support/scenarios.ts";

// Audit A1, finding F1 (2026-11-02): exact reconstruction and availability read one result row per request, so a request with a missing visit still counted. The author's
// decision: a request counts as exactly reconstructed, and as available, only when every required item of every visit is there, each with its own visit's instrument state
// (spec section 8, "Request-level metrics"); the metric names stay. Expected values are derived by hand in the comments, never read back from the evaluator.

const data = labData();
const architectures = data.architectures.map(parseArchitecture);

describe("F1: a request is reconstructed and available only with every item of every visit", () => {
  // The split profile on both analyzers: every drawn sample visits the cell counter (visit 1: vcd, viability) and then the metabolite analyzer (visit 2: glucose, lactate,
  // glutamine). Removing every result row of a visit-2 run (run id `<request>/<attempt>/2`) leaves no drawn request with all its items, and a refused draw has no result at all,
  // so by the decision no request of the run is exactly reconstructed and none is available before its decision time: 0 of n for both, whatever n is.
  const spec: RunSpec = { schema_version: "1", scenario: "default", settings: SMALL, analyzer_profiles: ["split_cellcounter_metabolite", "split_cellcounter_metabolite"], architectures: ["c_context"], seeds: [1] };
  const seed = labSeed(data, spec, 1, architectures.filter((a) => a.id === "c_context"));
  const out = runSeed(seed.input);
  const full = out.datasets.c_context;

  it("Given C of the split profile with every visit-2 result removed When it is evaluated Then 0 requests are exactly reconstructed and 0 are available", () => {
    if (!full) throw new Error("no c_context dataset");
    const cut = { ...full, result: full.result.filter((r) => !r.run_id.endsWith("/2")) };
    expect(cut.result.length).toBeLessThan(full.result.length);
    const m = evaluate({ truth: seed.input.truth, dataset: cut, not_evaluable: [], key_text: out.key_text, architecture: "c_context", config: seed.input.config });
    expect(m.metrics.exact_reconstruction).toMatchObject({ num: 0, den: m.n_requests });
    expect(m.metrics.availability.available).toMatchObject({ num: 0, den: m.n_requests });
  });
});

// A hand world of one sample S1 on U1 (batch B1, inoculated at 0, no process event), drawn at 0 by OP-1 and received at 0: visit 1 on AN-1 (group and item `first`), 10 s, then
// visit 2 on AN-2 (group and item `second`), 10 s; no noise, so every reported value is 0. AN-1 is calibrated at 0 with LOT-1 and AN-2 with LOT-7. Its decision time is 1000 s.
// Architecture C (every flag) stores sampled_at, the keys, the instrument links and available_at.
const C = { ...arch(...FLAG_NAMES), id: "C" };
const KEY = parseKey(keyFile({ engine_version: "0.1.0", scenario_id: "hand", seed: 1 }, { C: { materialised: [], not_modelled: [] } }), "C");

const handWorld = (forced: L3Input["forced_outcomes"] = []) => {
  const l3: L3Input = {
    schema_version: "1", engine_version: "0.1.0", seed: 1, policy: "fifo",
    analyzers: [{ id: "AN-1", group: "first", initial_method: null }, { id: "AN-2", group: "second", initial_method: null }],
    setup: [], windows: [],
    requests: [{ request_id: "S1", seq: 1, arrive_s: 0, visits: [{ group: "first", service_s: 10 }, { group: "second", service_s: 10 }] }],
    forced_outcomes: forced,
  };
  const events: Event[] = [
    { type: "calibration_recorded", t: 0, analyzer: "AN-1", lot_id: "LOT-1", drift_before_pct: 0 },
    { type: "calibration_recorded", t: 0, analyzer: "AN-2", lot_id: "LOT-7", drift_before_pct: 0 },
    { type: "inoculation", t: 0, unit_id: "U1", batch_id: "B1", density_e6_per_ml: 1 },
    { type: "sample_drawn", t: 0, sample_id: "S1", unit_id: "U1", batch_id: "B1", operator_id: "OP-1", volume_ul: 200, true_state: {} } as unknown as Event,
    { type: "sample_received", t: 0, sample_id: "S1" },
    ...runL3(l3).events.filter((e) => e.type !== "log_header"),
  ];
  const truth = truthFrom(events, { visits: { S1: 2 }, deadlines: { S1: 1000 }, operators: [], analyzers: ["AN-1", "AN-2"] });
  return { truth, dataset: record({ events: observeEvents(events), sensors: [] }, C) };
};
const metricsOf = (truth: ReturnType<typeof handWorld>["truth"], ds: RecordedDataset) => {
  const facts = factsOf(truth);
  return { exact: exactReconstruction(truth, facts, lookupAll(truth, ds, KEY)), available: availability(truth, facts, ds, KEY) };
};

describe("F1, typed by hand: one request of two visits", () => {
  // Both visits pass at attempt 1; C holds `first` from run S1/1/1 linked to AN-1's LOT-1 and `second` from run S1/1/2 linked to AN-2's LOT-7, both available at their run ends
  // (10 s and 20 s), and the truth released S1 at 20 s, before its decision time (1000 s). Every item of every visit is there with its own visit's lot: 1 of 1 for both.
  it("Given C with both visits complete When it is evaluated Then the request is exactly reconstructed and available: 1 of 1 and 1 of 1", () => {
    const { truth, dataset } = handWorld();
    expect(dataset.result.map((r) => [r.analyte, r.run_id])).toEqual([["first", "S1/1/1"], ["second", "S1/1/2"]]);
    const m = metricsOf(truth, dataset);
    expect(m.exact).toMatchObject({ num: 1, den: 1 });
    expect(m.available.available).toMatchObject({ num: 1, den: 1 });
    expect(m.available.leaked).toMatchObject({ num: 0, den: 1 });
  });

  // Without the row of visit 2 the request lacks its item `second`: 0 of 1 for both, and nothing leaks (the read does not show every item).
  it("Given C without the result of visit 2 When it is evaluated Then 0 of 1 for both", () => {
    const { truth, dataset } = handWorld();
    const m = metricsOf(truth, { ...dataset, result: dataset.result.filter((r) => r.analyte !== "second") });
    expect([m.exact.num, m.available.available.num, m.available.leaked.num]).toEqual([0, 0, 0]);
  });

  // The row of `second` linked to AN-1's state (LOT-1), while its run on AN-2 had LOT-7 in truth: not its own visit's instrument state, so the request is not exactly reconstructed;
  // it is still available (the lot is not part of availability): 0 of 1 and 1 of 1.
  it("Given C with the run of visit 2 linked to the state of AN-1 When it is evaluated Then exact reconstruction is 0 of 1 and availability stays 1 of 1", () => {
    const { truth, dataset } = handWorld();
    const wrong = dataset.run.map((r) => (r.run_id === "S1/1/2" ? { ...r, instrument_state_id: dataset.run.find((x) => x.run_id === "S1/1/1")?.instrument_state_id ?? null } : r));
    const m = metricsOf(truth, { ...dataset, run: wrong });
    expect([m.exact.num, m.available.available.num]).toEqual([0, 1]);
  });
});

describe("F3 in the evaluator: a result with no value", () => {
  // Visit 1 ends over_range_unresolved at attempt 1 (forced): no rerun, visit 2 follows and passes. C writes `first` with no value and `second` with its value. The truth never
  // released S1 (visit 1 has no passed run), and the read shows no value of `first`: availability 0 of 1, and nothing leaks. The rows, their runs and their lots are all there and
  // right, so the request is exactly reconstructed: 1 of 1.
  it("Given visit 1 over range at the last dilution When C is evaluated Then the item has no value, availability is 0 of 1 with nothing leaked, and exact reconstruction is 1 of 1", () => {
    const { truth, dataset } = handWorld([{ request_id: "S1", attempt: 1, visit: 1, outcome: "over_range_unresolved" }]);
    expect(dataset.result.map((r) => [r.analyte, r.value])).toEqual([["first", null], ["second", 0]]);
    expect(dataset.run.map((r) => r.qc_outcome)).toEqual(["over_range_unresolved", "qc_passed"]);
    expect(truth.events.filter((e) => e.type === "rerun_requested")).toEqual([]);
    const m = metricsOf(truth, dataset);
    expect([m.available.available.num, m.available.leaked.num, m.exact.num]).toEqual([0, 0, 1]);
  });
});

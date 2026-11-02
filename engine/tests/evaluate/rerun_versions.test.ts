import { describe, expect, it } from "vitest";
import { runL3 } from "../../src/analysis.ts";
import type { L3Input } from "../../src/analysis.ts";
import { parseKey } from "../../src/evaluate/answer_key.ts";
import { rerunTraceability } from "../../src/evaluate/effects.ts";
import { factsOf, truthFrom } from "../../src/evaluate/truth.ts";
import { keyFile } from "../../src/experiments/assembly/key_file.ts";
import type { Event } from "../../src/generated/event.schema";
import { observeEvents } from "../../src/observe.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import { arch } from "../support/record_fixture.ts";

// Audit A1, finding F2 (2026-11-02): rerun traceability asked every item of a request for as many versions as the request's highest attempt, while the engine numbers its
// attempts per visit (analysis.ts: a later visit starts at attempt 1). The author's decision, from the same reading as F1: the version history a rerun leaves is expected per
// visit and per item, as the engine numbers its attempts (spec section 8). Expected values are derived by hand in the comments.

const C = { ...arch(...FLAG_NAMES), id: "C" };
const KEY = parseKey(keyFile({ engine_version: "0.1.0", scenario_id: "hand", seed: 1 }, { C: { materialised: [], not_modelled: [] } }), "C");

/**
 * One sample S1 on two analyzers of 10 s each: AN-1 (group `first`, item `first`) then AN-2 (group `second`, item `second`), no noise, so every reported value is 0.
 * `failed` forces a QC failure on attempt 1 of the named visits; that visit is then run again as attempt 2.
 */
const world = (failed: number[]) => {
  const l3: L3Input = {
    schema_version: "1", engine_version: "0.1.0", seed: 1, policy: "fifo",
    analyzers: [{ id: "AN-1", group: "first", initial_method: null }, { id: "AN-2", group: "second", initial_method: null }],
    setup: [], windows: [],
    requests: [{ request_id: "S1", seq: 1, arrive_s: 0, visits: [{ group: "first", service_s: 10 }, { group: "second", service_s: 10 }] }],
    forced_outcomes: failed.map((visit) => ({ request_id: "S1", attempt: 1, visit, outcome: "qc_failed" as const })),
  };
  const events: Event[] = [
    { type: "inoculation", t: 0, unit_id: "U1", batch_id: "B1", density_e6_per_ml: 1 },
    { type: "sample_drawn", t: 0, sample_id: "S1", unit_id: "U1", batch_id: "B1", operator_id: "OP-1", volume_ul: 200, true_state: {} } as unknown as Event,
    ...runL3(l3).events,
  ];
  const truth = truthFrom(events, { visits: { S1: 2 }, deadlines: { S1: 1000 }, operators: [], analyzers: ["AN-1", "AN-2"] });
  return { truth, dataset: record({ events: observeEvents(events), sensors: [] }, C) };
};

describe("F2: the versions a rerun leaves are expected per visit and per item", () => {
  // Visit 1 passes at attempt 1; visit 2 fails at attempt 1 and passes at attempt 2. C keeps every version: `first` has version 1 (attempt 1 of visit 1), `second` has
  // version 1 and version 2, and version 2 supersedes version 1. Per visit and per item that is the whole history: `first` needs version 1 only, `second` versions 1 and 2.
  // One request had a rerun, and it is traceable: 1 of 1.
  it("Given C and a rerun of the second visit only When rerun traceability is evaluated Then the request is traceable: 1 of 1", () => {
    const { truth, dataset } = world([2]);
    expect(dataset.result.map((r) => [r.analyte, r.version, r.supersedes !== null])).toEqual([["first", 1, false], ["second", 1, false], ["second", 2, true]]);
    expect(rerunTraceability(truth, factsOf(truth), dataset, KEY)).toMatchObject({ num: 1, den: 1 });
  });

  // The mirror case: visit 1 fails at attempt 1 and passes at attempt 2, visit 2 passes at attempt 1. `first` needs versions 1 and 2 (version 2 superseding version 1) and
  // `second` version 1 only; C has exactly that: 1 of 1.
  it("Given C and a rerun of the first visit only Then the request is traceable: 1 of 1", () => {
    const { truth, dataset } = world([1]);
    expect(dataset.result.map((r) => [r.analyte, r.version])).toEqual([["first", 1], ["first", 2], ["second", 1]]);
    expect(rerunTraceability(truth, factsOf(truth), dataset, KEY)).toMatchObject({ num: 1, den: 1 });
  });

  // Version 2 of `second` removed: the rerun of visit 2 left no recoverable link, so the request is not traceable: 0 of 1.
  it("Given C without version 2 of the rerun item Then the request is not traceable: 0 of 1", () => {
    const { truth, dataset } = world([2]);
    const cut = { ...dataset, result: dataset.result.filter((r) => !(r.analyte === "second" && r.version === 2)) };
    expect(rerunTraceability(truth, factsOf(truth), cut, KEY)).toMatchObject({ num: 0, den: 1 });
  });
});

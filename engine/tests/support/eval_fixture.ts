import type { EvalConfig } from "../../src/evaluate/config.ts";
import { truthFrom } from "../../src/evaluate/truth.ts";
import type { Truth } from "../../src/evaluate/truth.ts";
import type { SeedInput } from "../../src/experiments/assembly/run_seed.ts";
import type { Event } from "../../src/generated/event.schema";
import type { ObservableEvent } from "../../src/observe.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import type { RuleConfig } from "../../src/record/validate.ts";
import { NO_FLAGS, SENSORS, WITH_SKIP, arch } from "./record_fixture.ts";

// The hand-built world of the evaluator tests (S2b). Test-only values. It is the observable stream of record_fixture.ts (WITH_SKIP) with the
// hidden truth fields added; every expected number in the tests is derived by hand from it. Times are integer seconds.
//   S1 on U1 (B-U1): drawn 1100 by OP-1, run 1500-2000 on AN-1, glucose 5.1, released 2000. Feed on U1 at 1200 falls between draw and measurement.
//   S2 on U1: drawn 5000 by OP-2, run 6000-6500 (QC failed, 3.2), rerun 8500-9000 (QC passed, 3.4), released 9000.
//   S3 on U2 (B-U2): drawn 9100 by OP-1, run 9500-10000, glucose 7.0, released 10000. U2 has a temperature shift at 9050.
//   S4 on U2: planned 11000, the draw refused by the volume budget at 11100.
// Decision times (A050 stand-ins): S1 1800 (before its measurement), S2 7000 (between the two runs), S3 36000. OP-1 is qualified, OP-2 is not.
// AN-1 is calibrated at 0 (LOT-1) and at 7200 (LOT-2).

/** The truth log of a stream: the same events with the hidden fields a recorder never sees (no noise, so the true value is the reported one). */
export const truthEvents = (events: readonly ObservableEvent[]): Event[] =>
  events.map((e): Event => {
    switch (e.type) {
      case "result_measured": return { ...e, true_value: e.value, noise: 0 };
      case "sample_drawn": return { ...e, true_state: {} } as unknown as Event;
      case "calibration_recorded": return { ...e, drift_before_pct: 0 };
      default: return e as Event;
    }
  });

export const WORLD_EVENTS: readonly ObservableEvent[] = WITH_SKIP;

export const WORLD: Truth = truthFrom(truthEvents(WORLD_EVENTS), {
  visits: { S1: 1, S2: 1, S3: 1 },
  deadlines: { S1: 1800, S2: 7000, S3: 36000 },
  operators: [{ operator_id: "OP-1", qualified: true }, { operator_id: "OP-2", qualified: false }],
  analyzers: ["AN-1"],
});

export const A: Architecture = { ...arch(), id: "A" };
export const B: Architecture = { ...arch("system_issued_id", "ingest_idempotency", "audit_trail"), id: "B", labelling: "preprinted_barcode" };
export const C: Architecture = { ...arch(...FLAG_NAMES), id: "C", labelling: "issued_at_draw" };

export const CONFIG: EvalConfig = { sla_s: 600, staffed_window_s: 36000, days: 1 };
/** Limits of the validation rules; test-only values. */
export const RULES: RuleConfig = { hold_limit_s: 1800, late_tolerance_s: 600, clock_tolerance_s: 900 };

export const QUALIFICATIONS = [
  { qualification_id: "Q1", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: null },
  { qualification_id: "Q2", operator_id: "OP-2", qualified: false, valid_from: 0, valid_to: null },
];

/** The input of `runSeed` for the hand world; a test overrides what it needs. */
export const seedInput = (over: Partial<SeedInput> = {}): SeedInput => ({
  scenario_id: "hand", seed: 7, engine_version: "0.1.0", truth: WORLD, events: WORLD_EVENTS, sensors: SENSORS, architectures: [A, C],
  forced: [], qualifications: QUALIFICATIONS, rules: RULES, config: CONFIG, ...over,
});

/** A recorded dataset with every table empty, for fixtures typed row by row. */
export const emptyDataset = (flags: Partial<Record<keyof typeof NO_FLAGS, boolean>> = {}): RecordedDataset => ({
  architecture: { id: "hand", flags: { ...NO_FLAGS, ...flags }, labelling: "handwritten" },
  sample: [], analysis_request: [], run: [], instrument_state: [], result: [], audit_event: [], qualification: [], source_event: [], validation_finding: [], ingest_conflict: [],
  batch: [], process_event: [], historian: { series: [], late: [] },
});

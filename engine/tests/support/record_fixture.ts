import type { ObservableEvent, ObservableSensorSeries } from "../../src/observe.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import type { Architecture, FlagName } from "../../src/record/architecture.ts";

// A hand-built observable stream of three samples, for the recorder tests (S2a). Test-only values; every time is an integer second.
//
//   U1 / B-U1: inoculated at 0. A feed at 1200. Online temperature every 1000 s from 0: 37.0, 37.1, ... 38.0.
//   U2 / B-U2: inoculated at 0. A temperature shift at 9050. Online temperature as for U1.
//   AN-1: calibrated at 0 (LOT-1) and at 7200 (LOT-2).
//
//   S1 on U1: planned 900, drawn 1100 (OP-1), received 1400, run 1500-2000, glucose 5.1.   The feed at 1200 falls between draw and measurement.
//   S2 on U1: planned 4800, drawn 5000 (OP-2), received 5300, run 6000-6500, glucose 3.2, QC failed, rerun: run 8500-9000, glucose 3.4.
//   S3 on U2: planned 9000, drawn 9100 (OP-1), received 9400, run 9500-10000, glucose 7.0.

type Ev<T extends ObservableEvent["type"]> = Extract<ObservableEvent, { type: T }>;

const visit = (request_id: string, attempt: number, queued: number, started: number, finished: number, value: number, outcome: Ev<"qc_result">["outcome"]): ObservableEvent[] => {
  const ids = { request_id, attempt, visit: 1, analyzer: "AN-1" };
  return [
    { type: "request_queued", t: queued, request_id, attempt, visit: 1, group: "g", seq: 1 },
    { type: "visit_started", t: started, ...ids, setup_s: 0 },
    { type: "run_started", t: started, ...ids },
    { type: "result_measured", t: finished, ...ids, analyte: "glucose", value },
    { type: "qc_result", t: finished, ...ids, outcome },
    { type: "visit_finished", t: finished, ...ids },
  ];
};

const sample = (id: string, unit: string, planned: number, drawn: number, operator: string, received: number): ObservableEvent[] => [
  { type: "sample_planned", t: planned, sample_id: id, unit_id: unit, batch_id: `B-${unit}` },
  { type: "sample_drawn", t: drawn, sample_id: id, unit_id: unit, batch_id: `B-${unit}`, operator_id: operator, volume_ul: 200 },
  { type: "label_bound", t: drawn, sample_id: id, method: "handwritten" },
  { type: "sample_received", t: received, sample_id: id },
];

export const byTime = (events: ObservableEvent[]): ObservableEvent[] => events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);

export const STREAM: ObservableEvent[] = byTime([
  { type: "log_header", t: 0, schema_version: "1", engine_version: "0.1.0", seed: 7 },
  { type: "calibration_recorded", t: 0, analyzer: "AN-1", lot_id: "LOT-1" },
  { type: "calibration_recorded", t: 7200, analyzer: "AN-1", lot_id: "LOT-2" },
  { type: "inoculation", t: 0, unit_id: "U1", batch_id: "B-U1", density_e6_per_ml: 1 },
  { type: "inoculation", t: 0, unit_id: "U2", batch_id: "B-U2", density_e6_per_ml: 1 },
  { type: "process_event", t: 1200, unit_id: "U1", batch_id: "B-U1", kind: "feed", source: "scheduled", amount: 0.1, amount_unit: "L" },
  { type: "process_event", t: 9050, unit_id: "U2", batch_id: "B-U2", kind: "temperature_shift", source: "scheduled", amount: 33, amount_unit: "degC" },
  ...sample("S1", "U1", 900, 1100, "OP-1", 1400),
  ...visit("S1", 1, 1400, 1500, 2000, 5.1, "qc_passed"),
  ...sample("S2", "U1", 4800, 5000, "OP-2", 5300),
  ...visit("S2", 1, 5300, 6000, 6500, 3.2, "qc_failed"),
  { type: "rerun_requested", t: 6500, request_id: "S2", attempt: 1, visit: 1, reason: "qc_failed" },
  ...visit("S2", 2, 6500, 8500, 9000, 3.4, "qc_passed"),
  ...sample("S3", "U2", 9000, 9100, "OP-1", 9400),
  ...visit("S3", 1, 9400, 9500, 10000, 7.0, "qc_passed"),
]);

const ramp = (unit_id: string): ObservableSensorSeries => ({
  unit_id, signal: "temperature", t0_s: 0, cadence_s: 1000, n: 11, pv: Float64Array.from([37.0, 37.1, 37.2, 37.3, 37.4, 37.5, 37.6, 37.7, 37.8, 37.9, 38.0]),
});
export const SENSORS: ObservableSensorSeries[] = [ramp("U1"), ramp("U2")];

/** The S1 result event replayed: the same event again right after the original (a duplicated or replayed file row). */
export const WITH_REPLAY: ObservableEvent[] = STREAM.flatMap((e) => (e.type === "result_measured" && e.request_id === "S1" ? [e, { ...e }] : [e]));

/** U1 is harvested at 1500: S1 is drawn (1100) before it and measured (2000) after it, so a join at the measured time finds no open batch of U1. */
export const WITH_HARVEST: ObservableEvent[] = byTime([...STREAM, { type: "process_event", t: 1500, unit_id: "U1", batch_id: "B-U1", kind: "harvest", source: "scheduled" }]);

/** The S1 result sent again with the same event id and another value (5.9 for 5.1) at the same stamp: a conflicting replay. */
export const WITH_CONFLICT: ObservableEvent[] = STREAM.flatMap((e) => (e.type === "result_measured" && e.request_id === "S1" ? [e, { ...e, value: 5.9 }] : [e]));

/** A fourth sample S4 on U2 is planned at 11000 and its draw is refused by the volume budget at 11100 (no draw, no label, no result). */
export const WITH_SKIP: ObservableEvent[] = [
  ...STREAM,
  { type: "sample_planned", t: 11000, sample_id: "S4", unit_id: "U2", batch_id: "B-U2" },
  { type: "draw_skipped_volume_budget", t: 11100, sample_id: "S4", unit_id: "U2", batch_id: "B-U2", volume_ul: 200, cumulative_ul: 3000 },
];

/** Eight flags, all off. */
export const NO_FLAGS: Record<FlagName, boolean> = Object.fromEntries(FLAG_NAMES.map((f) => [f, false])) as Record<FlagName, boolean>;

/** An architecture with exactly the named flags on (labelling is not read by the recorder). */
export const arch = (...on: FlagName[]): Architecture => ({
  schema_version: "1",
  id: on.length === 0 ? "none" : `only_${on.join("_")}`,
  flags: { ...NO_FLAGS, ...Object.fromEntries(on.map((f) => [f, true])) },
  labelling: "handwritten",
});

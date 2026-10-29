import type { ObservableEvent } from "../../src/observe.ts";
import type { QualificationInput } from "../../src/record/types.ts";
import { byTime } from "./record_fixture.ts";

// Builders for the hand-built observable streams of the forced-error cells and the scenario tests of S2c (test-only values; every time is
// an integer second). The streams are small on purpose: three to five samples, one error each, so every expected cell can be read off.

export { byTime };

export const header: ObservableEvent = { type: "log_header", t: 0, schema_version: "1", engine_version: "0.1.0", seed: 7 };

export const inoculation = (unit: string, t = 0): ObservableEvent => ({ type: "inoculation", t, unit_id: unit, batch_id: `B-${unit}`, density_e6_per_ml: 1 });

export const feed = (unit: string, t: number): ObservableEvent => ({ type: "process_event", t, unit_id: unit, batch_id: `B-${unit}`, kind: "feed", source: "scripted", amount: 0.1, amount_unit: "L" });

export const harvest = (unit: string, t: number): ObservableEvent => ({ type: "process_event", t, unit_id: unit, batch_id: `B-${unit}`, kind: "harvest", source: "scheduled" });

export const calibration = (analyzer: string, t = 0, lot = "LOT-1"): ObservableEvent => ({ type: "calibration_recorded", t, analyzer, lot_id: lot });

/** The head of every stream: the log header and the calibration of AN-1 (without it a run has no instrument state to link, and VR-011 would hold every result of an architecture with the snapshot). */
export const BASE: ObservableEvent[] = [header, calibration("AN-1")];

/** The draw side of one sample: planned 100 s before the draw, received 100 s after it, label written by hand at the draw. */
export const draw = (id: string, unit: string, drawn: number, operator = "OP-1"): ObservableEvent[] => [
  { type: "sample_planned", t: drawn - 100, sample_id: id, unit_id: unit, batch_id: `B-${unit}` },
  { type: "sample_drawn", t: drawn, sample_id: id, unit_id: unit, batch_id: `B-${unit}`, operator_id: operator, volume_ul: 200 },
  { type: "label_bound", t: drawn, sample_id: id, method: "handwritten" },
  { type: "sample_received", t: drawn + 100, sample_id: id },
];

export interface Visit {
  request: string;
  attempt?: number;
  analyzer?: string;
  queued: number;
  started: number;
  finished: number;
  analyte?: string;
  value: number;
  outcome?: "qc_passed" | "qc_failed";
}

/** One visit of a request on an analyzer: queued, started, run, result, QC and finish. */
export const visit = (v: Visit): ObservableEvent[] => {
  const ids = { request_id: v.request, attempt: v.attempt ?? 1, visit: 1, analyzer: v.analyzer ?? "AN-1" };
  return [
    { type: "request_queued", t: v.queued, request_id: v.request, attempt: ids.attempt, visit: 1, group: "g", seq: 1 },
    { type: "visit_started", t: v.started, ...ids, setup_s: 0 },
    { type: "run_started", t: v.started, ...ids },
    { type: "result_measured", t: v.finished, ...ids, analyte: v.analyte ?? "glucose", value: v.value },
    { type: "qc_result", t: v.finished, ...ids, outcome: v.outcome ?? "qc_passed" },
    { type: "visit_finished", t: v.finished, ...ids },
  ];
};

/** A sample drawn at `drawn` whose run starts `hold - 100` s after it arrives: hold_time (run start minus draw) is `hold`, the run takes 300 s. */
export const sampleWithRun = (id: string, unit: string, drawn: number, hold: number, value: number, o: { operator?: string; analyzer?: string; analyte?: string } = {}): ObservableEvent[] => [
  ...draw(id, unit, drawn, o.operator),
  ...visit({ request: id, queued: drawn + 100, started: drawn + hold, finished: drawn + hold + 300, value, ...(o.analyzer && { analyzer: o.analyzer }), ...(o.analyte && { analyte: o.analyte }) }),
];

/**
 * Both operators of the streams hold a qualification valid from 0. Without it audit_trail architectures would hold every result under VR-015, which
 * hides the rows from an as-of read; only the unattributable-record row (cell_rows_b.ts) sets its own.
 */
export const VALID_QUALIFICATIONS: QualificationInput[] = [
  { qualification_id: "Q1", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: null },
  { qualification_id: "Q2", operator_id: "OP-2", qualified: true, valid_from: 0, valid_to: null },
];

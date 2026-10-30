import { hasValue } from "./types.ts";
import type { AuditEventRow, RecordedDataset } from "./types.ts";

// The named evidence checks of the hypothesis matrix (spec section 5, "Detected by" entries that are not rules; S2b ruling, scored in S2c1). Each
// reads a recorded dataset only and answers "does the record show this?". None is a validation rule: no state changes, no finding is written.

/** Audit review (flag audit_trail): the audit event of a result key with the old and the new value and version, or null when no history was kept. */
export const auditChange = (ds: RecordedDataset, request: string, analyte: string): AuditEventRow | null =>
  ds.audit_event.find((a) => a.request_id === request && a.analyte === analyte) ?? null;

/** The results of the requests that share a control_id, in the order of the plan, each with the run it came from. */
const controlRows = (ds: RecordedDataset, controlId: string) => {
  const runs = new Map(ds.run.map((r) => [r.run_id, r]));
  const requests = ds.analysis_request.filter((r) => r.control_id === controlId).map((r) => r.request_id);
  return requests.flatMap((request) => ds.result.filter(hasValue).filter((r) => r.request_id === request).flatMap((r) => (runs.has(r.run_id) ? [{ ...r, run: runs.get(r.run_id) as NonNullable<ReturnType<typeof runs.get>> }] : [])));
};

export interface BridgingOffset {
  control_id: string;
  analyte: string;
  /** The analyzer of the reference request (the first request of the control in the plan) and of the other one. */
  reference_analyzer: string;
  other_analyzer: string;
  /** The value of the other request minus the value of the reference: the offset of `other_analyzer` against `reference_analyzer`. */
  offset: number;
}

/**
 * Bridging study between analyzers (author decision of 2026-10-29; ADR-0005 read literally): two requests that share a control_id and were measured on
 * different analyzers give the offset between the analyzers. It needs the control_id pair and the analyzer identity, and the analyzer name as free text
 * suffices; it does not need the link to the instrument state (flag instrument_state_snapshot). Null when the pair is not on two analyzers.
 */
export const bridgingOffset = (ds: RecordedDataset, controlId: string): BridgingOffset | null => {
  const rows = controlRows(ds, controlId);
  const reference = rows[0];
  const other = reference && rows.find((r) => r.analyte === reference.analyte && r.run.analyzer_name !== reference.run.analyzer_name);
  return reference && other
    ? { control_id: controlId, analyte: reference.analyte, reference_analyzer: reference.run.analyzer_name, other_analyzer: other.run.analyzer_name, offset: other.value - reference.value }
    : null;
};

export interface LotOffset {
  control_id: string;
  analyte: string;
  instrument_id: string;
  reference_state: string;
  other_state: string;
  reference_lot: string;
  other_lot: string;
  /** The value of the request under the other lot minus the value of the reference request. */
  offset: number;
}

/**
 * Lot step within one analyzer (flag instrument_state_snapshot): two requests that share a control_id, measured on the same instrument under different
 * reagent lots. The lot is known only through the link from the run to the instrument state, so without the link the step cannot be attributed: null.
 */
export const lotOffset = (ds: RecordedDataset, controlId: string): LotOffset | null => {
  const states = new Map(ds.instrument_state.map((s) => [s.instrument_state_id, s]));
  const rows = controlRows(ds, controlId).flatMap((r) => {
    const state = r.run.instrument_state_id === null ? undefined : states.get(r.run.instrument_state_id);
    return state ? [{ ...r, state }] : [];
  });
  const reference = rows[0];
  const other = reference && rows.find((r) => r.analyte === reference.analyte && r.state.instrument_id === reference.state.instrument_id && r.state.reagent_lot !== reference.state.reagent_lot);
  return reference && other
    ? {
        control_id: controlId, analyte: reference.analyte, instrument_id: reference.state.instrument_id, reference_state: reference.state.instrument_state_id, other_state: other.state.instrument_state_id,
        reference_lot: reference.state.reagent_lot, other_lot: other.state.reagent_lot, offset: other.value - reference.value,
      }
    : null;
};

/**
 * Recorded container and hold context (flag two_clocks for the hold part): the container the plan recorded and the hold time (first run start minus
 * `sampled_at`) of a sample, both stored. Null when either part is missing.
 */
export const holdContext = (ds: RecordedDataset, sampleId: string): { container: string; hold_time_s: number } | null => {
  const sample = ds.sample.find((s) => s.sample_id === sampleId);
  const start = ds.run.filter((r) => r.request_id === sampleId).map((r) => r.started_at).sort((a, b) => a - b)[0];
  if (!sample || sample.container === null || sample.sampled_at === null || start === undefined) return null;
  return { container: sample.container, hold_time_s: start - sample.sampled_at };
};

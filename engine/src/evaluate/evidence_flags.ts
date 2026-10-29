import type { ErrorType } from "../inject/types.ts";
import { auditChange } from "../record/evidence.ts";
import type { RecordedDataset } from "../record/types.ts";

// The non-rule detectors of the hypothesis matrix that sit on an error type of the injector, scored by their evidence name (data_model section 7, "Evidence
// checks decided in S2c1" and "decided in S2c2"; spec section 5, "Notes from S2c1"). An evidence check reads a recorded dataset and answers "does the record
// show this?" for a request; it sets no state and writes no finding. Evidence raises no alarm (orchestrator ruling, 2026-10-29): it has a recall, the share of
// realised errors whose request carries it, and no precision and no false-alarm rate.
//
// Only the audit event sits on a type of the key. The bridging study, the lot link and the container and hold context read truth-side effects
// (instrument effect, lot step, technique error) that the injector does not materialise, so the key has no realised set to score them against.

export interface Evidence {
  /** The name the detection counts under (`by_detector`). */
  name: string;
  /** The flag that must be on for the check to have the fields it reads (spec section 5, "Detection rules and the flags they need"). */
  needs: keyof RecordedDataset["architecture"]["flags"];
  /** The requests for which the record shows the error, by the id the record holds them under. */
  requests: (ds: RecordedDataset) => string[];
}

/** Audit review (flag audit_trail): a request with an audit event, holding the old and the new value, on any of its result keys. */
const auditRequests = (ds: RecordedDataset): string[] => {
  const keys = new Map(ds.result.map((r) => [`${r.request_id}\u0000${r.analyte}`, r]));
  return [...new Set([...keys.values()].filter((r) => auditChange(ds, r.request_id, r.analyte) !== null).map((r) => r.request_id))];
};

export const EVIDENCE_OF: Partial<Record<ErrorType, readonly Evidence[]>> = {
  lost_rerun: [{ name: "audit_event", needs: "audit_trail", requests: auditRequests }],
};

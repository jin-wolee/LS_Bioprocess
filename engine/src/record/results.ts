import type { ObservableEvent } from "../observe.ts";
import type { FlagName } from "./architecture.ts";
import { transit } from "./transitions.ts";
import type { AuditEventRow, CaptureInput, IngestConflictRow, ResultRow, SourceEventRow, ValidationFindingRow } from "./types.ts";

// Results as the instrument file delivers them: one row per analyte value, with the effects of four flags (spec section 5).
//   ingest_idempotency   the key is source, event id and content version (data_model section 7; the stream carries one content version, 1, so the value is not in it).
//                        Same key and same content: a no-op, logged. Same key and other content: not loaded, the original stays, the incoming row goes to the
//                        conflict list for S2b (VR-008b). Without the flag a replay is another row (double count).
//   append_only_versions a rerun (an attempt not seen for this request and analyte) adds a version that supersedes the last; without it
//                        the rerun overwrites the rows in place and the earlier value is gone. A replay is an insert on every architecture.
//   available_at         the row carries the stamp of its event as the instant it became knowable; a row that the review step releases gets the review point
//                        instead (record/review.ts).
//   ingested_at          a row-creation stamp is stored whenever a system writes the rows, i.e. at least one flag is on (storesIngestedAt); the all-off
//                        configuration, the spreadsheet, stores none (S2b, data_model section 7). It does not hang on one flag.
//   audit_trail          a rerun that replaces an earlier attempt is an audit event with the old and the new value, kept even when the earlier
//                        row is overwritten.
// Hidden fields are not read: the event type has none (observe.ts).

type Measured = Extract<ObservableEvent, { type: "result_measured" }>;
type Flags = Record<FlagName, boolean>;

/** A row-creation stamp exists where a system writes the rows: any of the eight flags on. Architecture A (all off) stores none. */
export const storesIngestedAt = (flags: Flags): boolean => Object.values(flags).some(Boolean);

/** The version of the content of a source event. The observable stream carries one, so the key is the same for a replay and for a changed value. */
const CONTENT_VERSION = 1;

interface Key {
  attempts: number[];
  /** The result_id of the first row of the latest attempt: the row a new version supersedes. */
  latest: string;
  value: number;
}

export interface ResultTables {
  result: ResultRow[];
  audit_event: AuditEventRow[];
  source_event: SourceEventRow[];
  validation_finding: ValidationFindingRow[];
  ingest_conflict: IngestConflictRow[];
}

export const recordResults = (events: readonly ObservableEvent[], flags: Flags, receivedAt: Readonly<Record<string, number>> = {}, capture?: CaptureInput): ResultTables => {
  const out: ResultTables = { result: [], audit_event: [], source_event: [], validation_finding: [], ingest_conflict: [] };
  const keys = new Map<string, Key>();
  const seen = new Map<string, { value: number; t: number }>();
  let counter = 0;

  // ingested_at (S2b): stored where a system writes the rows; the stamp of the event unless the host receipt time was handed over
  // S2e1: with the raw layer on, a row also says how it became a record (data_model section 16.2), became knowable when the system received it (the file, or the typed entry:
  // spec section 5, "Capture path"), and carries the state and findings the ingest stage gave it.
  const row = (e: Measured, version: number, supersedes: string | null, id?: string): ResultRow => {
    const key = `${e.analyzer}/${e.request_id}/${e.attempt}/${e.visit}/${e.analyte}`;
    const prov = capture?.provenance[key];
    const stage = prov?.findings ?? [];
    const worst = stage.some((f) => f.action === "quarantine") ? "quarantined" : stage.length > 0 ? "held" : null;
    const r: ResultRow = {
      result_id: id ?? `R${++counter}`, request_id: e.request_id, analyte: e.analyte, version, run_id: `${e.request_id}/${e.attempt}/${e.visit}`,
      value: e.value, measured_at: e.t, available_at: flags.available_at ? (capture ? (receivedAt[key] ?? e.t) : e.t) : null, supersedes,
      ingested_at: storesIngestedAt(flags) ? (receivedAt[key] ?? e.t) : null, reviewed_at: null,
      ...(capture && {
        capture_path: capture.path, entered_by: flags.audit_trail ? (prov?.entered_by ?? null) : null, raw_ref: prov?.raw_ref ?? null, unit_original: prov?.unit_original ?? null,
        unit_ucum: prov?.unit_ucum ?? null, dilution_factor: prov?.dilution_factor ?? null, time_resolution_s: prov?.time_resolution_s ?? null,
      }),
      state: worst === null ? null : (transit("result", "measured", worst, "rule") as "held" | "quarantined"),
    };
    if (id === undefined) for (const f of stage) out.validation_finding.push({ rule: f.rule, target: `result:${r.result_id}`, severity: f.severity, action: f.action, status: "open" });
    return r;
  };

  for (const e of events) {
    if (e.type !== "result_measured") continue;
    const source_event_id = `${e.analyzer}/${e.request_id}/${e.attempt}/${e.visit}/${e.analyte}`;
    if (flags.ingest_idempotency) {
      const idempotency_key = `${e.analyzer}|${source_event_id}|v${CONTENT_VERSION}`;
      const first = seen.get(idempotency_key);
      if (first) {
        if (first.value === e.value && first.t === e.t) out.validation_finding.push({ rule: "VR-008", target: `source_event:${source_event_id}`, severity: "info", action: "no-op", status: "resolved" });
        else {
          out.ingest_conflict.push({
            source_system: e.analyzer, source_event_id, idempotency_key, received_at: e.t, request_id: e.request_id, analyte: e.analyte, run_id: `${e.request_id}/${e.attempt}/${e.visit}`, value: e.value, measured_at: e.t,
          });
        }
        continue;
      }
      seen.set(idempotency_key, { value: e.value, t: e.t });
      out.source_event.push({ source_system: e.analyzer, source_event_id, idempotency_key, received_at: e.t });
    }

    const k = `${e.request_id}/${e.analyte}`;
    const key = keys.get(k);
    if (!key) {
      const r = row(e, 1, null);
      out.result.push(r);
      keys.set(k, { attempts: [e.attempt], latest: r.result_id, value: e.value });
    } else if (key.attempts.includes(e.attempt)) {
      out.result.push(row(e, flags.append_only_versions ? key.attempts.indexOf(e.attempt) + 1 : 1, null)); // a replay: another row
    } else {
      const version = key.attempts.length + 1;
      key.attempts.push(e.attempt);
      if (flags.audit_trail) {
        out.audit_event.push({ audit_id: `A${out.audit_event.length + 1}`, request_id: e.request_id, analyte: e.analyte, at: e.t, old_value: key.value, new_value: e.value, old_version: version - 1, new_version: version });
      }
      if (flags.append_only_versions) {
        const r = row(e, version, key.latest);
        out.result.push(r);
        key.latest = r.result_id;
      } else {
        for (const [i, old] of out.result.entries()) {
          if (old.request_id === e.request_id && old.analyte === e.analyte) out.result[i] = row(e, 1, null, old.result_id);
        }
      }
      key.value = e.value;
    }
  }
  if (capture) {
    out.validation_finding.push(...(capture.findings ?? []));
    out.ingest_conflict.push(...(capture.conflicts ?? []));
  }
  return out;
};

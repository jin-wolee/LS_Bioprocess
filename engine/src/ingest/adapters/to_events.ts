import type { ObservableEvent } from "../../observe.ts";
import type { CaptureInput, CaptureProvenance, IngestConflictRow, ValidationFindingRow } from "../../record/types.ts";
import type { Manifest, ParseOutput } from "../canonical.ts";

// From canonical records to what the recorder takes (spec section 5, "Capture path"; data_model section 16.3). On adapter_ingest the result rows of the recorder come from
// the parsed file: value, time, sample id text, analyte and instrument are the parser's, not the observable event's. The run bookkeeping a file cannot carry (attempt, visit)
// comes from the manifest the assembly kept beside the file. Every other observable event (the queue, the runs, the QC outcomes, the samples, the process) passes unchanged.
// A row with no value (an analytical-range breach, a blank required cell) or no instant (an unresolved stamp) has no result row in the recorder: it stays a raw_record.

type Measured = Extract<ObservableEvent, { type: "result_measured" }>;

export interface Bridged {
  events: ObservableEvent[];
  capture: CaptureInput;
  /** The file's received_at by source event id: the ingested_at of the row. */
  received_at: Record<string, number>;
}

export const bridge = (events: readonly ObservableEvent[], outputs: readonly ParseOutput[], manifests: ReadonlyMap<string, Manifest>): Bridged => {
  const keyOf = (analyzer: string, request: string, attempt: number, visit: number, analyte: string): string => `${analyzer}/${request}/${attempt}/${visit}/${analyte}`;
  // 2026-10-30 S2f F1: the slot of a result event also names its instant, as the row of the file does (raw/rows.ts), so two analyses with one label, attempt and visit keep a slot each
  const slotKey = (analyzer: string, request: string, attempt: number, visit: number, analyte: string, t: number): string => `${keyOf(analyzer, request, attempt, visit, analyte)}/${t}`;
  const slot = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.type === "result_measured" && !slot.has(slotKey(e.analyzer, e.request_id, e.attempt, e.visit, e.analyte, e.t))) slot.set(slotKey(e.analyzer, e.request_id, e.attempt, e.visit, e.analyte, e.t), i);
  });
  const placed = new Map<number, Measured[]>();
  const provenance: Record<string, CaptureProvenance> = {};
  const received_at: Record<string, number> = {};
  const findings: ValidationFindingRow[] = [];
  const conflicts: IngestConflictRow[] = [];
  const srcOf = (file: string, line: number) => manifests.get(file)?.find((m) => m.line === line)?.src;

  for (const out of outputs) {
    for (const f of out.findings) findings.push({ rule: f.rule, target: f.target, severity: f.severity, action: f.action, status: f.status });
    for (const c of out.conflicts) {
      const src = srcOf(c.raw_ref.raw_file_id, c.raw_ref.line_no);
      if (src && c.value !== null && c.measured_at !== null) {
        conflicts.push({ source_system: c.source_system, source_event_id: c.source_event_id, idempotency_key: c.idempotency_key, received_at: c.received_at, request_id: c.sample_id, analyte: c.analyte, run_id: `${src.request_id}/${src.attempt}/${src.visit}`, value: c.value, measured_at: c.measured_at });
      }
    }
    for (const r of out.records) {
      const p = r.payload;
      const src = srcOf(r.envelope.raw_ref.raw_file_id, r.envelope.raw_ref.line_no);
      if (!src || p.value === null || p.measured_at === null) {
        // no result row (no value or no instant): the finding of the ingest stage stays, on the source event, so the record still shows that the line was held or quarantined
        for (const f of r.findings) if (f.action === "hold" || f.action === "quarantine") findings.push({ rule: f.rule, target: `source_event:${r.envelope.source_event_id}`, severity: f.severity, action: f.action, status: "open" });
        continue;
      }
      const key = keyOf(r.envelope.source_system, p.sample_id, src.attempt, src.visit, p.analyte);
      const at = slot.get(slotKey(r.envelope.source_system, src.request_id, src.attempt, src.visit, p.analyte, src.t));
      if (at === undefined) continue;
      placed.set(at, [...(placed.get(at) ?? []), { type: "result_measured", t: p.measured_at, request_id: p.sample_id, attempt: src.attempt, visit: src.visit, analyzer: r.envelope.source_system, analyte: p.analyte, value: p.value }]);
      provenance[key] = {
        raw_ref: r.envelope.raw_ref, entered_by: null, unit_original: p.unit_original, unit_ucum: p.unit_ucum, dilution_factor: p.dilution_factor, time_resolution_s: p.time_resolution_s,
        findings: r.findings.filter((f): f is typeof f & { action: "hold" | "quarantine" } => f.action === "hold" || f.action === "quarantine"),
      };
      received_at[key] = r.envelope.received_at;
    }
  }
  const out: ObservableEvent[] = [];
  events.forEach((e, i) => {
    if (e.type !== "result_measured") out.push(e);
    else out.push(...(placed.get(i) ?? []));
  });
  return { events: out, capture: { path: "adapter_ingest", provenance, findings, conflicts }, received_at };
};

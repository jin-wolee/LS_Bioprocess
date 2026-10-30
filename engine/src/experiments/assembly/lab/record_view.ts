import { FLAG_NAMES } from "../../../record/architecture.ts";
import { hasValue } from "../../../record/types.ts";
import type { RecordedDataset } from "../../../record/types.ts";
import type { RecordView } from "./challenge_types.ts";

// 2026-10-30 S3e (docs/design/lab_ui.md section 9, "What the reader can open"): the tables of the shown record, as plain rows. Recorded rows are observable by construction; every row of a
// table has the same keys, so nothing marks a row as the planted one.

export const flagsOn = (ds: Pick<RecordedDataset, "architecture">): string[] => FLAG_NAMES.filter((f) => ds.architecture.flags[f]);

export const sampleRows = (ds: RecordedDataset): RecordView["samples"] =>
  ds.sample.map((s) => ({ sample_id: s.sample_id, unit_id: s.unit_id, batch_id: s.batch_id, sampled_at: s.sampled_at, planned_at: s.planned_at, state: s.state }));

export const findingRows = (ds: RecordedDataset): RecordView["findings"] => ds.validation_finding.map((f) => ({ rule: f.rule, target: f.target, severity: f.severity, status: f.status }));

export const recordViewOf = (ds: RecordedDataset, ubiquitous: string[]): RecordView => ({
  architecture: ds.architecture.id,
  flags_on: flagsOn(ds),
  samples: sampleRows(ds),
  results: ds.result.filter(hasValue).map((r) => ({ request_id: r.request_id, analyte: r.analyte, version: r.version, value: r.value, measured_at: r.measured_at, available_at: r.available_at, state: r.state })),
  findings: findingRows(ds),
  audit_events: ds.audit_event.map((a) => ({ audit_id: a.audit_id, request_id: a.request_id, analyte: a.analyte, at: a.at, old_value: a.old_value, new_value: a.new_value, old_version: a.old_version, new_version: a.new_version })),
  ubiquitous,
});

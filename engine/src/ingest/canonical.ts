import type { Source } from "../raw/types.ts";

// The output of an adapter (data_model section 16): the raw_file, raw_record and parse_error rows, the canonical records with their envelope, and the findings.
// Names are data_model's. A rule changes a state and never a value (section 8).

export type RecordState = "loaded" | "held" | "quarantined";
export type RawRecordState = "loaded" | "no_op" | "held" | "quarantined" | "rejected";

export interface Finding {
  rule: string;
  severity: "info" | "warning" | "error";
  action: "no-op" | "hold" | "quarantine" | "reject";
}

export type RangeFlag = "above_analytical" | "below_analytical" | "above_process" | "below_process";

/** An analyzer result (data/schemas/canonical_record.schema.json, result_record). */
export interface CanonicalResult {
  record_kind: "result";
  envelope: {
    source_system: string;
    source_event_id: string;
    idempotency_key: string;
    schema_version: "1";
    raw_ref: { raw_file_id: string; line_no: number };
    event_time: string;
    received_at: number;
  };
  payload: {
    sample_id: string;
    analyte: string;
    value: number | null;
    unit_original: string | null;
    unit_ucum: string | null;
    dilution_factor: number | null;
    measured_at: number | null;
    source_zone_s: number | null;
    time_resolution_s: number;
    range_flag: RangeFlag | null;
    version: number;
    supersedes: string | null;
  };
  state: RecordState;
  findings: Finding[];
}

/** The ingestion envelope of a parsed line (data_model 7 and 16.3). */
export interface Envelope {
  source_system: string;
  source_event_id: string;
  idempotency_key: string;
  schema_version: "1";
  raw_ref: { raw_file_id: string; line_no: number };
  event_time: string;
  received_at: number;
}

interface ControllerRecord<K extends string, P> {
  record_kind: K;
  envelope: Envelope;
  payload: P;
  state: RecordState;
  findings: Finding[];
}

/** A controller tag value (data/schemas/canonical_record.schema.json, historian_value); the tag is unit_tag.signal.role (data_model 16.4). */
export type CanonicalHistorian = ControllerRecord<"tag_value", { tag: string; ts: number; value: number; quality: string }>;

/** One alarm transition (alarm_event). `tag` and `severity` are null where the family's alarm log carries none. */
export type CanonicalAlarm = ControllerRecord<"alarm_transition", { alarm_id: string; unit_id: string; tag: string | null; severity: number | null; from_state: string; to_state: string; ts: number; actor: string | null; comment: string | null }>;

/** One phase transition (batch_phase_record). The fields a family's phase log does not carry are null. */
export type CanonicalPhase = ControllerRecord<"phase_transition", { batch_id: string | null; unit_id: string; recipe_id: string; procedure: string | null; unit_procedure: string | null; operation: string | null; phase: string; from_state: string; to_state: string; ts: number; actor: string | null; command: string | null }>;

export interface RawFileRow {
  raw_file_id: string;
  adapter_id: string;
  adapter_version: number;
  file_name: string;
  content_hash: string;
  row_count: number;
  received_at: number;
  instrument_id: string;
  state: "received" | "parsed" | "rejected";
}

export interface RawRecordRow {
  raw_record_id: string;
  raw_file_id: string;
  line_no: number;
  record_kind: "analysis" | "injection" | "tag_value" | "alarm_transition" | "phase_transition";
  raw_text: string;
  source_event_id: string | null;
  state: RawRecordState;
  /** The rule behind a state other than loaded. */
  rule_id: string | null;
}

export type ParseErrorCode = "unknown_dialect_or_template" | "required_column_missing" | "bad_row_width" | "malformed_stamp" | "non_numeric_value" | "unknown_unit" | "unknown_name";

export interface ParseErrorRow {
  parse_error_id: string;
  raw_file_id: string;
  line_no: number | null;
  column_role: string | null;
  code: ParseErrorCode;
  rule_id: "VR-023";
  reason: string;
  raised_at: number;
}

/** A finding that concerns a file or a source event, not a result row: `file:<raw_file_id>` or `source_event:<id>`. */
export interface IngestFinding extends Finding {
  target: string;
  status: "open" | "resolved";
}

/** An incoming row with a known key and other content (VR-008b): not loaded, the original stays. */
export interface IngestConflict {
  source_system: string;
  source_event_id: string;
  idempotency_key: string;
  received_at: number;
  sample_id: string;
  analyte: string;
  value: number | null;
  measured_at: number | null;
  raw_ref: { raw_file_id: string; line_no: number };
}

export interface ParseOutput {
  raw_file: RawFileRow;
  raw_records: RawRecordRow[];
  records: CanonicalResult[];
  parse_errors: ParseErrorRow[];
  findings: IngestFinding[];
  conflicts: IngestConflict[];
}

/** The bookkeeping the assembly keeps beside a file: line to run identity (`Source`); the parser never sees it. */
export type Manifest = readonly { line: number; src: Source }[];

/** One state change of one alarm instance, as stored (data_model 16.4): append-only; a row the adapter held (VR-025) is stored, with a finding that targets `alarm_event:<alarm_event_id>`. */
export interface AlarmEventRow {
  alarm_event_id: string;
  alarm_id: string;
  unit_id: string;
  tag: string | null;
  severity: number | null;
  from_state: string;
  to_state: string;
  ts: number;
  ingested_at: number;
  actor: string | null;
  comment: string | null;
  raw_ref: { raw_file_id: string; line_no: number };
}

/** One state change of one phase instance, as stored (data_model 16.4); a held row has a finding that targets `batch_phase_record:<phase_record_id>`. */
export interface BatchPhaseRecordRow {
  phase_record_id: string;
  batch_id: string | null;
  unit_id: string;
  recipe_id: string;
  procedure: string | null;
  unit_procedure: string | null;
  operation: string | null;
  phase: string;
  from_state: string;
  to_state: string;
  ts: number;
  ingested_at: number;
  actor: string | null;
  command: string | null;
  raw_ref: { raw_file_id: string; line_no: number };
}

/** The raw-side tables an architecture on adapter_ingest stores (data_model section 16.1 and 16.4); the flags still decide what the recorder keeps. */
export interface RawTables {
  adapter: { adapter_id: string; adapter_version: number; dialect_id: string; device_class: "analyzer" | "controller"; instrument_id: string; date_order: string; date_separator: string; clock_style: string; source_zone_s: number | null; stamp_means: string; time_resolution_s: number; modeled_on: string[]; banner: string }[];
  raw_file: RawFileRow[];
  raw_record: RawRecordRow[];
  parse_error: ParseErrorRow[];
  /** Controller side: empty when no bay has a controller. */
  alarm_event: AlarmEventRow[];
  batch_phase_record: BatchPhaseRecordRow[];
}

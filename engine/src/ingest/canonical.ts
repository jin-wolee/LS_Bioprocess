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

/** An analyzer result (schemas/canonical_record.schema.json, result_record). */
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
  record_kind: "analysis" | "injection";
  raw_text: string;
  source_event_id: string | null;
  state: RawRecordState;
  /** The rule behind a state other than loaded. */
  rule_id: string | null;
}

export type ParseErrorCode = "unknown_dialect_or_template" | "required_column_missing" | "bad_row_width" | "malformed_stamp" | "non_numeric_value" | "unknown_unit";

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

/** The raw-side tables an architecture on adapter_ingest stores (data_model section 16.1); the flags still decide what the recorder keeps. */
export interface RawTables {
  adapter: { adapter_id: string; adapter_version: number; dialect_id: string; device_class: "analyzer"; instrument_id: string; date_order: string; date_separator: string; clock_style: string; source_zone_s: number | null; stamp_means: string; time_resolution_s: number; modeled_on: string[]; banner: string }[];
  raw_file: RawFileRow[];
  raw_record: RawRecordRow[];
  parse_error: ParseErrorRow[];
}

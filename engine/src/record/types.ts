import type { ObservableEvent, ObservableSensorSeries } from "../observe.ts";
import type { RawTables } from "../ingest/canonical.ts";
import type { CapturePath } from "../raw/types.ts";
import type { Architecture } from "./architecture.ts";
import type { BreakoutInput, DeviationRow, EquipmentRow, LineageEdgeRow, MaterialLotRow, QualityHoldRow, RetroFlagAudit, RetroFlagColumn } from "./breakout_types.ts";

export type { CapturePath };
export type { BreakoutInput, DeviationRow, DeviationState, EquipmentRow, EquipmentState, HoldState, LineageEdgeRow, LotState, MaterialLotRow, QualityHoldRow, RetroFlagAudit, RetroFlagColumn } from "./breakout_types.ts";

// The recorded dataset of one architecture (data_model section 2). Column names are data_model's. A column an architecture cannot
// know is null (data_model principle 7), never absent, so a test can state "stored" as "not null". Times are integer seconds of
// the scenario, as stamped by the observable event the row comes from. Nothing here is a truth field.

/** A qualification record of an operator (data_model section 2, supporting entities); plain data from the assembly (the truth side knows `operator.qualified`). */
export interface QualificationInput {
  qualification_id: string;
  operator_id: string;
  /** The training status the record attests (the level of A072 and A073, carried as a boolean so that the engine names no profile id). */
  qualified: boolean;
  valid_from: number;
  /** Null while the qualification has no end. */
  valid_to: number | null;
}

/** S2e1: what a result carries from the capture step beyond its value (data_model section 16.2); plain data from the assembly. */
export interface CaptureProvenance {
  /** adapter_ingest: the line of the raw file the row was loaded from. */
  raw_ref?: { raw_file_id: string; line_no: number } | null;
  /** manual_transcription: the operator who typed the result. */
  entered_by?: string | null;
  unit_original?: string | null;
  unit_ucum?: string | null;
  dilution_factor?: number | null;
  time_resolution_s?: number | null;
  /** The findings of the ingest stage that hold or quarantine this row. */
  findings?: readonly { rule: string; severity: "info" | "warning" | "error"; action: "hold" | "quarantine" }[];
}

/** S2e1: the capture path of the architecture and what the capture step knows of each result, by source event id (`analyzer/request/attempt/visit/analyte`). Present only with the raw layer on. */
export interface CaptureInput {
  path: CapturePath;
  provenance: Readonly<Record<string, CaptureProvenance>>;
  /** Findings of the ingest stage that concern a file or a source event, not a result row (VR-008 information, unknown columns). */
  findings?: readonly ValidationFindingRow[];
  /** Incoming rows kept aside by the adapter's idempotency rule (VR-008b): not loaded, the original stays. */
  conflicts?: readonly IngestConflictRow[];
  /**
   * S2e2: the historian values parsed from the controller logs (adapter_ingest, with a controller on the bay). They are the historian of the dataset: the logged rows replace the
   * engine's columnar series, which is what the layer-off recorders and the manual path read as observable events (spec 5, "Capture path", rule 3).
   */
  historian?: readonly HistorianRow[];
}

export interface RecorderInput {
  /** The observable events (hidden fields removed, in the type and in the value). */
  events: readonly ObservableEvent[];
  /** The online sensor series, process value only. */
  sensors: readonly ObservableSensorSeries[];
  /**
   * S2b: the instant the host received a result, by source event id (`analyzer/request/attempt/visit/analyte`), for events whose own stamp
   * is wrong (an instrument clock error, A049). Default: the stamp of the event. It becomes `ingested_at` where that is stored.
   */
  received_at?: Readonly<Record<string, number>>;
  /** S2b: qualification records; with `audit_trail` on the sample row gets the reference that was valid at the draw. */
  qualifications?: readonly QualificationInput[];
  /**
   * S2c1: what the sampling plan and the SOP say, as plain data from the assembly (the observable stream carries neither): the `control_id` of the
   * bridging requests (data_model section 2, `analysis_request`) and the container of each sample (an L2 setting). No flag owns either; absent means
   * the plan names none, and the columns are null.
   */
  plan?: { controls?: Readonly<Record<string, string>>; containers?: Readonly<Record<string, string>> };
  /** S2e1: the capture path and the provenance of each result; absent with the raw layer off, which leaves every row and column as before. */
  capture?: CaptureInput;
  /**
   * Break-out batch 3 (data_model 15.6): the master data of the scenario topology, from the assembly. Its presence says the scenario has a `breakout` block: only then the dataset gains the tables
   * `material_lot`, `equipment`, `lineage_edge`, `deviation` and `quality_hold` and the break-out columns, and the recorder reads the break-out events. Absent, those events are ignored and no table or
   * column exists (absent, not null), so a dataset without a break-out block is as before.
   */
  breakout?: BreakoutInput;
}

export interface SampleRow {
  sample_id: string;
  /** The unit as carried by the label in the stream, stored at write in every architecture. */
  unit_id: string;
  /** write_time_keys only. Off: null at write; the batch is derived at read by a time join (`batchOf` in asof.ts). */
  batch_id: string | null;
  /** write_time_keys: the keys were fixed at write time. */
  keys_fixed_at_write: boolean;
  /** `skipped` for a planned draw that the volume budget refused (spec section 2.2); null otherwise (the state machine of the sample is S2d). */
  state: "skipped" | null;
  /** two_clocks only (K3). */
  sampled_at: number | null;
  /** system_issued_id only: the plan that issues the label gives the sample its planned time (data_model section 2). */
  planned_at: number | null;
  /** audit_trail only: the sampler. Off: the operator is absent. */
  operator_id: string | null;
  /** audit_trail only: the qualification record of the sampler that was valid at the draw; null when none was (VR-015). */
  qualification_id: string | null;
  /** The method the label_bound event reports. */
  label_method: string | null;
  /** S2c1: the container the plan records for the sample (open or closed, an L2 setting); null when the plan names none. */
  container: string | null;
}

/** S2c1: one analysis request as the plan records it; `control_id` is shared by the requests that measure one bridging material, null for the others (data_model section 2). */
export interface AnalysisRequestRow {
  request_id: string;
  control_id: string | null;
  /** Break-out only (data_model 15.1): a confirming test is asked of a confirming sample; the rules and the section 8 metrics count routine requests only. Absent without a break-out block. */
  purpose?: "routine" | "confirmatory";
}

export interface RunRow {
  run_id: string;
  request_id: string;
  attempt: number;
  visit: number;
  /** The analyzer as free text, as seen on the event (allowed with the snapshot off: "at most a free-text analyzer name"). */
  analyzer_name: string;
  /** instrument_state_snapshot only. */
  instrument_id: string | null;
  /** instrument_state_snapshot only. */
  instrument_state_id: string | null;
  started_at: number;
  /** Null while no visit_finished has been seen for the run. */
  ended_at: number | null;
  /**
   * The outcome of the run's `qc_result` event (data_model section 2, "QC outcome"); null while none has been seen. No flag owns it: every architecture that
   * records the run holds it (S2 review step, data_model section 7). VR-012 reads `qc_failed`.
   */
  qc_outcome: "qc_passed" | "qc_failed" | "over_range" | null;
}

export interface InstrumentStateRow {
  instrument_state_id: string;
  instrument_id: string;
  calibration_ref: string;
  reagent_lot: string;
  valid_from: number;
  /** Null while the state is the latest one. */
  valid_to: number | null;
}

export interface ResultRow extends RetroFlagColumn {
  result_id: string;
  request_id: string;
  analyte: string;
  /** Rank of the attempt among the attempts recorded for (request, analyte). Overwrite in place (append_only_versions off) keeps 1. */
  version: number;
  run_id: string;
  /** Null for a row that carries no number: a confirming result has an `outcome` instead (K18, break-out batch 3). Every routine row has a value; `hasValue` narrows. */
  value: number | null;
  measured_at: number;
  /** available_at only: the stamp of the observable result event (S2a models no ingestion or review delay). */
  available_at: number | null;
  /** append_only_versions only: the result_id this version replaces. */
  supersedes: string | null;
  /**
   * The instant the system wrote the row (the envelope received_at becomes ingested_at, data_model section 7); null where no system writes
   * the rows, i.e. with every flag off (architecture A; S2b decision on data_model section 14, question 7).
   */
  ingested_at: number | null;
  /** The instant a reviewer acted on the row (data_model section 5): null from the recorder and for a row that was never held; only the review step sets it. */
  reviewed_at: number | null;
  /** Raw layer only (data_model section 16.2): how the row became a record, and what the capture step knew of it. Absent with the layer off. */
  capture_path?: CapturePath;
  entered_by?: string | null;
  raw_ref?: { raw_file_id: string; line_no: number } | null;
  unit_original?: string | null;
  unit_ucum?: string | null;
  dilution_factor?: number | null;
  time_resolution_s?: number | null;
  /**
   * The state a validation rule put the row in (hold, quarantine, reject; data_model sections 6 and 8), or `released` once the review step has let a held row through.
   * Null from the recorder: only a rule or the review sets it, and never changes a value.
   */
  state: ResultState | null;
  /** Break-out only (data_model 15.1, K18): what a confirming test found; set exactly on the results of confirmatory requests, where `value` is null. Null on a routine result; absent without a break-out block. */
  outcome?: "detected" | "not_detected" | null;
}

/** A result row that carries a number: every routine result. The readers of values (rules, evidence, the arms, the evaluator) take their rows through this. */
export type ValuedResult = ResultRow & { value: number };
export const hasValue = (r: ResultRow): r is ValuedResult => r.value !== null;

/** `held` and `quarantined` wait for the review; `rejected` (by a rule at ingest or by the review) and `released` are the end states (data_model section 6). */
export type ResultState = "held" | "quarantined" | "rejected" | "released";

/** audit_trail only: one row per change of a result (a rerun that replaces an earlier attempt). */
export interface AuditEventRow extends RetroFlagAudit {
  audit_id: string;
  request_id: string;
  analyte: string;
  at: number;
  old_value: number;
  new_value: number;
  old_version: number;
  new_version: number;
}

/** ingest_idempotency only: one row per distinct idempotency key (K9). */
export interface SourceEventRow {
  source_system: string;
  source_event_id: string;
  idempotency_key: string;
  received_at: number;
}

/**
 * A finding of a validation rule (data_model sections 2 and 8). `target` is `result:<result_id>`, `sample:<sample_id>` or
 * `source_event:<source_event_id>`. `status` is the state of the finding itself: open until a reviewer resolves it (a no-op is resolved at once).
 * The recorder writes VR-008 only; the rules of record/validate.ts add the others.
 */
export interface ValidationFindingRow {
  rule: string;
  target: string;
  severity: "info" | "warning" | "error";
  action: "no-op" | "hold" | "quarantine" | "reject";
  status: "open" | "resolved";
}

/** ingest_idempotency only: an incoming row with a known idempotency key and other content. It is not loaded and the original stays; S2b's VR-008b reads this list. */
export interface IngestConflictRow extends SourceEventRow {
  request_id: string;
  analyte: string;
  run_id: string;
  value: number;
  measured_at: number;
}

export interface BatchRow {
  batch_id: string;
  unit_id: string;
  inoculated_at: number;
  harvested_at: number | null;
  /** Break-out only, material_lot_links only (data_model 15.6, K17): the seed lot of the inoculation, as a key; null with the flag off. Absent without a break-out block. */
  seed_lot_id?: string | null;
}

export interface ProcessEventRow {
  event_id: string;
  batch_id: string;
  unit_id: string;
  kind: string;
  occurred_at: number;
  amount: number | null;
  source: string;
  ingested_at: number;
  /** Break-out only, material_lot_links only: the medium lot of a `medium_addition`, as a key; null otherwise. Absent without a break-out block. */
  lot_id?: string | null;
  /** Break-out only, equipment_links only: the equipment item of an `equipment_use`, as a key; null otherwise. Absent without a break-out block. */
  equipment_id?: string | null;
}

/**
 * A historian row: a tag, its valid time `ts`, the value, and when the system received it (data_model section 2). With the raw layer on and a parsed controller log the tag is
 * `unit_tag.signal.role` (data_model 16.4), `ingested_at` is the file's `received_at`, and `raw_ref` points to the line (data_model 16.2).
 */
export interface HistorianRow {
  tag: string;
  ts: number;
  value: number;
  quality: string;
  ingested_at: number;
  raw_ref?: { raw_file_id: string; line_no: number } | null;
}

export interface RecordedDataset {
  architecture: Pick<Architecture, "id" | "flags" | "labelling">;
  /** Raw layer only: the capture path of this dataset. Absent with the layer off. */
  capture?: { path: CapturePath };
  /** adapter_ingest only (data_model section 16.1): the adapter registry rows and the files, lines and dead letters of what was parsed. */
  raw?: RawTables;
  sample: SampleRow[];
  analysis_request: AnalysisRequestRow[];
  run: RunRow[];
  instrument_state: InstrumentStateRow[];
  result: ResultRow[];
  audit_event: AuditEventRow[];
  /** audit_trail only: the qualification records given to the recorder. */
  qualification: QualificationInput[];
  source_event: SourceEventRow[];
  validation_finding: ValidationFindingRow[];
  ingest_conflict: IngestConflictRow[];
  batch: BatchRow[];
  process_event: ProcessEventRow[];
  /** The five tables below exist only when the recorder was given break-out master data (`RecorderInput.breakout`); absent, not empty, without a break-out block. */
  material_lot?: MaterialLotRow[];
  equipment?: EquipmentRow[];
  lineage_edge?: LineageEdgeRow[];
  deviation?: DeviationRow[];
  quality_hold?: QualityHoldRow[];
  historian: {
    /** The online series, kept columnar like the engine's (about 1.4 million values for the default scenario). A tick is a row with tag `unit.signal`, `ts` = its stamp and `ingested_at` = `ts`. */
    series: readonly ObservableSensorSeries[];
    /** Rows that arrived later than their valid time: a corrected or late value (data_model section 5). Empty from the recorder; ingest layers add to it. */
    late: HistorianRow[];
  };
}

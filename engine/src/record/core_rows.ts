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
  qc_outcome: "qc_passed" | "qc_failed" | "over_range" | "over_range_unresolved" | null;
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


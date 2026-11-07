// The lineage view (lab_ui.md section 8). A field the record does not store is null; an edge whose key is null has `to: null`.
export interface LineageField {
  name: string;
  value: string | number | null;
  /** True on the value of a result that has none in the record: a run over range at the last dilution (simulation_spec section 2.3). Its null is a stored fact, not a column the record lacks. */
  no_value?: true;
}
export interface LineageNode {
  id: string;
  table: string;
  key: string;
  fields: LineageField[];
}
export interface LineageEdge {
  from: string;
  to: string | null;
  relation: string;
  basis?: "sampled_at" | "measured_at";
}
export type Verdict = "correct" | "wrong" | "unanswerable";
/** One record's rows for one sample, with no truth and no verdict (the drill-down of the challenge). */
export interface SampleRecord {
  architecture: string;
  flags_on: string[];
  labelling: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}
export interface LineageColumn extends SampleRecord {
  answers: { question: "unit" | "sampled_at" | "process_context"; answer: unknown; verdict: Verdict }[];
  realised_errors: { type: string; detail: Record<string, string | number> }[];
}
export interface LineageView {
  sample: { sample_id: string; unit_id: string; picked_by: "sc3_rule" | "reader" | "challenge" };
  truth: { unit_id: string; sampled_at: number; context: { feed_epoch: number; batch_phase: string } };
  columns: LineageColumn[];
}

/**
 * The truth overlay of the plant (docs/design/plant_ui.md sections 3.3 and 6, rule 8), the answer of `plant_truth`: for a sample the lineage view's truth column and, for each hall built, its three answers
 * with their verdicts and the errors the injector materialised on the sample; for the halls the placeholders, the planned samples (an index into the plan's `samples`) a hall holds no card for.
 * It is the only message that carries a verdict, a materialised error or an absence.
 */
export interface TruthPlaceholder {
  sample: number;
  why: "skipped" | "not_recorded";
}
export type TruthOverlay =
  | { kind: "sample"; sample: LineageView["sample"]; truth: LineageView["truth"]; columns: Pick<LineageColumn, "architecture" | "answers" | "realised_errors">[] }
  | { kind: "halls"; halls: { architecture: string; placeholders: TruthPlaceholder[] }[] }
  // P7b, a break-out case only: the event as the Break-out screen prints it, and the units it reached with the instant each became contaminated (an index into the plan's `units`)
  | { kind: "breakout"; event: BreakoutResult["event"]; affected: { unit: number; onset_s: number }[] };

// The challenge (lab_ui.md section 9). A record is what the reader searches; a reveal exists only after the guess or the give-up.
export interface RecordView {
  architecture: string;
  flags_on: string[];
  samples: { sample_id: string; unit_id: string; batch_id: string | null; sampled_at: number | null; planned_at: number | null; state: string | null }[];
  results: { request_id: string; analyte: string; version: number; value: number; measured_at: number; available_at: number | null; state: string | null }[];
  findings: { rule: string; target: string; severity: string; status: string }[];
  audit_events: { audit_id: string; request_id: string; analyte: string; at: number; old_value: number | null; new_value: number | null; old_version: number; new_version: number }[];
  /** The structural error types the record carries on every sample: never scored `background`, named once on the screen. */
  ubiquitous: string[];
}
export interface DecisionRecordView {
  architecture: string;
  flags_on: string[];
  samples: (RecordView["samples"][number] & { container: string | null; hold_s: number | null })[];
  decisions: {
    decision_id: string;
    unit_id: string;
    t: number;
    action: "readjust" | "skip" | "none";
    read: { filed_under: string; measured_at: number; value: number; container: string | null; hold_s: number | null; state: string | null } | null;
    onto: number | null;
    reason: "known_bias" | null;
  }[];
  findings: RecordView["findings"];
}
export interface Score {
  result: "hit" | "background" | "miss";
  background_type?: string;
}
export interface Reveal {
  planted: { type: string; affected: string[]; detail: Record<string, string | number> };
  /** Null after a give-up. */
  score: Score | null;
  per_architecture: { architecture: string; outcome: "prevented" | "invisible" | "detected"; evidence: string[]; reading: string; decision_same?: boolean }[];
  lineage: LineageView;
  decisions?: {
    affected: string[];
    rows: { decision_id: string; read_as: string; from_sample: string; value: number; record: { container: string | null; hold_s: number | null }; truth: { container: string; hold_s: number } }[];
  };
}

// The Break-out screen (lab_ui.md sections 3 and 20). A case is one of the five bundled SC12 scenarios; the result is built from the report of the experiment over this one seed, so a status, a
// denominator and a reason are the report's own words (engine strings, shown verbatim in a lang="en" element).
export interface BreakoutOffer {
  cases: { id: string; event_type: string; origin_kind: string }[];
  /** The seed list of the SC12 config (A103). */
  seed_list: number[];
  /** The flags that decide what direction 3 can read: lots and the seed parent, and equipment. */
  needs: { lots: string; equipment: string };
}
export interface BreakoutInput {
  name: string;
  ref: string;
  value: number;
  unit: string;
  source: "scenario_input" | "profile_default" | "decision_setting";
  what: string;
}
export interface BreakoutUse {
  unit_id: string;
  at_h: number;
}
export interface BreakoutRow {
  metric: string;
  status: "reported" | "none_occurred" | "not_reachable";
  value: number | null;
  num: number | null;
  den: number | null;
  denominator: string | null;
  reason: string | null;
}
export interface BreakoutWalkItem {
  kind: string;
  id: string;
  path: string;
}
export interface BreakoutInvestigationEvent {
  type: "hold_placed" | "hold_quarantined" | "hold_released" | "hold_rejected" | "result_reflagged" | "deviation_closed";
  t: number;
  hold_id?: string;
  target_kind?: string;
  target_id?: string;
  result_id?: string;
  deviation_id?: string;
}
export type BreakoutObserved =
  | { type: "signal_observed"; t: number; unit_id: string; signal: string; limit: string }
  | { type: "deviation_opened"; t: number; deviation_id: string; unit_id: string }
  | { type: "unit_stopped"; t: number; unit_id: string }
  | { type: "confirm_sample_drawn"; t: number; sample_id: string; unit_id: string; tests: string[] }
  | { type: "confirm_result"; t: number; sample_id: string; test: string; outcome: "detected" | "not_detected" };
export interface BreakoutArchitecture {
  architecture: string;
  reach: { direction3: boolean; lots: boolean; equipment: boolean };
  walk: { estimated_onset: number; decision_at: number; direction_1: BreakoutWalkItem[]; direction_3: BreakoutWalkItem[] | null };
  events: BreakoutInvestigationEvent[];
  rows: BreakoutRow[];
  not_evaluable: { rule: string; reason: string }[];
}
export interface BreakoutResult {
  kind: "simulation_result";
  case: string;
  scenario: string;
  seed: number;
  engine_version: string;
  architectures: string[];
  truth_log_hash: string;
  event: { type: string; profile: string; origin_kind: string; origin_id: string; horizon_days: number; horizon_ref: string; contaminated_at: { value: number; unit: string; ref: string } | null };
  inputs: BreakoutInput[];
  topology: {
    ref: string;
    lots: { lot_id: string; kind: string; units: string[]; prepared_at_h: number; uses: BreakoutUse[] }[];
    equipment: { equipment_id: string; name: string; units: string[]; uses: BreakoutUse[] }[];
  };
  observed: BreakoutObserved[];
  needs: { lots: string; equipment: string };
  /** The sentence of the author's ruling on C29 for the mycoplasma type; null for the other types. */
  c29: string | null;
  per_architecture: BreakoutArchitecture[];
}

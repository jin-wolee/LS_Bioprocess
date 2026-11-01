import type { ExperimentReport } from "../engine/src/generated/experiment_report.schema";

// The messages between the page and the Worker (docs/design/lab_ui.md section 4). Plain data only (structuredClone-safe): no function, no class instance, no truth.
// Types only: the page imports this file for its shapes and the Worker implements it. S3b built the start-up messages and the `run` request in its Home form; S3c's Setup batch adds
// the full `ready`, the full `run` (architectures, seeds, the two profile lists, the capture path), `progress` and `cancel`. S3e adds `lineage` and the `challenge_*` requests with their
// answers. S3g adds `breakout` and `breakout_result` (the Break-out screen). The page imports no engine module, so the shapes of the views are declared here and the Worker's plain data is assignable to them.

export type CapturePath = "manual_transcription" | "adapter_ingest";

export interface RunSpec {
  schema_version: "1";
  scenario: string;
  /** Replaces only the `value` of named scenario settings; unit and ref stay. */
  settings: Record<string, number>;
  /** One bioreactor profile id per bay, bay 1 first (spec section 4.5.2); absent: every bay takes the scenario's own. */
  bay_profiles?: string[];
  /** One analyzer profile id per analyzer, analyzer 1 first; absent: every analyzer takes the scenario's own. */
  analyzer_profiles?: string[];
  /** Overrides the capture path of every preset and turns the raw layer on. */
  capture_path?: CapturePath;
  architectures: string[];
  seeds: number[];
}

/** page -> Worker */
export type Request =
  | { type: "run"; id: number; spec: RunSpec }
  | { type: "cancel"; id: number }
  | { type: "lineage"; id: number; spec: RunSpec; seed: number; pick: { rule: "sc3" } | { sample_id: string } }
  | { type: "challenge_start"; id: number; variant: ChallengeVariant; spec: RunSpec; seed: number; shown: string }
  | { type: "challenge_open"; id: number; challenge: string; sample_id: string }
  | { type: "challenge_guess"; id: number; challenge: string; target: { sample_id: string } | { decision_id: string } }
  | { type: "challenge_giveup"; id: number; challenge: string }
  | { type: "breakout"; id: number; case: string; architectures: string[]; seed: number }
  | { type: "plant_run"; id: number; epoch: number; spec: PlantSpec };

export type ChallengeVariant = "sample" | "decision";

// The plant (docs/design/plant_ui.md sections 4.1, 5 and 6). `PlantSpec.run.architectures` is the set of record halls; `run.seeds` is ignored (a plant run is one seed). An action is plain data that
// says what the reader did and when, in the units of the run; the page of P3 sends none, the action bar (P6) sends them. The shapes below are the Worker's plain data (engine/src/experiments/
// assembly/lab/actions.ts and plant_plan.ts), declared here because the page imports no engine module; engine/tests/lab/plant_types.test.ts compares them with the engine's.
export type PlantAction =
  | { kind: "add_feed"; at: number; unit_id: string }
  | { kind: "raise_alarm"; at: number; unit_id: string }
  | { kind: "move_draw"; at: number; sample_id: string; to: number }
  | { kind: "analyzer_down"; at: number; analyzer: string; from: number; length_min: number }
  | { kind: "change_lot"; at: number; analyzer: string; effective: number }
  | { kind: "set_flag"; at: number; architecture: string; flag: string; on: boolean }
  | { kind: "set_capture_path"; at: number; path: CapturePath }
  | { kind: "set_labelling"; at: number; method: "handwritten" | "preprinted_barcode" | "issued_at_draw" };

export interface PlantSpec {
  run: RunSpec;
  seed: number;
  actions: PlantAction[];
}

export type RefusalReason = "past" | "unknown_target" | "outside_window" | "closed_loop" | "limit";

export interface PlanVisit {
  analyzer: number;
  queued_s: number;
  started_s: number;
  run_started_s: number;
  ended_s: number;
  attempt: number;
  qc: string | null;
  setup_s: number;
  diluted: boolean;
}

export interface PlanSlot {
  name: "unit" | "sampled_at" | "context" | "value";
  stored: boolean;
  basis?: "sampled_at" | "measured_at";
}

export interface PlanCard {
  sample: number;
  shown_s: number;
  available_s: number | null;
  slots: PlanSlot[];
  findings: string[];
  versions: number;
}

/** What the page draws of one seed: integer seconds of the run, indices into the arrays of the same plan, no hidden field and no value of a result. */
export interface ScenePlan {
  schema_version: "1";
  seed: number;
  horizon_s: number;
  layout: { bays: { size: number; profile: string }[]; analyzers: { profile: string; group: string }[]; architectures: string[] };
  units: { id: string; bay: number; slot: number; profile: string; batch: string | null; start_s: number | null; end_s: number | null }[];
  analyzers: { id: string; profile: string; group: string }[];
  staff: { id: string; on_duty: [number, number][] }[];
  samples: { id: string; unit: number; operator: number | null; planned_s: number; drawn_s: number | null; arrived_s: number | null; label: string | null; kind: "routine" | "confirm"; skipped: boolean; visits: PlanVisit[] }[];
  marks: { t: number; unit: number; kind: string; source: "rule" | "scheduled" | "scripted" | null; item: string | null }[];
  windows: { analyzer: number; kind: "qc" | "maintenance" | "closed"; from_s: number; to_s: number }[];
  calibrations: { analyzer: number; t: number }[];
  records: { architecture: string; flags_on: string[]; cards: PlanCard[] }[];
}

export type CheckState = "pending" | "identical" | "failed" | "error";

export interface CheckDetail {
  /** The five timed runs of seed 1 (lab_ui.md section 12). */
  runs_ms: number[];
  /** The strict log hash against the reference, seeds 1 to 3. */
  truth: { seed: number; equal: boolean }[];
  /** The five repeats of seed 1 agree. */
  repeats_equal: boolean;
  /** The digest of the metric cells of seed 1 under A, B and C equals the reference. */
  cells_equal: boolean;
  /** Only in the state `error`. */
  reason?: string;
}

/** A parameter as the scenario files give it (ADR-0012); `ref` is an A### or S### of the ledgers. */
export interface RefValue {
  name: string;
  value: number | string;
  unit: string;
  ref: string;
}

export interface ScenarioInfo {
  id: string;
  description: string;
  settings: RefValue[];
  profiles: Record<string, string>;
}

/** One entry of the profile catalogue (spec section 4.5.6): `bundle` is the profile file's own field (A065 to A073); its grade comes from the ledger view. */
export interface ProfileInfo {
  kind: "bioreactor" | "analyzer" | "staff";
  id: string;
  bundle: string;
  description: string;
  /** Analyzer profiles only. */
  stages?: { group: string; analytes: string[] }[];
}

/** A preset (A, B, C) or an ablation of C (C with one flag off), with its flags. */
export interface PresetInfo {
  id: string;
  role: "preset" | "ablation";
  ablated_flag: string | null;
  flags: Record<string, boolean>;
  labelling: string;
  capture_path: string | null;
}

/** The count of events by type of one run, as tests/golden/*.summary.json states it. */
export interface RunSummary {
  events: number;
  event_counts: Record<string, number>;
}

/** The median and the spread across seeds of one figure of the utilisation of an analyzer profile (spec section 4.5.6). */
export interface UtilisationRow {
  window: "staffed" | "24h";
  setup: "with" | "without";
  n_defined: number;
  median: number | null;
  lo: number | null;
  hi: number | null;
  denominator: string;
}

export interface UtilisationView {
  by_profile: { profile: string; instruments: number; rows: UtilisationRow[] }[];
}

export interface ResultFooter {
  kind: "simulation_result";
  scenario: string;
  seeds: number[];
  engine_version: string;
  architectures: string[];
  /** The inputs the result used: the inputs of the metrics, the settings the reader changed, the zone of the raw layer when a capture path is named. */
  inputs: RefValue[];
  bay_profiles?: string[];
  analyzer_profiles?: string[];
  capture_path?: CapturePath;
  /** The state of the browser check when the result was made; `pending` is re-labelled by the page when the check message arrives. */
  check: CheckState;
}

export type ErrorCode = "invalid_spec" | "engine_error" | "cancelled" | "locked" | "refused";

// The lineage view (lab_ui.md section 8). A field the record does not store is null; an edge whose key is null has `to: null`.
export interface LineageField {
  name: string;
  value: string | number | null;
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

// The challenge (lab_ui.md section 9). A record is what the reader searches; a reveal exists only after the guess or the give-up.
export interface RecordView {
  architecture: string;
  flags_on: string[];
  samples: { sample_id: string; unit_id: string; batch_id: string | null; sampled_at: number | null; planned_at: number | null; state: string | null }[];
  results: { request_id: string; analyte: string; version: number; value: number; measured_at: number; available_at: number | null; state: string | null }[];
  findings: { rule: string; target: string; severity: string; status: string }[];
  audit_events: { audit_id: string; request_id: string; analyte: string; at: number; old_value: number; new_value: number; old_version: number; new_version: number }[];
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

/** Worker -> page */
export type Response =
  | {
      type: "ready";
      engine_version: string;
      schema_version: "1";
      flags: string[];
      min_seeds: number;
      seed_list: number[];
      scenarios: ScenarioInfo[];
      profiles: ProfileInfo[];
      presets: PresetInfo[];
      evaluation: RefValue[];
      challenge_variants: ChallengeVariant[];
      decision_seed_list: number[];
      challenge_records: { id: string; sample: boolean; decision: boolean }[];
      /** Null when the build bundles no break-out data: the public build while a source of the screen is below main-reread. */
      breakout: BreakoutOffer | null;
    }
  | { type: "check"; state: CheckState; detail: CheckDetail }
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "result"; id: number; summary?: RunSummary; report?: ExperimentReport; utilisation?: UtilisationView; footer: ResultFooter }
  | { type: "lineage"; id: number; view: LineageView; sample_ids: string[] }
  | { type: "challenge_ready"; id: number; challenge: string; announced_type: string; record: RecordView | DecisionRecordView; inputs: RefValue[] }
  | { type: "sample_record"; id: number; sample: SampleRecord }
  | { type: "challenge_reveal"; id: number; reveal: Reveal }
  | { type: "breakout_result"; id: number; result: BreakoutResult }
  | { type: "plant_ready"; id: number; epoch: number; plan: ScenePlan; resume_at: number; hashes: { truth: string; cells: Record<string, string> }; checks: { prefix_equal: boolean | null; truth_equal: boolean | null } }
  /** `epoch` is echoed on every error of a plant request (the page drops the error of an older epoch); `reason` and `index` come with `refused` only. */
  | { type: "error"; id: number | null; code: ErrorCode; message: string; epoch?: number; reason?: RefusalReason; index?: number };

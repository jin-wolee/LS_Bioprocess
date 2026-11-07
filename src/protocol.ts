import type { CapturePath, RunSpec } from "./protocol_spec.ts";
import type { PlantAction, PlantCaseSpec, PlantSpec, RefusalReason, ScenePlan } from "./protocol_plant.ts";
import type { BreakoutOffer, BreakoutResult, DecisionRecordView, LineageView, RecordView, Reveal, SampleRecord, TruthOverlay } from "./protocol_views.ts";
export type * from "./protocol_spec.ts";
export type * from "./protocol_plant.ts";
export type * from "./protocol_views.ts";
import type { ExperimentReport } from "../engine/src/generated/experiment_report.schema";

// The messages between the page and the Worker (docs/design/lab_ui.md section 4). Plain data only (structuredClone-safe): no function, no class instance, no truth.
// Types only: the page imports this file for its shapes and the Worker implements it. S3b built the start-up messages and the `run` request in its Home form; S3c's Setup batch adds
// the full `ready`, the full `run` (architectures, seeds, the two profile lists, the capture path), `progress` and `cancel`. S3e adds `lineage` and the `challenge_*` requests with their
// answers. S3g adds `breakout` and `breakout_result` (the Break-out screen). The page imports no engine module, so the shapes of the views are declared here and the Worker's plain data is assignable to them.

/** page -> Worker */
export type Request =
  // `actions` (P6b, lab_ui.md section 22): the plant's actions that name a unit or an analyzer, applied to every seed; absent or empty, the run is as before
  | { type: "run"; id: number; spec: RunSpec; actions?: PlantAction[] }
  | { type: "cancel"; id: number }
  // U2 (lab_ui.md section 4): the analyzer list as Setup holds it, checked by the engine's own check of the two lists (engine/src/fleet.ts); it runs nothing and is answered at once
  | { type: "fleet_check"; id: number; scenario: string; analyzers: string[] }
  // `actions` (P5c, plant_ui.md section 6, rule 9): the operator actions of the plant the view was opened from; absent or empty, the answer is as before
  | { type: "lineage"; id: number; spec: RunSpec; seed: number; pick: { rule: "sc3" } | { sample_id: string }; actions?: PlantAction[] }
  | { type: "challenge_start"; id: number; variant: ChallengeVariant; spec: RunSpec; seed: number; shown: string }
  | { type: "challenge_open"; id: number; challenge: string; sample_id: string }
  | { type: "challenge_guess"; id: number; challenge: string; target: { sample_id: string } | { decision_id: string } }
  | { type: "challenge_giveup"; id: number; challenge: string }
  | { type: "breakout"; id: number; case: string; architectures: string[]; seed: number; actions?: PlantAction[] }
  // `spec` (P7b, plant_ui.md section 6, rule 11): the run form, or a break-out case, told apart by its `case` key
  | { type: "plant_run"; id: number; epoch: number; spec: PlantSpec | PlantCaseSpec }
  | { type: "plant_record"; id: number; epoch: number; architecture: string; sample_id: string }
  // the picks the plant offers (plant_ui.md section 6, rule 8): a pick of a unit waits and the Worker refuses it as `invalid_spec`; `{ breakout: true }` (P7b) is answered for a break-out case only
  | { type: "plant_truth"; id: number; epoch: number; pick: { sample_id: string } | { halls: true } | { breakout: true } };

export type ChallengeVariant = "sample" | "decision";

// The problems of an analyzer list (U2): the shape of `fleetProblems` in engine/src/fleet.ts, declared here because the page imports no engine module; engine/tests/lab/fleet_check.test.ts compares them.
// A seat is an analyzer by its place in the list (the position of the first appearance of its profile, analyzer 1 first); `unmeasured` names the profile that is the menu of the scenario.
export interface FleetSeat {
  profile: string;
  analyzer: number;
}
export type FleetProblem =
  | { kind: "shared_group"; group: string; first: FleetSeat; second: FleetSeat }
  | { kind: "shared_analyte"; analyte: string; first: FleetSeat; second: FleetSeat }
  | { kind: "unmeasured"; analyte: string; menu: string };

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
  /** The operator actions the run used, in the canonical order (P6b); absent when there were none. */
  actions?: PlantAction[];
  bay_profiles?: string[];
  analyzer_profiles?: string[];
  capture_path?: CapturePath;
  /** The state of the browser check when the result was made; `pending` is re-labelled by the page when the check message arrives. */
  check: CheckState;
}

export type ErrorCode = "invalid_spec" | "engine_error" | "cancelled" | "locked" | "refused";

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
  // U2: the answer to `fleet_check`, the id echoed; empty `problems` means the engine would load this list
  | { type: "fleet_checked"; id: number; problems: FleetProblem[] }
  | { type: "result"; id: number; summary?: RunSummary; report?: ExperimentReport; utilisation?: UtilisationView; footer: ResultFooter }
  // `key` (audit A1, F7; lab_ui.md section 4, rule 2): the key of the truth of the run, its actions stripped; the page empties what it holds of a run whose key a challenge answers with
  | { type: "lineage"; id: number; view: LineageView; sample_ids: string[]; key: string }
  | { type: "challenge_ready"; id: number; challenge: string; announced_type: string; record: RecordView | DecisionRecordView; inputs: RefValue[]; key: string }
  | { type: "sample_record"; id: number; sample: SampleRecord }
  | { type: "challenge_reveal"; id: number; reveal: Reveal }
  | { type: "breakout_result"; id: number; result: BreakoutResult }
  /** The truth run and the record of the first architecture of the spec: `plan.records` holds that one hall and `hashes.cells` its digest. The others follow as `plant_halls`. */
  | { type: "plant_ready"; id: number; epoch: number; plan: ScenePlan; resume_at: number; hashes: { truth: string; cells: Record<string, string> }; checks: { prefix_equal: boolean | null; truth_equal: boolean | null }; key: string }
  /** One hall that was not ready with `plant_ready`, in the order of the spec: its record for the plan and the digest of its metric cells. A newer epoch cancels the halls still pending. */
  | { type: "plant_halls"; id: number; epoch: number; records: ScenePlan["records"]; cells: Record<string, string> }
  /** The rows one architecture holds for one card, from the run the Worker keeps for the epoch: the record of the lineage view, with no truth and no verdict. */
  | { type: "plant_record_view"; id: number; epoch: number; sample: SampleRecord }
  /** What the simulation knows and no record can hold, asked for on the reader's switch only (the truth overlay); refused with `locked` while a challenge is open on the same run. */
  | { type: "plant_truth_view"; id: number; epoch: number; view: TruthOverlay }
  /** `epoch` is echoed on every error of a plant request (the page drops the error of an older epoch); `reason` and `index` come with `refused` only. */
  | { type: "error"; id: number | null; code: ErrorCode; message: string; epoch?: number; reason?: RefusalReason; index?: number };

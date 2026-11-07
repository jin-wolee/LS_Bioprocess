import type { CapturePath, RunSpec } from "./protocol_spec.ts";

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

/** The break-out form of the plant's spec (P7b): one of the five SC12 cases of `ready.breakout`, the record halls (the architectures the Break-out screen offers), one seed and the operator actions. */
export interface PlantCaseSpec {
  case: string;
  architectures: string[];
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

export interface PlanFinding {
  rule: string;
  raised_s: number;
}

export interface PlanCard {
  sample: number;
  shown_s: number;
  available_s: number | null;
  slots: PlanSlot[];
  findings: PlanFinding[];
  version_s: number[];
}

/** What a record's investigation did (P7b): the six events of the Break-out screen; `on` and `target` index into the plan's `units`, `lots`, `equipment` or `samples`, and are null for `deviation_closed`. */
export interface PlanHold {
  t: number;
  event: "hold_placed" | "hold_quarantined" | "hold_released" | "hold_rejected" | "result_reflagged" | "deviation_closed";
  on: "unit" | "lot" | "equipment" | "sample" | null;
  target: number | null;
}

/** What the page draws of one seed: integer seconds of the run, indices into the arrays of the same plan, no hidden field and no value of a result. */
export interface ScenePlan {
  schema_version: "1";
  seed: number;
  horizon_s: number;
  layout: { bays: { size: number; profile: string }[]; analyzers: { profile: string; group: string }[]; architectures: string[]; items?: { lots: string[]; equipment: string[] } };
  units: { id: string; bay: number; slot: number; profile: string; batch: string | null; start_s: number | null; end_s: number | null }[];
  analyzers: { id: string; profile: string; group: string }[];
  staff: { id: string; on_duty: [number, number][] }[];
  samples: { id: string; unit: number; operator: number | null; planned_s: number; drawn_s: number | null; arrived_s: number | null; label: string | null; kind: "routine" | "confirm"; skipped: boolean; visits: PlanVisit[] }[];
  marks: { t: number; unit: number; kind: string; source: "rule" | "scheduled" | "scripted" | null; item: string | null }[];
  windows: { analyzer: number; kind: "qc" | "maintenance" | "closed"; from_s: number; to_s: number }[];
  calibrations: { analyzer: number; t: number }[];
  records: { architecture: string; flags_on: string[]; cards: PlanCard[]; holds?: PlanHold[] }[];
  /** A break-out case only (P7b, plant_ui.md section 4.1): the lots and equipment items its events name, with the units and instants that take them, and the results of the confirming tests. */
  lots?: { id: string; kind: "seed" | "medium"; uses: { unit: number; t: number }[] }[];
  equipment?: { id: string; uses: { unit: number; t: number }[] }[];
  confirms?: { sample: number; test: string; result_s: number; outcome: "detected" | "not_detected" }[];
}


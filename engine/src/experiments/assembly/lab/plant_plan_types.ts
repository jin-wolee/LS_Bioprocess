import type { PlanRecord } from "./plant_records.ts";

export interface LayoutSpec {
  bays: { size: number; profile: string }[];
  /** In the order of the plan's `analyzers`. */
  analyzers: { profile: string; group: string }[];
  architectures: string[];
  /** A break-out case only (P7b): the ids of the plan's lots and equipment items, in the order of the plan, which is where the rack and the stations take their places (plant_ui.md section 3.1). */
  items?: { lots: string[]; equipment: string[] };
}

export interface PlanVisit {
  analyzer: number;
  queued_s: number;
  started_s: number;
  run_started_s: number;
  ended_s: number;
  attempt: number;
  qc: string | null;
  setup_s: number;
  /** A `dilution_applied` event for this visit: the mark on the tube. The factor is not in the plan. */
  diluted: boolean;
}

/** A unit and the instant it takes a lot or an equipment item: the inoculation for a seed lot, a `medium_addition` or an `equipment_use` for the others. */
export interface PlanUse {
  unit: number;
  t: number;
}

export interface PlanLot {
  id: string;
  kind: "seed" | "medium";
  uses: PlanUse[];
}

export interface PlanEquipment {
  id: string;
  uses: PlanUse[];
}

/** The result of one confirming test (`confirm_result`): the confirming sample (an index into `samples`), the test, the instant and the outcome the lab reported. */
export interface PlanConfirm {
  sample: number;
  test: string;
  result_s: number;
  outcome: "detected" | "not_detected";
}

export interface ScenePlan {
  schema_version: "1";
  seed: number;
  horizon_s: number;
  layout: LayoutSpec;
  units: { id: string; bay: number; slot: number; profile: string; batch: string | null; start_s: number | null; end_s: number | null }[];
  analyzers: { id: string; profile: string; group: string }[];
  staff: { id: string; on_duty: [number, number][] }[];
  samples: { id: string; unit: number; operator: number | null; planned_s: number; drawn_s: number | null; arrived_s: number | null; label: string | null; kind: "routine" | "confirm"; skipped: boolean; visits: PlanVisit[] }[];
  marks: { t: number; unit: number; kind: string; source: "rule" | "scheduled" | "scripted" | null; item: string | null }[];
  windows: { analyzer: number; kind: "qc" | "maintenance" | "closed"; from_s: number; to_s: number }[];
  /** The instants of `calibration_recorded` on each analyzer, once for each (analyzer, instant), by instant and then analyzer: the card on the analyzer. The drift is hidden and not in the plan. */
  calibrations: { analyzer: number; t: number }[];
  records: PlanRecord[];
  /** The three keys below are present in the plan of a break-out case and in no other (P7b). */
  lots?: PlanLot[];
  equipment?: PlanEquipment[];
  confirms?: PlanConfirm[];
}

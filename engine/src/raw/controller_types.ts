import type { ControllerProfile } from "../generated/controller_profile.schema";

// Plain data of the controller side of the raw device layer (spec 2.4.2 and 2.4.4; data_model 16.4). Nothing here reads truth, the answer key or a file: the emitter gets tag
// series, rows and transitions that the assembly built from observable data (or that a test typed by hand), and a controller profile.

export type { ControllerProfile };

export type TagRole = "PV" | "SP" | "OUT";

/** A tag sampled on the cadence grid: the value at tick j is stamped t0_s + j * cadence_s. */
export interface TagSeries {
  unit: string;
  signal: string;
  role: TagRole;
  t0_s: number;
  cadence_s: number;
  n: number;
  at: (j: number) => number;
}

/** One logged tag value (RQ9): the tag is unit, signal and role (A171). */
export interface TagRow {
  unit: string;
  signal: string;
  role: TagRole;
  ts: number;
  value: number;
}

/** One state change of one alarm instance (RQ10). `tag` is the watched signal and role (`pH.PV`); `actor` is the acknowledging user where the family writes one. */
export interface AlarmTransition {
  unit: string;
  alarm_id: string;
  tag: string | null;
  severity: number | null;
  from: string;
  to: string;
  ts: number;
  actor: string | null;
}

/** One state change of one phase instance (RQ11); the recipe, procedure, unit procedure and operation are the profile's phase model. */
export interface PhaseTransition {
  unit: string;
  batch: string;
  phase: string;
  from: string;
  to: string;
  ts: number;
}

/** One emitted file: the text, its name, the log it belongs to and the host instant it reaches the adapter. */
export interface ControllerFile {
  file_name: string;
  text: string;
  controller: string;
  profile_id: string;
  /** The `log` of the profile (`tag`, `alarm`, `phase`, `process_data`, ...). */
  log: string;
  /** The host clock when the file arrived (seconds of the scenario): the ingested_at of everything loaded from it. */
  received_at: number;
  rows: number;
}

/** The kind of rows a log of a controller profile holds. User events and errors are `unmodelled`: nothing in the model writes a row to them, so they have no file and no mapping. */
export type LogKind = "tag" | "alarm" | "phase" | "unmodelled";

export const logKindOf = (log: string): LogKind =>
  log === "tag" || log === "process_data" ? "tag" : log === "alarm" || log === "alarms" ? "alarm" : log === "phase" || log === "recipe_steps" ? "phase" : "unmodelled";

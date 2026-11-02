import { checkParams, param } from "../profiles.ts";
import type { Contrast } from "./effects.ts";

// Settings of the evaluation, as data with ledger refs (scenarios/evaluation/*.json). The engine reads no file: the caller passes the parsed JSON.

/** The clock windows the roster staffs (A201, read by the assembly from the scenario): a weekday from `start_s` to `end_weekday_s`, a weekend day from `start_s` to `end_weekend_s`. */
export interface StaffedRoster {
  start_s: number;
  end_weekday_s: number;
  end_weekend_s: number;
}

/** What the metrics need to know about the scenario and the settings. */
export interface EvalConfig {
  /** SLA threshold of the holding time (A097). */
  sla_s: number;
  /** The staffed windows of the roster (A098, A201): the denominator of utilisation per staffed window is their sum over the horizon (spec section 8). */
  roster: StaffedRoster;
  /** Horizon in days. */
  days: number;
  /** A group contrast for the phantom effect; absent when the scenario names none. */
  contrast?: Contrast;
}

export interface EvaluationSettings {
  sla_s: number;
  /** The default weekday window (A098). The denominator of utilisation reads the roster (`EvalConfig.roster`), which the default scenario sets to this window; a test keeps the two equal. */
  staffed_window_s: number;
  /** VR-010: the hold-time limit (A046). */
  hold_limit_s: number;
  /** Minimum seeds of a stochastic report (A103). */
  min_seeds: number;
}

export const evaluationSettings = (raw: unknown): EvaluationSettings => {
  const doc = raw as { schema_version?: string; params?: unknown } | null;
  if (!doc || doc.schema_version !== "1") throw new Error("evaluation settings: schema_version 1 expected");
  const params = checkParams(doc.params, "evaluation settings");
  return {
    sla_s: param(params, "sla_hold_threshold_min", "min") * 60,
    staffed_window_s: param(params, "staffed_window_h", "h") * 3600,
    hold_limit_s: param(params, "hold_limit_min", "min") * 60,
    min_seeds: param(params, "min_seeds", "seeds"),
  };
};

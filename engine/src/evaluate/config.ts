import { checkParams, param } from "../profiles.ts";
import type { Contrast } from "./effects.ts";

// Settings of the evaluation, as data with ledger refs (scenarios/evaluation/*.json). The engine reads no file: the caller passes the parsed JSON.

/** What the metrics need to know about the scenario and the settings. */
export interface EvalConfig {
  /** SLA threshold of the holding time (A097). */
  sla_s: number;
  /** The staffed window per day (A098). */
  staffed_window_s: number;
  /** Horizon in days. */
  days: number;
  /** A group contrast for the phantom effect; absent when the scenario names none. */
  contrast?: Contrast;
}

export interface EvaluationSettings {
  sla_s: number;
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

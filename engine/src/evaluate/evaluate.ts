import type { Metrics } from "../generated/metrics.schema";
import type { RecordedDataset } from "../record/types.ts";
import { parseKey } from "./answer_key.ts";
import { availability } from "./availability.ts";
import { attributable, misattribution } from "./attribution.ts";
import type { EvalConfig } from "./config.ts";
import { detection } from "./detection.ts";
import { phantomEffect, rerunTraceability } from "./effects.ts";
import { holdingTime, turnaround } from "./holding.ts";
import { lookupAll } from "./query.ts";
import { alignmentError, exactReconstruction } from "./reconstruction.ts";
import { factsOf } from "./truth.ts";
import type { Truth } from "./truth.ts";
import { utilisation } from "./utilisation.ts";

export interface EvalInput {
  truth: Truth;
  /** The recorded dataset of one architecture after the validation rules. */
  dataset: RecordedDataset;
  /** The rules the validation could not run on this dataset, with the reason. */
  not_evaluable: readonly { rule: string; reason: string }[];
  /** The text of the answer key file written by the assembly; this function is its only reader. */
  key_text: string;
  architecture: string;
  config: EvalConfig;
}

/**
 * The metrics of one (scenario, seed, architecture) cell: every metric of spec section 8, each with its denominator. The inputs are the
 * recorded dataset, the truth and the answer key; nothing is read from the recorder or the injector. There is no composite score: the
 * result is a list of separate metrics (spec section 8, anti-gaming rule 3 keeps detection metrics together).
 */
export const evaluate = (input: EvalInput): Metrics => {
  const { truth, dataset: ds, config } = input;
  const key = parseKey(input.key_text, input.architecture);
  const facts = factsOf(truth);
  const lookups = lookupAll(truth, ds, key);
  return {
    schema_version: "1",
    engine_version: key.engine_version,
    scenario_id: key.scenario_id,
    seed: key.seed,
    architecture: input.architecture,
    n_requests: truth.requests.length,
    metrics: {
      holding_time: holdingTime(truth, facts, config.sla_s),
      turnaround: turnaround(truth, facts),
      utilisation: utilisation(truth.events, { analyzers: truth.analyzers.length, days: config.days, staffed_window_s: config.staffed_window_s, ...(truth.analyzer_profiles && { profiles: truth.analyzer_profiles }) }),
      availability: availability(truth, facts, ds, key),
      misattribution: misattribution(truth, lookups),
      detection: detection(truth, ds, key, input.not_evaluable),
      exact_reconstruction: exactReconstruction(truth, facts, lookups),
      alignment_error: alignmentError(truth, facts, lookups),
      rerun_traceability: rerunTraceability(truth, facts, ds, key),
      attributable: attributable(truth, ds, key),
      phantom_effect: config.contrast ? phantomEffect(truth, ds, key, config.contrast) : null,
    },
  };
};

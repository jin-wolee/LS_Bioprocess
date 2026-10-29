import type { Contrast } from "../../evaluate/effects.ts";
import type { EvaluationSettings } from "../../evaluate/config.ts";
import type { Metrics } from "../../generated/metrics.schema";
import type { Params } from "../../profiles.ts";
import type { Architecture } from "../../record/architecture.ts";
import { runScenario } from "../../run.ts";
import type { ScenarioConfig } from "../../scenario.ts";
import type { ReviewTiming } from "../../record/review.ts";
import { ENGINE_VERSION, logHash } from "../../trace.ts";
import { rosterOf, seedInputFromRun } from "./from_run.ts";
import { runSeed } from "./run_seed.ts";

// Experiment 1, open loop (spec section 6.1): for each seed the truth is run once and shared by every architecture. Opportunities are common
// (inject/opportunities.ts keys them by seed and sample, never by architecture), detection only raises flags, and the truth log_hash is the same
// before and after all architectures: a step that re-drew or re-measured would change the shared truth, and the run stops with an error.

const DAY = 86400;

export interface OpenLoopInput {
  /** The parsed scenario; its own `seed` is replaced by each seed of the list. */
  scenario: ScenarioConfig;
  seeds: readonly number[];
  /** The staff profile of the samplers (A047 sets the label-error rate). */
  staff: Params;
  evaluation: EvaluationSettings;
  /** A, B, C and the ablations of C, in report order. */
  architectures: readonly Architecture[];
  contrast?: Contrast;
  clock_offsets?: Readonly<Record<string, number>>;
  /** Sensitivity variants of the review (A214, A215; reported, never gated). Default: the next shift start and no rule rejected beyond the policy. */
  review?: { timing?: ReviewTiming; reject_also?: readonly string[] };
}

/** The review settings a run used, as the report states them. */
export interface ReviewUsed {
  timing: ReviewTiming;
  reject_also: string[];
}

export interface SeedOutcome {
  seed: number;
  /** The hash of the truth log, taken before the first architecture; the same value was read again after the last one. */
  truth_log_hash: string;
  /** The text of the error answer key, written once for all architectures of the seed. */
  key_text: string;
  /** One per architecture, in the order of `architectures`. */
  cells: Metrics[];
}

export interface OpenLoopResult {
  scenario_id: string;
  engine_version: string;
  seeds: number[];
  review: ReviewUsed;
  outcomes: SeedOutcome[];
}

export const runOpenLoop = async (input: OpenLoopInput): Promise<OpenLoopResult> => {
  const outcomes: SeedOutcome[] = [];
  const review: ReviewUsed = { timing: input.review?.timing ?? "next_shift_start", reject_also: [...(input.review?.reject_also ?? [])] };
  for (const seed of input.seeds) {
    const run = runScenario({ ...input.scenario, seed });
    const truth_log_hash = await logHash(run.events);
    const out = runSeed(
      seedInputFromRun(run, {
        scenario_id: input.scenario.scenario_id, staff: input.staff, evaluation: input.evaluation, architectures: input.architectures,
        days: input.scenario.process.horizon_s / DAY,
        review: { roster: rosterOf(input.scenario.sampling), timing: review.timing, reject_also: review.reject_also },
        ...(input.contrast && { contrast: input.contrast }), ...(input.clock_offsets && { clock_offsets: input.clock_offsets }),
      }),
    );
    const after = await logHash(run.events);
    if (after !== truth_log_hash) throw new Error(`open loop: the truth log of seed ${seed} changed while the architectures were recorded (${truth_log_hash} before, ${after} after)`);
    outcomes.push({ seed, truth_log_hash, key_text: out.key_text, cells: out.cells });
  }
  return { scenario_id: input.scenario.scenario_id, engine_version: ENGINE_VERSION, seeds: [...input.seeds], review, outcomes };
};

import type { BreakoutConfig } from "../../breakout/config.ts";
import type { EvaluationSettings } from "../../evaluate/config.ts";
import { breakoutMetrics } from "../../evaluate/breakout_metrics.ts";
import type { BreakoutMetrics } from "../../evaluate/breakout_metrics.ts";
import type { Params } from "../../profiles.ts";
import type { Architecture } from "../../record/architecture.ts";
import { investigate, signalsOf } from "../../record/investigate/investigate.ts";
import type { Investigation, InvestigationConfig, Signal } from "../../record/investigate/investigate.ts";
import type { ReviewTiming } from "../../record/review.ts";
import type { RecordedDataset } from "../../record/types.ts";
import { runScenario } from "../../run.ts";
import type { ScenarioRun } from "../../run.ts";
import type { ScenarioConfig } from "../../scenario.ts";
import { ENGINE_VERSION, logHash } from "../../trace.ts";
import type { BreakoutCaseConfig } from "./breakout_config.ts";
import { rosterOf, seedInputFromRun } from "./from_run.ts";
import type { ReviewUsed } from "./open_loop.ts";
import { runSeed } from "./run_seed.ts";
import type { SeedInput } from "./run_seed.ts";

// Experiment SC12, the break-out event (spec 11.5, 11.8): for each case and seed the truth is run once and shared by every architecture. Each architecture records the events with the master data of
// the topology, validates and reviews as in experiment 1, and then the investigation walks back from the signal (rule S9, on the recorded side). The evaluator scores the result against `T`, the
// set of items the event truly touched, which it computes from the truth log (rule S10). The investigation raises holds and never re-draws or re-measures anything, so the truth log hash is the same
// before and after all architectures; a step that changed the truth stops the run with an error. Open loop only: the scripted response is part of the shared truth run.

const DAY = 86400;
const HOUR = 3600;

export interface BreakoutCase {
  case_id: string;
  /** The parsed scenario, with a break-out block; its own `seed` is replaced by each seed of the list. */
  scenario: ScenarioConfig;
  /** The assumed lag of the walk-back, a decision setting and not truth: the estimated onset is the first signal minus it (spec 11.4). */
  assumed_lag: {
    seconds: number;
    /** The ledger id of the lag of the event type (A139, A138) when the case sets none, else the id the case cites. */
    ref: string;
    /** True when the case sets it (a sweep over the ledger range); false when it is the default, the lag of the event type (rule S8). */
    swept: boolean;
  };
}

export interface BreakoutRunInput {
  cases: readonly BreakoutCase[];
  seeds: readonly number[];
  /** The staff profile of the samplers (A047 sets the label-error rate). */
  staff: Params;
  evaluation: EvaluationSettings;
  /** A, B, C and the ablations of C, in report order. */
  architectures: readonly Architecture[];
  /** The review of held rows (A214, A215): default the next shift start. */
  review?: { timing?: ReviewTiming; reject_also?: readonly string[] };
}

export interface BreakoutSeedOutcome {
  seed: number;
  /** The hash of the truth log, taken before the first architecture; the same value was read again after the last one. */
  truth_log_hash: string;
  /** One per architecture, in the order of `architectures`. */
  cells: BreakoutMetrics[];
}

export interface BreakoutCaseResult {
  case: BreakoutCase;
  outcomes: BreakoutSeedOutcome[];
}

export interface BreakoutResult {
  engine_version: string;
  seeds: number[];
  review: ReviewUsed;
  cases: BreakoutCaseResult[];
}

const fail = (c: Pick<BreakoutCase, "case_id">, why: string): never => {
  throw new Error(`break-out experiment, case ${c.case_id}: ${why}`);
};

/** The break-out block of a case, or an error: SC12 has no meaning without one. */
export const blockOf = (c: BreakoutCase): BreakoutConfig => c.scenario.breakout ?? fail(c, "the scenario has no breakout block");

/**
 * A case of the config with its scenario loaded (the caller reads the file, applies `patchScenario` and loads it). The assumed lag is the one the case sets, in hours, else the lag of the event
 * type (A139, A138), as rule S8 says; the lag the scenario gives the event is the truth and the walk-back does not know it (spec 11.8.12 C41, F7).
 */
export const breakoutCase = (c: BreakoutCaseConfig, scenario: ScenarioConfig): BreakoutCase => {
  const b = scenario.breakout ?? fail(c, "the scenario has no breakout block");
  if (c.assumed_lag === undefined) return { case_id: c.case_id, scenario, assumed_lag: { seconds: b.profile.lag_s, ref: b.profile.params.onset_to_signal_lag_h?.ref ?? "A139", swept: false } };
  if (c.assumed_lag.unit !== "h" || !(c.assumed_lag.value > 0)) fail(c, `assumed_lag must be above 0 and in hours, not ${c.assumed_lag.value} ${c.assumed_lag.unit}`);
  return { case_id: c.case_id, scenario, assumed_lag: { seconds: Math.round(c.assumed_lag.value * HOUR), ref: c.assumed_lag.ref, swept: true } };
};

/** The truth of one seed of a case, which every architecture shares: the run, the hash taken before the first architecture, the input of the recorders and the decision settings of the investigation. */
export interface BreakoutTruth {
  run: ScenarioRun;
  truth_log_hash: string;
  /** The input of `runSeed`, with the architectures the caller named; the plant records them one at a time by replacing `architectures`. */
  input: SeedInput;
  cfg: InvestigationConfig;
  /** The first signals of each affected unit, from the observable events. */
  signals: Signal[];
}

/** What one architecture does with the shared truth: its recorded dataset, its investigation from the first signal and its scored cell. */
export interface ArchitectureRun {
  dataset: RecordedDataset;
  investigation: Investigation;
  cell: BreakoutMetrics;
}

/** The first half of a seed (spec 11.8.14, C42): run the truth once and hash it, then make the inputs every architecture is handed. */
export const breakoutTruth = async (c: BreakoutCase, seed: number, input: Omit<BreakoutRunInput, "cases" | "seeds">, review: ReviewUsed): Promise<BreakoutTruth> => {
  const b = blockOf(c);
  const run = runScenario({ ...c.scenario, seed });
  const truth_log_hash = await logHash(run.events);
  const seedInput = seedInputFromRun(run, {
    scenario_id: c.scenario.scenario_id, staff: input.staff, evaluation: input.evaluation, architectures: input.architectures, days: c.scenario.process.horizon_s / DAY,
    review: { roster: rosterOf(c.scenario.sampling), timing: review.timing, reject_also: review.reject_also }, breakout: b,
  });
  // the decision settings of the investigation: the delays are the scenario's (A176), the assumed lag is the case's
  const cfg: InvestigationConfig = { decision_delay_s: b.signal_to_response_s, conclusion_delay_s: b.positive_to_hold_s, assumed_lag_s: c.assumed_lag.seconds, review: seedInput.review };
  return { run, truth_log_hash, input: seedInput, cfg, signals: signalsOf(seedInput.events) };
};

/** The second half (C42): for each architecture named, in that order, record it on the shared truth, investigate it from the first signal and score it. The architectures do not read each other. */
export const investigateArchitectures = (t: BreakoutTruth, architectures: readonly Architecture[]): ArchitectureRun[] => {
  const out = runSeed({ ...t.input, architectures });
  return architectures.map((a) => {
    const dataset = out.datasets[a.id] as RecordedDataset;
    const investigation = investigate(dataset, t.signals, t.cfg);
    return { dataset, investigation, cell: breakoutMetrics({ truth: t.input.truth, investigation, key_text: out.key_text, architecture: a.id }) };
  });
};

/** One seed of a case in full: the outcome the experiment keeps, and what the lab screen shows besides it (the walk-back and the holds), which the cells reduce. */
export interface BreakoutSeedRun {
  outcome: BreakoutSeedOutcome;
  /** The events of the truth run of the seed. */
  events: SeedInput["events"];
  /** One per architecture, in the order of `architectures`. */
  investigations: Investigation[];
}

export const investigateBreakoutSeed = async (c: BreakoutCase, seed: number, input: Omit<BreakoutRunInput, "cases" | "seeds">, review: ReviewUsed): Promise<BreakoutSeedRun> => {
  const truth = await breakoutTruth(c, seed, input, review);
  const runs = investigateArchitectures(truth, input.architectures);
  const after = await logHash(truth.run.events);
  if (after !== truth.truth_log_hash) fail(c, `the truth log of seed ${seed} changed while the architectures were recorded and investigated (${truth.truth_log_hash} before, ${after} after)`);
  return { outcome: { seed, truth_log_hash: truth.truth_log_hash, cells: runs.map((r) => r.cell) }, events: truth.input.events, investigations: runs.map((r) => r.investigation) };
};

export const runBreakoutSeed = async (c: BreakoutCase, seed: number, input: Omit<BreakoutRunInput, "cases" | "seeds">, review: ReviewUsed): Promise<BreakoutSeedOutcome> =>
  (await investigateBreakoutSeed(c, seed, input, review)).outcome;

export const runBreakout = async (input: BreakoutRunInput): Promise<BreakoutResult> => {
  const review: ReviewUsed = { timing: input.review?.timing ?? "next_shift_start", reject_also: [...(input.review?.reject_also ?? [])] };
  const cases: BreakoutCaseResult[] = [];
  for (const c of input.cases) {
    const outcomes: BreakoutSeedOutcome[] = [];
    for (const seed of input.seeds) outcomes.push(await runBreakoutSeed(c, seed, input, review));
    cases.push({ case: c, outcomes });
  }
  return { engine_version: ENGINE_VERSION, seeds: [...input.seeds], review, cases };
};

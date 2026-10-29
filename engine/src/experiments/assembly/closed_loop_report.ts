import { METRICS, bootstrapMean, pairedMean } from "../../evaluate/closed_loop.ts";
import type { MetricName, ReactorMetrics } from "../../evaluate/closed_loop.ts";
import { quantile } from "../../evaluate/stats.ts";
import type { ClosedLoopReport } from "../../generated/closed_loop_report.schema";
import { createRng } from "../../rng.ts";
import type { ClosedLoopResult } from "./closed_loop.ts";
import type { ArmCounts, ArmOutcome } from "./closed_loop_arm.ts";
import { NAMED_ASSUMPTIONS } from "./closed_loop_config.ts";

// The report of experiment 2 (spec 6.2 and 8, "Experiment 2"). Per arm: the median and the 5th to 95th percentile across seeds of the per-seed mean over reactors. For every arm
// but the oracle: the paired difference against the oracle, the mean across seeds of the per-seed mean over reactors of (arm minus oracle), with a percentile bootstrap interval
// across seeds (the seeds are the independent replicates; the reactors of one seed share a lab). Denominator: reactors over the seeds, at least 20 seeds (A103).
// Reported, never gated: nothing here orders arms or tests a sign, and the wording is the template of spec 6.2.

export interface ClosedLoopHead {
  experiment_id: string;
  /** The seed minimum of the report (A103). */
  min_seeds: number;
  bootstrap: { seed: number; resamples: number };
  /** The assumption ids the result text names (the config's list). */
  assumptions: string[];
}

const LEVEL = 0.95;
const INTERVAL_WORDS =
  "median and 5th to 95th percentile (nearest rank) across seeds of the per-seed mean over reactors, not a confidence interval; paired: the mean across seeds of the per-seed mean over reactors of (arm minus oracle), with the 95 percent percentile bootstrap interval across seeds";
const NOTES = [
  "Reported, never gated: no sign, size or ordering of the arms is asserted. A sensitivity arm is reported beside the architectures and is not a result of an architecture.",
  "Simulator choices, grade A: the controller returns the probe reading to the set point when it leaves the deadband (A095); the probe starts with no offset and its drift direction is one draw per reactor (A094); a readjustment sets the probe to read the offline value at the instant it is made (A051, A108).",
  "Simulator choices, grade A: the oracle readjusts onto the true pH at the draw of the newest sample with a result; A, B and C onto the recorded offline value of that sample; C skips a value whose recorded context marks a known bias (container open, so A041 applies, or a recorded hold above A046); A and B hold no hold time and readjust onto the value they hold.",
  "A pH sample is taken in a closed container unless a technique error (A064) leaves it open (A037); the offline value carries the stability effects of its container and hold (A041 to A043) and the analyzer noise (A078).",
];

/** The result wording of spec 6.2: the five named assumptions, then the others used, then "not a prediction". */
export const resultText = (ids: readonly string[]): string => {
  const named = [...NAMED_ASSUMPTIONS];
  const others = [...new Set(ids)].filter((id) => !(named as string[]).includes(id)).sort();
  return `model-internal effect under assumptions ${named.join(", ")}${others.length > 0 ? ` (and the others used: ${others.join(", ")})` : ""}, not a prediction`;
};

const oracleIn = (o: ClosedLoopResult["outcomes"][number]): ArmOutcome => o.arms.find((a) => a.kind === "oracle") as ArmOutcome;
const meanOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const perSeed = (reactors: readonly ReactorMetrics[], metric: MetricName): number => meanOf(reactors.map((r) => r[metric]));

export const buildClosedLoopReport = (r: ClosedLoopResult, head: ClosedLoopHead): ClosedLoopReport => {
  if (r.seeds.length < head.min_seeds) throw new Error(`closed-loop report: at least ${head.min_seeds} seeds are needed (A103), the run has ${r.seeds.length}`);
  const first = r.outcomes[0];
  if (!first) throw new Error("closed-loop report: no outcome");
  const rng = createRng();
  const arms = first.arms.map((a, k) => {
    const mine = r.outcomes.map((o) => o.arms[k] as ArmOutcome);
    const counts: ArmCounts = { slots: 0, readjusted: 0, skipped_known_bias: 0, no_new_result: 0, values: 0, extrapolated: 0 };
    for (const m of mine) for (const key of Object.keys(counts) as (keyof ArmCounts)[]) counts[key] += m.counts[key];
    const metrics = METRICS.map((metric) => {
      const values = mine.map((m) => perSeed(m.reactors, metric));
      const paired =
        a.kind === "oracle"
          ? null
          : bootstrapMean(mine.map((m, i) => pairedMean(m.reactors, oracleIn(r.outcomes[i] as ClosedLoopResult["outcomes"][number]).reactors, metric)), head.bootstrap.resamples, rng.stream([head.bootstrap.seed, a.id, metric, 0, "bootstrap"]), LEVEL);
      return { metric, unit: "pH" as const, median: quantile(values, 0.5) as number, p05: quantile(values, 0.05) as number, p95: quantile(values, 0.95) as number, per_seed: values, paired };
    });
    return { id: a.id, kind: a.kind, counts, metrics };
  });
  return {
    schema_version: "1",
    engine_version: r.engine_version,
    experiment_id: head.experiment_id,
    scenario_id: r.scenario_id,
    seeds: [...r.seeds],
    n_seeds: r.seeds.length,
    min_seeds: head.min_seeds,
    meets_min_seeds: r.seeds.length >= head.min_seeds,
    n_reactor_pairs: r.outcomes.reduce((n, o) => n + oracleIn(o).reactors.length, 0),
    interval: INTERVAL_WORDS,
    bootstrap: { seed: head.bootstrap.seed, resamples: head.bootstrap.resamples, level: LEVEL, unit: "seeds" },
    assumptions: [...head.assumptions],
    result_text: resultText(head.assumptions),
    notes: NOTES,
    arms,
  };
};

import type { Stream } from "../rng.ts";
import type { PhSeries } from "../sensors.ts";
import { quantile } from "./stats.ts";

// 2026-10-30 S2c3, experiment 2 outputs (spec 6.2 and 8, "Experiment 2"): per reactor, the probe offset and the control excursion (true pH minus the set point) over the
// run; per arm, the paired difference against the oracle with a bootstrap interval across seeds. Denominator: reactors over the seeds (the pairs), at least 20 seeds (A103).
// Reported, never gated; no function here orders arms or combines the metrics into one score.

export const METRICS = ["offset_mean_abs", "excursion_mean_abs", "excursion_max_abs"] as const;
export type MetricName = (typeof METRICS)[number];
/** Mean absolute probe offset, mean absolute control excursion and the largest absolute excursion of one reactor over its run, in pH units. */
export type ReactorMetrics = Record<MetricName, number>;

/** The metrics of one reactor: every tick from inoculation to harvest counts once. */
export const reactorMetrics = (s: PhSeries, setpoint: number): ReactorMetrics => {
  let offset = 0;
  let excursion = 0;
  let worst = 0;
  for (let j = 0; j < s.n; j++) {
    offset += Math.abs(s.offset[j] as number);
    const e = Math.abs((s.truth[j] as number) - setpoint);
    excursion += e;
    if (e > worst) worst = e;
  }
  return { offset_mean_abs: offset / s.n, excursion_mean_abs: excursion / s.n, excursion_max_abs: worst };
};

/** The mean over reactors of (arm - oracle) for one metric. The two lists must be the same reactors in the same order. */
export const pairedMean = (arm: readonly ReactorMetrics[], oracle: readonly ReactorMetrics[], metric: MetricName): number => {
  if (arm.length !== oracle.length || arm.length === 0) throw new Error("paired difference: the arm and the oracle must have the same reactors");
  let sum = 0;
  for (let i = 0; i < arm.length; i++) sum += (arm[i] as ReactorMetrics)[metric] - (oracle[i] as ReactorMetrics)[metric];
  return sum / arm.length;
};

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

/**
 * The percentile bootstrap of the mean of `xs` (one value per seed): `resamples` samples with replacement of the same size, drawn from the given keyed stream, so the
 * interval is a function of the data and the key. The interval is the nearest-rank quantiles (1 - level) / 2 and 1 - (1 - level) / 2 of the resample means.
 */
export const bootstrapMean = (xs: readonly number[], resamples: number, stream: Stream, level: number): Interval => {
  if (xs.length === 0) throw new Error("bootstrap: at least one value is needed");
  const n = xs.length;
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[stream.int(0, n - 1)] as number;
    means.push(s / n);
  }
  const tail = (1 - level) / 2;
  return { mean: xs.reduce((a, b) => a + b, 0) / n, lo: quantile(means, tail) as number, hi: quantile(means, 1 - tail) as number };
};

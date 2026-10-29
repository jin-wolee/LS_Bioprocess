import type { Metrics } from "../generated/metrics.schema";
import { quantile } from "./stats.ts";

// The seed-aggregate table: per metric, the median and the spread across seeds of one (scenario, architecture), with the seed count.
// Stochastic reporting only; no test asserts a sign, a size or an ordering of what it holds (00 section 2 item 8).

export interface AggregateRow {
  /** Path in the metrics document; a share is its `value`. */
  metric: string;
  n_seeds: number;
  /** Seeds for which the metric is defined (a share with a zero denominator is not). */
  n_defined: number;
  median: number | null;
  lo: number | null;
  hi: number | null;
}

export interface AggregateTable {
  scenario_id: string;
  architecture: string;
  seeds: number[];
  n_seeds: number;
  /** The seed minimum of the report (A103) and whether this table reaches it. */
  min_seeds: number;
  meets_min_seeds: boolean;
  /** What lo and hi are. They are a spread across seeds, not a confidence interval. */
  interval: string;
  rows: AggregateRow[];
}

const isRatio = (v: unknown): v is { value: number | null } => !!v && typeof v === "object" && "num" in v && "den" in v && "value" in v;

/** Every number of a cell's metrics by path; a ratio contributes its value (null when undefined), never its counts. */
export const flatten = (node: unknown, path = ""): [string, number | null][] => {
  if (isRatio(node)) return [[path, node.value]];
  if (typeof node === "number") return [[path, node]];
  if (node && typeof node === "object" && !Array.isArray(node)) return Object.entries(node).flatMap(([k, v]) => flatten(v, path === "" ? k : `${path}.${k}`));
  return [];
};

export const aggregate = (cells: readonly Metrics[], minSeeds: number): AggregateTable => {
  const first = cells[0];
  if (!first) throw new Error("aggregate: no cells");
  if (cells.some((c) => c.architecture !== first.architecture || c.scenario_id !== first.scenario_id)) throw new Error("aggregate: cells of one scenario and one architecture only");
  const byPath = new Map<string, (number | null)[]>();
  for (const c of cells) for (const [path, v] of flatten(c.metrics)) byPath.set(path, [...(byPath.get(path) ?? []), v]);
  return {
    scenario_id: first.scenario_id,
    architecture: first.architecture,
    seeds: cells.map((c) => c.seed),
    n_seeds: cells.length,
    min_seeds: minSeeds,
    meets_min_seeds: cells.length >= minSeeds,
    interval: "spread across seeds: the 5th to the 95th percentile, nearest rank; not a confidence interval",
    rows: [...byPath].map(([metric, vals]) => {
      const defined = vals.filter((v): v is number => v !== null);
      return { metric, n_seeds: cells.length, n_defined: defined.length, median: quantile(defined, 0.5), lo: quantile(defined, 0.05), hi: quantile(defined, 0.95) };
    }),
  };
};

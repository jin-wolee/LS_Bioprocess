import { INTERVAL_TEXT, aggregate, denominatorsOf } from "../../evaluate/aggregate.ts";
import type { AggregateRow, Cell } from "../../evaluate/aggregate.ts";
import { HOLD_RULE } from "../../evaluate/hold_limit.ts";
import { NOT_APPLICABLE } from "../../evaluate/ratio.ts";
import { quantile } from "../../evaluate/stats.ts";
import type { ExperimentReport, Row } from "../../generated/experiment_report.schema";
import type { Metrics } from "../../generated/metrics.schema";
import type { OpenLoopResult } from "./open_loop.ts";

// The stochastic report of an experiment (spec sections 6 and 8): per metric and architecture the median and the spread across seeds, with the seed
// count and the denominators. Reported, never gated. A type with no ledger rate is "not_modelled", never zero; a rate whose detector could not run is
// "not_evaluable"; a rate with no opportunity in any seed is "none_occurred", never a perfect score; a precision or false-alarm rate of an evidence detector is
// "not_applicable". Orderings (ranks) are data.

export interface ReportHead {
  experiment_id: string;
  /** The seed minimum of the report (A103). */
  min_seeds: number;
  /** The preset whose ablations carry the id `<preset>_minus_<flag>` (architecture.ts `ablate`). */
  ablations_of: string;
}

/** Numbers of the metrics document that repeat a setting of the scenario or the evaluation: they do not vary with the architecture or the seed. */
const SETTING_ECHOES = new Set(["utilisation.analyzers", "utilisation.days", "utilisation.staffed_window_s", "holding_time.sla_threshold_s"]);
/** A median or a p90 is over the requests of the share printed beside it (spec section 8). */
const SIBLING_SHARE: Record<string, string> = {
  "holding_time.median_s": "holding_time.started", "holding_time.p90_s": "holding_time.started",
  "turnaround.median_s": "turnaround.released", "turnaround.p90_s": "turnaround.released",
  "alignment_error.median_s": "alignment_error.joined", "alignment_error.p90_s": "alignment_error.joined",
};
const REALISED_TEXT = "realised opportunities of the type (the count that is the denominator of its recall)";
const TYPE_ROW = /^detection\.by_type\.([a-z_]+)\.(realised|recall|precision|false_alarm|by_detector\.[A-Za-z0-9_-]+)$/;
const BY_DETECTOR_TEXT = "count for this detector: the flags a rule raised, or the realised opportunities of the type whose request carries the evidence of an evidence check";

const NOTES = [
  "Stochastic comparison over the seed list; never a gate. No test asserts an ordering, a sign of a difference or an interval that includes or excludes zero (spec sections 6 and 8).",
  "not_modelled: the type has no ledger rate in a production run (the S2b research tasks); no number is given and none is zero. not_evaluable: no rule or evidence of the type could run on the architecture. none_occurred: no opportunity in any seed, which is not a perfect score. not_applicable: an evidence check raises no alarm, so it has a recall and no precision and no false-alarm rate.",
  "Ranks are data only: 1 is the smallest median, equal medians share the lowest rank, and a smaller or larger value is not better or worse for every metric.",
];

const NO_CONTRAST = "no contrast in this scenario";
const NO_ALARM = "an evidence check raises no alarm: no precision and no false-alarm rate";
const NO_RATE = "no ledger rate for this type in a production run";
const ZERO_DENOMINATOR = "the denominator is zero in every seed: undefined, not 0 and not 1";

const status = (path: string, defined: number, cells: readonly Metrics[]): Row["status"] => {
  const m = TYPE_ROW.exec(path);
  if (m) {
    const [, type, field] = m as unknown as [string, string, string];
    const of = (c: Metrics) => (c.metrics.detection.by_type as unknown as Record<string, Record<string, unknown> | undefined>)[type];
    if (cells.every((c) => c.metrics.detection.not_modelled.includes(type))) return "not_modelled";
    if (cells.every((c) => of(c)?.[field] === NOT_APPLICABLE)) return "not_applicable";
    if (field !== "realised" && cells.every((c) => of(c)?.evaluable === false)) return "not_evaluable";
  }
  return defined > 0 ? "reported" : "none_occurred";
};

/** Why a row carries no number, in words: null for a reported row. */
const reasonOf = (s: Row["status"], path: string, cells: readonly Metrics[]): string | null => {
  const type = TYPE_ROW.exec(path)?.[1];
  const of = (c: Metrics) => (c.metrics.detection.by_type as unknown as Record<string, { reason: string | null } | undefined>)[type ?? ""];
  switch (s) {
    case "reported": return null;
    case "not_modelled": return NO_RATE;
    case "not_applicable": return path.startsWith("phantom_effect") ? NO_CONTRAST : NO_ALARM;
    case "not_evaluable": return (cells[0] && of(cells[0])?.reason) || null;
    case "none_occurred": return ZERO_DENOMINATOR;
  }
};

const rowOf = (a: AggregateRow, cells: readonly Metrics[], dens: ReturnType<typeof denominatorsOf>): Row => {
  const s = status(a.metric, a.n_defined, cells);
  const share = dens.get(a.metric) ?? dens.get(SIBLING_SHARE[a.metric] ?? "");
  const own = dens.get(a.metric);
  const noNumber = s !== "reported";
  const noDenominator = s === "not_modelled" || s === "not_applicable";
  return {
    metric: a.metric, status: s, n_seeds: a.n_seeds, n_defined: noNumber ? 0 : a.n_defined,
    median: noNumber ? null : a.median, lo: noNumber ? null : a.lo, hi: noNumber ? null : a.hi,
    denominator: noDenominator ? null : share ? share.text : a.metric.endsWith(".realised") ? REALISED_TEXT : a.metric.includes(".by_detector.") ? BY_DETECTOR_TEXT : a.metric.startsWith("phantom_effect.") ? (cells[0]?.metrics.phantom_effect?.denominator ?? null) : null,
    den: own && !noDenominator ? { min: Math.min(...own.counts), median: quantile(own.counts, 0.5) as number, max: Math.max(...own.counts) } : null,
    reason: reasonOf(s, a.metric, cells),
  };
};

/** The three rows of the hold-time rule's share of the result (spec section 8), in report order. */
const HOLD_LIMIT_ROWS = ["hold_limit.rejected", "hold_limit.exact_reconstruction_limit_lifted", "hold_limit.availability_limit_lifted"];

/**
 * The hold-time rule's share of the result for one architecture (spec section 8, "The hold-time rule and its share of the result"): the figure of each seed, aggregated like the cells' numbers.
 * The figure lives beside the cells, so no cell and no hash of a cell carries it. A record that stores no hold time has no figure: its three rows read "not evaluable" with the reason of the
 * validation, and carry no number. A result that did not ask for the figure has no rows.
 */
const holdLimitRows = (id: string, result: OpenLoopResult, cells: readonly Metrics[], reason: string | undefined): Row[] => {
  if (result.outcomes.every((o) => o.hold_limit === undefined)) return [];
  const figures: Cell[] = result.outcomes.flatMap((o) => {
    const f = o.hold_limit?.[id];
    return f ? [{ scenario_id: result.scenario_id, architecture: id, seed: o.seed, metrics: { hold_limit: f } }] : [];
  });
  if (figures.length === 0) {
    return HOLD_LIMIT_ROWS.map((metric): Row => ({
      metric, status: "not_evaluable", n_seeds: result.outcomes.length, n_defined: 0, median: null, lo: null, hi: null, denominator: null, den: null, reason: reason ?? "the hold-time rule cannot run on this record",
    }));
  }
  const dens = denominatorsOf(figures);
  return aggregate(figures, 0).rows.map((a) => rowOf(a, cells, dens));
};

/** The scenario names no group contrast, so no cell has a phantom effect: one row per architecture says so (not applicable, never 0). */
const phantomRow = (cells: readonly Metrics[]): Row[] =>
  cells.every((c) => c.metrics.phantom_effect === null)
    ? [{ metric: "phantom_effect", status: "not_applicable", n_seeds: cells.length, n_defined: 0, median: null, lo: null, hi: null, denominator: null, den: null, reason: NO_CONTRAST }]
    : [];

/** Per metric, the architectures with a reported median, ordered by it; competition ranking (equal medians share the lowest rank). */
const ranksOf = (blocks: ExperimentReport["architectures"]): ExperimentReport["ranks"] =>
  (blocks[0]?.rows ?? []).flatMap((first) => {
    const medians = blocks.flatMap((b) => {
      const r = b.rows.find((x) => x.metric === first.metric);
      return r && r.status === "reported" && r.median !== null ? [{ architecture: b.id, median: r.median }] : [];
    });
    if (medians.length < 2) return [];
    const order = medians.map((m, i) => ({ m, i })).sort((x, y) => x.m.median - y.m.median || x.i - y.i).map(({ m }) => ({ architecture: m.architecture, rank: 1 + medians.filter((o) => o.median < m.median).length, median: m.median }));
    return [{ metric: first.metric, order }];
  });

export const buildReport = (result: OpenLoopResult, head: ReportHead): ExperimentReport => {
  const ids = (result.outcomes[0]?.cells ?? []).map((c) => c.architecture);
  const prefix = `${head.ablations_of}_minus_`;
  const architectures = ids.map((id): ExperimentReport["architectures"][number] => {
    const cells = result.outcomes.map((o) => o.cells.find((c) => c.architecture === id) as Metrics);
    const table = aggregate(cells, head.min_seeds);
    const dens = denominatorsOf(cells);
    const not_evaluable = new Map(cells.flatMap((c) => c.metrics.detection.not_evaluable.map((n) => [n.rule, n.reason] as const)));
    return {
      id, role: id.startsWith(prefix) ? "ablation" : "preset", ablated_flag: id.startsWith(prefix) ? id.slice(prefix.length) : null, n_seeds: cells.length,
      not_modelled: [...new Set(cells.flatMap((c) => c.metrics.detection.not_modelled))],
      not_evaluable: [...not_evaluable].map(([rule, reason]) => ({ rule, reason })),
      rows: [...table.rows.filter((r) => !SETTING_ECHOES.has(r.metric)).map((r) => rowOf(r, cells, dens)), ...phantomRow(cells), ...holdLimitRows(id, result, cells, not_evaluable.get(HOLD_RULE))],
    };
  });
  return {
    schema_version: "1", engine_version: result.engine_version, experiment_id: head.experiment_id, scenario_id: result.scenario_id,
    seeds: [...result.seeds], n_seeds: result.seeds.length, min_seeds: head.min_seeds, meets_min_seeds: result.seeds.length >= head.min_seeds,
    interval: INTERVAL_TEXT,
    truth_log_hashes: result.outcomes.map((o) => ({ seed: o.seed, truth_log_hash: o.truth_log_hash })),
    review: { timing: result.review.timing, reject_also: [...result.review.reject_also] },
    notes: NOTES, architectures, ranks: ranksOf(architectures),
  };
};

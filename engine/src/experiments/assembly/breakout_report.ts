import { INTERVAL_TEXT, flatten } from "../../evaluate/aggregate.ts";
import { KINDS } from "../../evaluate/breakout_metrics.ts";
import type { BreakoutMetrics } from "../../evaluate/breakout_metrics.ts";
import { quantile } from "../../evaluate/stats.ts";
import type { BreakoutReport } from "../../generated/breakout_report.schema";
import { blockOf } from "./breakout.ts";
import type { BreakoutCaseResult, BreakoutResult } from "./breakout.ts";
import { eventOf, inputsOf, topologyOf } from "./breakout_inputs.ts";

// The report of the break-out experiment SC12 (spec 8, 11.5 and 11.6; rule S10 of 11.8.2): per case and architecture the median and the spread across seeds of the six extension metrics, each row
// with its denominator, the seed count and the inputs of the case printed as inputs. Reported, never gated. It orders no architectures (no ranks) and has no composite score: spec 8, anti-gaming
// rule 8, and the rule that recall is shown beside precision and the false-alarm rate.

export interface BreakoutReportHead {
  experiment_id: string;
  /** The seed minimum of the report (A103). */
  min_seeds: number;
  /** The preset whose ablations carry the id `<preset>_minus_<flag>` (architecture.ts `ablate`). */
  ablations_of: string;
}

type Row = BreakoutReport["cases"][number]["architectures"][number]["rows"][number];
type Reach = BreakoutReport["cases"][number]["architectures"][number]["reach"];

/** The author's ruling of 2026-10-31 on C29 ("지금대로 + 결과에 설명"): the stop rule stays and the report says what it does to the host effects of mycoplasma (spec 11.8.11, C29). */
export const MYCOPLASMA_NOTE =
  "Author's ruling of 2026-10-31 on C29 (\"지금대로 + 결과에 설명\"): the stop rule stays. The growth and viability effects of mycoplasma come after the signalling unit is stopped, so they show on a sibling that signals later or with a longer lag, not on the signalling unit.";

const NOTES = [
  "Stochastic comparison over the seed list, never a gate. No test asserts an ordering, a sign or a size (spec sections 6 and 8, anti-gaming rule 8). The report orders no architectures and carries no composite score.",
  "Recall is shown beside precision and the false-alarm rate (section 8, anti-gaming rule 3). A ratio with a zero denominator is undefined, never 0 and never 1; a direction 3 row of a record that cannot read direction 3 is not_reachable and carries no value: the walk-back could not look, which is not an empty set found.",
  "Identification is scored on the walk-back of the first signal; time to containment on the first hold from any signal (rule S10). The median time to containment equals d1 by construction wherever the first walk-back holds the item: the contained share and the later holds are the information.",
  "Every input without a default is a test design choice (assumed, grade A): A176 (both delays), A177 (the topology), the inputs of the event type and the sample volumes, and the assumed lag of the walk-back. They are printed beside the result as inputs and are not findings.",
  "Direction 2 (pools, harvests, downstream lots) and the metric draws beyond the port limit wait for S4. The tests report the truth, except the nucleic-acid test, which finds only what its target covers (A146).",
  "A simulation result of the stated scenario and seeds on synthetic data; not a statement about any real plant.",
];

const PATHS: string[] = [
  ...KINDS.flatMap((k) => [`containment.${k}.contained`, `containment.${k}.median_s`, `containment.${k}.p90_s`]),
  ...([1, 3] as const).flatMap((d) => ["recall", "precision", "false_alarm"].map((m) => `identification.direction_${d}.${m}`)),
  "released_before_containment",
  "retro_flag_completeness",
];

const TIME_TEXT = "held items of T of this kind: the time from the first signal to the first hold; the contained share is the row beside it";

type Share = { den: number; denominator: string };
const isShare = (v: unknown): v is Share => !!v && typeof v === "object" && "num" in v && "den" in v && "value" in v;
const sharesOf = (node: unknown, path = ""): [string, Share][] =>
  isShare(node) ? [[path, node]] : node && typeof node === "object" && !Array.isArray(node) ? Object.entries(node).flatMap(([k, v]) => sharesOf(v, path === "" ? k : `${path}.${k}`)) : [];

/** The part of a cell the report aggregates: the metrics, without the signal (an instant) and the reach (flags). */
const metricsOf = (m: BreakoutMetrics) => ({ containment: m.containment, identification: m.identification, released_before_containment: m.released_before_containment, retro_flag_completeness: m.retro_flag_completeness });

/** What a reader needs beside a row: why a direction 3 row has no walk-back to read, a zero denominator, or what a time is over. Null when there is nothing to add. */
const reasonOf = (path: string, defined: number, reach: Reach): string | null => {
  const d3 = path.startsWith("identification.direction_3.");
  if (d3 && !reach.direction3) return "not reachable from this record: neither material_lot_links nor equipment_links is on, so the walk-back could not look; nothing was returned because it cannot look, which is not an empty set found";
  if (defined === 0) return "the denominator is zero in every seed: undefined, not 0 and not 1";
  if (path.endsWith("_s")) return "over the held items only, with the contained share beside it";
  if (d3 && !reach.lots) return "reads equipment only: material_lot_links is off, so lots and the seed parent are not reachable";
  if (d3 && !reach.equipment) return "reads lots only: equipment_links is off, so equipment is not reachable";
  return null;
};

const rowOf = (path: string, cells: readonly BreakoutMetrics[], reach: Reach): Row => {
  // a direction 3 row of a record that cannot read direction 3 reports no value: the walk-back could not look, which is not an empty set found (rule S8; C40, F6)
  const unreachable = path.startsWith("identification.direction_3.") && !reach.direction3;
  const values = unreachable ? [] : cells.map((c) => new Map(flatten(metricsOf(c))).get(path) ?? null);
  const defined = values.filter((v): v is number => v !== null);
  const shares = cells.map((c) => new Map(sharesOf(metricsOf(c))).get(path));
  const counts = shares.flatMap((s) => (s ? [s.den] : []));
  const time = path.endsWith("_s");
  return {
    metric: path, status: unreachable ? "not_reachable" : defined.length > 0 ? "reported" : "none_occurred", n_seeds: cells.length, n_defined: defined.length,
    median: quantile(defined, 0.5), lo: quantile(defined, 0.05), hi: quantile(defined, 0.95),
    denominator: time ? TIME_TEXT : (shares[0]?.denominator ?? null),
    den: time || counts.length === 0 ? null : { min: Math.min(...counts), median: quantile(counts, 0.5) as number, max: Math.max(...counts) },
    reason: reasonOf(path, defined.length, reach),
  };
};

const caseOf = (r: BreakoutCaseResult, head: BreakoutReportHead): BreakoutReport["cases"][number] => {
  const b = blockOf(r.case);
  const ids = (r.outcomes[0]?.cells ?? []).map((c) => c.architecture);
  const prefix = `${head.ablations_of}_minus_`;
  return {
    case_id: r.case.case_id, scenario_id: r.case.scenario.scenario_id, event: eventOf(r.case, b), inputs: inputsOf(r.case, b), topology: topologyOf(r.case, b),
    truth_log_hashes: r.outcomes.map((o) => ({ seed: o.seed, truth_log_hash: o.truth_log_hash })),
    architectures: ids.map((id) => {
      const cells = r.outcomes.map((o) => o.cells.find((c) => c.architecture === id) as BreakoutMetrics);
      const reach = (cells[0] as BreakoutMetrics).reach; // the flags of an architecture do not change with the seed
      return { id, role: id.startsWith(prefix) ? "ablation" : "preset", ablated_flag: id.startsWith(prefix) ? id.slice(prefix.length) : null, n_seeds: cells.length, reach: { ...reach }, rows: PATHS.map((p) => rowOf(p, cells, reach)) };
    }),
  };
};

export const buildBreakoutReport = (result: BreakoutResult, head: BreakoutReportHead): BreakoutReport => ({
  schema_version: "1", engine_version: result.engine_version, experiment_id: head.experiment_id,
  seeds: [...result.seeds], n_seeds: result.seeds.length, min_seeds: head.min_seeds, meets_min_seeds: result.seeds.length >= head.min_seeds,
  interval: INTERVAL_TEXT, review: { timing: result.review.timing, reject_also: [...result.review.reject_also] },
  mycoplasma_note: MYCOPLASMA_NOTE, notes: NOTES, cases: result.cases.map((c) => caseOf(c, head)),
});

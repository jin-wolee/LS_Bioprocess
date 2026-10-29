import type { ExperimentReport, Row } from "../../src/generated/experiment_report.schema";

// A compact text summary of a stochastic report for the console and the internal log: the median and the spread of a few metrics per architecture,
// and the seed count. Data only; nothing here ranks or judges.

export const SUMMARY_METRICS: readonly [label: string, metric: string][] = [
  ["exact", "exact_reconstruction"],
  ["misattr", "misattribution.misattributed"],
  ["unattr", "misattribution.unattributed"],
  ["attributable", "attributable"],
  ["avail", "availability.available"],
  ["leaked", "availability.leaked"],
  ["rerun", "rerun_traceability"],
];

const fmt = (r: Row | undefined): string => {
  if (!r) return "-";
  if (r.status === "not_modelled") return "not modelled";
  if (r.status === "not_evaluable") return "not evaluable";
  if (r.status === "none_occurred") return "none occurred";
  if (r.status === "not_applicable") return "not applicable";
  const n = (x: number | null) => (x === null ? "-" : Number.isInteger(x) ? String(x) : x.toFixed(3));
  return `${n(r.median)} [${n(r.lo)}, ${n(r.hi)}]${r.n_defined < r.n_seeds ? ` (${r.n_defined}/${r.n_seeds})` : ""}`;
};

export const summaryLines = (report: ExperimentReport, metrics: readonly [string, string][] = SUMMARY_METRICS): string[] => {
  const head = `${report.experiment_id} on ${report.scenario_id}: ${report.n_seeds} seeds (minimum ${report.min_seeds}, ${report.meets_min_seeds ? "met" : "NOT met"}); median [lo, hi] = ${report.interval}`;
  const table = report.architectures.map((a) => `${a.id.padEnd(42)} | ${metrics.map(([, m]) => fmt(a.rows.find((r) => r.metric === m))).join(" | ")}`);
  const phantom = report.architectures[0]?.rows.find((r) => r.metric === "phantom_effect");
  return [head, `${"architecture".padEnd(42)} | ${metrics.map(([l]) => l).join(" | ")}`, ...table, ...(phantom ? [`phantom effect: ${fmt(phantom)}: ${phantom.reason}`] : [])];
};

/** One line per detection rate of one architecture: type, realised count, recall, precision, false alarm. */
export const detectionLines = (report: ExperimentReport, architecture: string): string[] => {
  const a = report.architectures.find((x) => x.id === architecture);
  const types = [...new Set((a?.rows ?? []).flatMap((r) => /^detection\.by_type\.([a-z_]+)\./.exec(r.metric)?.slice(1) ?? []))];
  const at = (t: string, f: string) => fmt(a?.rows.find((r) => r.metric === `detection.by_type.${t}.${f}`));
  return types.map((t) => `${architecture} | ${t.padEnd(22)} | realised ${at(t, "realised")} | recall ${at(t, "recall")} | precision ${at(t, "precision")} | false alarm ${at(t, "false_alarm")}`);
};

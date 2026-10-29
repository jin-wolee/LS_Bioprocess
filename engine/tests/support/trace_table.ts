import type { SingleSampleTrace } from "./trace_sample.ts";

// The side-by-side table of docs/design/single_sample_trace.md, generated from the fixture and never typed. The page holds it between two marker lines; a test
// regenerates it and compares (engine/tests/trace/single_sample_trace.test.ts). Every cell is a field of the fixture: the recorders' real rows, or truth.

export const BEGIN = "<!-- trace-table:begin -->";
export const END = "<!-- trace-table:end -->";

/** Seconds of the scenario as "<seconds> (day <n> hh:mm:ss)"; day 0 is a Monday. */
export const stamp = (t: number | null | undefined): string => {
  if (t === null || t === undefined) return "null";
  const s = t % 86400;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${t} (day ${Math.floor(t / 86400)} ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)})`;
};

type Row = Record<string, unknown>;
const show = (v: unknown): string => (v === null || v === undefined ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v));
const one = (rows: unknown[]): Row => (rows[0] ?? {}) as Row;

export const traceTable = (t: SingleSampleTrace): string => {
  const ids = Object.keys(t.architectures);
  const arch = (id: string) => t.architectures[id] as SingleSampleTrace["architectures"][string];
  const truth = t.pick;
  const row = (label: string, truthCell: string, cell: (id: string) => string): string => `| ${label} | ${truthCell} | ${ids.map(cell).join(" | ")} |`;
  const verdicts = (id: string, q: "unit" | "sampled_at" | "process_context"): string => `${show(arch(id).answers[q].answer)}: **${arch(id).answers[q].verdict}**`;
  const stored = (id: string, table: "sample" | "result" | "run", field: string, fmt: (v: unknown) => string = show): string => fmt(one(arch(id).tables[table])[field]);
  const time = (v: unknown): string => stamp(v as number | null);
  const flagsOn = (id: string): string => Object.entries(arch(id).flags).filter(([, on]) => on).map(([f]) => `\`${f}\``).join(", ") || "none";
  const lines = [
    BEGIN,
    `| | truth | ${ids.join(" | ")} |`,
    `|---|---|${ids.map(() => "---").join("|")}|`,
    row("flags on", "-", flagsOn),
    row("labelling", "-", (id) => arch(id).labelling),
    row("**Q1 which unit?** (`sample.unit_id`)", truth.unit_id, (id) => verdicts(id, "unit")),
    row("**Q2 which `sampled_at`?** (`sample.sampled_at`)", time(truth.sampled_at), (id) => verdicts(id, "sampled_at")),
    row("**Q3 which process context?** (feed epoch, batch phase)", show(truth.context_at_draw), (id) => verdicts(id, "process_context")),
    row("`sample.batch_id`", truth.batch_id, (id) => stored(id, "sample", "batch_id")),
    row("`sample.keys_fixed_at_write`", "-", (id) => stored(id, "sample", "keys_fixed_at_write")),
    row("`sample.planned_at`", "-", (id) => stored(id, "sample", "planned_at", time)),
    row("`run.started_at`", time(truth.run_started_at), (id) => stored(id, "run", "started_at", time)),
    row("`result.measured_at`", time(truth.measured_at), (id) => stored(id, "result", "measured_at", time)),
    row("`result.ingested_at`", "-", (id) => stored(id, "result", "ingested_at", time)),
    row("`result.available_at`", "-", (id) => stored(id, "result", "available_at", time)),
    row("`result.state`", "-", (id) => stored(id, "result", "state")),
    row("process context: join basis", "`sampled_at`", (id) => show(arch(id).tables.process_context?.join_basis)),
    row("process context: join time", time(truth.sampled_at), (id) => time(arch(id).tables.process_context?.join_time)),
    row("process context: `feed_epoch`", String(truth.context_at_draw.feed_epoch), (id) => show(arch(id).tables.process_context?.feed_epoch)),
    row("process context: `batch_phase`", truth.context_at_draw.batch_phase, (id) => show(arch(id).tables.process_context?.batch_phase)),
    row("realised errors on this sample", "-", (id) => (arch(id).realised_errors.length === 0 ? "none" : JSON.stringify(arch(id).realised_errors))),
    END,
  ];
  return lines.join("\n");
};

/** The page text with the generated block replaced. Throws when the page has no pair of markers, so a page cannot silently lose its table. */
export const withTable = (page: string, t: SingleSampleTrace): string => {
  const a = page.indexOf(BEGIN);
  const b = page.indexOf(END);
  if (a < 0 || b < a) throw new Error("single_sample_trace.md has no trace-table markers");
  return `${page.slice(0, a)}${traceTable(t)}${page.slice(b + END.length)}`;
};

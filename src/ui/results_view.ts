import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";

// The pure parts of the Results screen (docs/design/lab_ui.md sections 3 and 10; spec section 8): how a report row is shown and grouped, the axis of a range bar, and the condition of the
// label-error sentence. Nothing here orders the architectures or combines metrics into a score (spec section 8, anti-gaming rules 3 and 6).

export type ReportRow = ExperimentReport["architectures"][number]["rows"][number];

/**
 * The instant, in seconds of the run, that a printed input of an action is, or null for any other input (P8a). The engine names an action's inputs `act-<n> <kind> <target> <field>` and gives an
 * instant in minutes of the run (docs/design/lab_ui.md section 22); the page prints it as a clock reading, as the list of actions does, and a length (in hours) or a threshold stays as given.
 */
export const instantOf = (input: { name: string; value: number | string; unit: string }): number | null =>
  /^act-\d+ \S+ \S+ (at|from|effective)$/.test(input.name) && input.unit === "min" && typeof input.value === "number" ? input.value * 60 : null;

/** A figure for the eye: whole numbers as they are, three significant digits otherwise (a figure of a thousand or more is rounded to a whole number). */
export const fmt = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 1000) return String(Math.round(value));
  return String(Number(value.toPrecision(3)));
};

/**
 * The label-error sentence (spec section 5, "Notes from S2g") is shown for an architecture whose flags have `system_issued_id` off and `ingest_idempotency` on: the condition reads the
 * flags, not the id of the architecture, so it holds for any ablation the engine offers. A flag missing from the data counts as off.
 */
export const showsLabelErrorNote = (flags: Readonly<Record<string, boolean>>): boolean => flags.system_issued_id !== true && flags.ingest_idempotency === true;

/** The axis of a metric, shared by every architecture shown: zero to one for a share (a row with a denominator), otherwise zero to the largest upper end of the spread. */
export const axisMax = (blocks: readonly { rows: readonly ReportRow[] }[], metric: string): number => {
  const rows = blocks.flatMap((b) => b.rows.filter((r) => r.metric === metric));
  if (rows.some((r) => r.den !== null)) return 1;
  const highs = rows.flatMap((r) => (r.status === "reported" && r.hi !== null ? [r.hi] : []));
  return highs.length > 0 ? Math.max(...highs) || 1 : 1;
};

/** The positions of the median and the two ends of the spread on an axis of `width`, held to the axis. */
export const barPositions = (figure: { median: number; lo: number; hi: number }, max: number, width: number): { median: number; lo: number; hi: number } => {
  const at = (v: number): number => Math.min(width, Math.max(0, (v / max) * width));
  return { median: at(figure.median), lo: at(figure.lo), hi: at(figure.hi) };
};

export interface DetectionGroup {
  type: string;
  recall?: ReportRow;
  precision?: ReportRow;
  false_alarm?: ReportRow;
  realised?: ReportRow;
}

const DETECTION = /^detection\.by_type\.([a-z_]+)\.(realised|recall|precision|false_alarm)$/;
const TIMING = /^(holding_time|turnaround)\./;

/**
 * The rows of one architecture in the groups the screen shows: timing, the record, the hold-time rule's share of the result (spec section 8), utilisation (shown once, from the shared truth run, not per architecture) and detection, with the
 * recall, the precision and the false-alarm rate of each error type together (rule 3 of spec section 8). The per-detector counts are not a metric of the section and are left out.
 */
export const groupRows = (rows: readonly ReportRow[]): { timing: ReportRow[]; record: ReportRow[]; hold_limit: ReportRow[]; utilisation: ReportRow[]; detection: DetectionGroup[] } => {
  const out = { timing: [] as ReportRow[], record: [] as ReportRow[], hold_limit: [] as ReportRow[], utilisation: [] as ReportRow[], detection: [] as DetectionGroup[] };
  for (const r of rows) {
    const d = DETECTION.exec(r.metric);
    if (d) {
      const [, type, field] = d as unknown as [string, string, "realised" | "recall" | "precision" | "false_alarm"];
      let group = out.detection.find((g) => g.type === type);
      if (!group) out.detection.push((group = { type }));
      group[field] = r;
    } else if (r.metric.startsWith("detection.")) continue;
    else if (r.metric.startsWith("utilisation.")) out.utilisation.push(r);
    else if (r.metric.startsWith("hold_limit.")) out.hold_limit.push(r);
    else if (TIMING.test(r.metric)) out.timing.push(r);
    else out.record.push(r);
  }
  return out;
};

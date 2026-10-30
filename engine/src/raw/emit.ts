import { wallOf } from "../calendar.ts";
import { overlapDraw, replayDraw } from "./quirks.ts";
import type { RawOpportunity } from "./quirks.ts";
import { formatStamp, localSeconds, stampAmbiguous } from "./stamp_text.ts";
import type { EmittedFile, KeyRow } from "./key.ts";
import { BANNER } from "./types.ts";
import type { AnalysisRow, DeviceSettings, Dialect } from "./types.ts";

// The generic emitter (spec section 2.4.1; prompts/20 Step 5): one function from analysis rows, dialect data and plain-data injections to file text. It branches on
// no dialect id: the shape comes from the dialect data and the device settings. Integer seconds become wall-clock text only here. It returns the realised quirks as
// plain data (key_rows); the assembly writes them to the raw quirk key, and only the evaluator reads that.

type Column = Dialect["columns"][number];

export interface RawPlan {
  seed: number;
  /** RQ4 probabilities. Absent: no ledger rate exists (spec 2.4.8), so nothing materialises and a production run reports the quirk as not modelled. Test-only values in fixtures. */
  rates?: { overlap?: number; replay?: number };
  /** Forced mode (fixtures): indices of the rows of `previous`, the export just before, to repeat, a replayed file, and scripted reanalysis rows (RQ5: an index into `rows` and the new row time). */
  forced?: { overlap_rows?: readonly number[]; replay?: boolean; reanalysis?: readonly { row: number; at_s: number }[] };
  /** RQ6: the upper end of the analytical range at dilution 1 by analyte (A089); used with `range_marking`. */
  range_limits?: Readonly<Record<string, number>>;
}

export interface ExportInput {
  dialect: Dialect;
  device: DeviceSettings;
  /** Epoch seconds (UTC) of scenario second 0 (calendar.ts, anchorEpoch). */
  anchor_epoch_s: number;
  rows: readonly AnalysisRow[];
  /** The rows of the export just before this one (same instrument and dialect), without its repeats: the rows an overlapping export may repeat, once (S2f F3). */
  previous: readonly AnalysisRow[];
  /** Every row of all the earlier exports of this instrument and dialect, without repeats: what append mode repeats in each export. */
  earlier: readonly AnalysisRow[];
  /** The host clock at the export (seconds of the scenario): the file's received_at. */
  export_at: number;
  plan: RawPlan;
}

export interface Emitted {
  files: EmittedFile[];
  opportunities: RawOpportunity[];
}

interface Line {
  row: AnalysisRow;
  quirks: string[];
  repeat: boolean;
  /** Notes of the row, in the order of the columns. */
  notes: string[];
  blank: ReadonlySet<string>;
}

const unitTextOf = (c: Column, d: DeviceSettings): string => d.unit_texts?.[c.analyte as string] ?? (c.unit_text as string);
const headerOf = (c: Column, dialect: Dialect, d: DeviceSettings): string => (c.kind === "value" && dialect.file.units === "in_header" ? `${c.label} (${unitTextOf(c, d)})` : c.label);

export const emitExport = (input: ExportInput): Emitted => {
  const { dialect, device, plan } = input;
  const resolution = dialect.params.resolution_s?.value ?? 1;
  const byRole = new Map(dialect.columns.map((c) => [c.role, c]));
  const columns = (device.template ?? dialect.columns.map((c) => c.role)).map((r) => byRole.get(r) ?? (() => { throw new Error(`dialect ${dialect.dialect_id}: the template names the role ${r}, which it has no column for`); })());
  const exportId = `${device.instrument}|${dialect.dialect_id}|${input.export_at}`;
  const opportunities: RawOpportunity[] = [];

  // RQ4: rows that this export repeats. Append mode repeats every earlier row in every export. An overlapping export repeats the chosen rows of the export just before, once, and
  // only there (spec 2.4.3). 2026-10-30 S2f F3: the draw of a row is recorded by the export that first writes it (below); here the same pure draw is only read to decide.
  const lines: Line[] = [];
  const repeated = device.append === true
    ? input.earlier
    : input.previous.filter((row, i) => (plan.forced?.overlap_rows ?? []).includes(i) || (plan.rates?.overlap !== undefined && overlapDraw(plan.seed, row).u < plan.rates.overlap));
  for (const row of repeated) lines.push({ row, quirks: ["RQ4"], repeat: true, notes: [], blank: new Set() });
  for (const row of input.rows) {
    opportunities.push(overlapDraw(plan.seed, row));
    lines.push({ row, quirks: [], repeat: false, notes: [], blank: new Set() });
  }
  // RQ5: scripted reanalysis rows keep the original sample time and carry a new row time (a new result id for a data system)
  for (const r of plan.forced?.reanalysis ?? []) {
    const base = input.rows[r.row];
    if (base) lines.push({ row: { ...base, stamp_s: r.at_s, ...(base.result_id !== undefined && { result_id: base.result_id.replace(/-1$/, "-2") }) }, quirks: ["RQ5"], repeat: false, notes: [], blank: new Set() });
  }
  // RQ6: an analytical-range breach is a blank value plus a note naming the analyte and the direction (the CSV form is assumed, A163)
  if (device.range_marking === true && dialect.range_note) {
    for (const line of lines) {
      for (const v of line.row.values) {
        const limit = plan.range_limits?.[v.analyte];
        if (limit === undefined || v.value <= limit * (line.row.dilution ?? 1)) continue;
        const label = (dialect.columns.find((c) => c.analyte === v.analyte) as Column).label;
        line.blank = new Set([...line.blank, v.analyte]);
        line.notes.push(`${label} Analytical Range ${dialect.range_note.high_word}`);
        line.quirks.push("RQ6");
      }
    }
  }

  const sep = dialect.file.separator;
  const end = dialect.file.trailing_separator ? sep : "";
  const quoted = (s: string): string => (dialect.file.quote_header ? `"${s}"` : s);
  const local = (t: number): number => localSeconds(t, input.anchor_epoch_s, device.zone_offset_s);
  const text = (t: number): string => formatStamp(local(t), device, resolution);
  const header = [...columns.map((c) => quoted(headerOf(c, dialect, device))), ...(device.extra_columns ?? []).map(quoted)];
  const unitsRow =
    dialect.file.units === "optional_row" && device.units_row
      ? [[...columns.map((c) => (c.kind === "value" ? unitTextOf(c, device) : "")), ...(device.extra_columns ?? []).map(() => "")].join(sep) + end]
      : [];
  const cell = (c: Column, l: Line): string => {
    switch (c.kind) {
      case "stamp": return c.role === "sample_time" ? text(l.row.sample_time_s) : text(l.row.stamp_s);
      case "value": { const v = l.row.values.find((x) => x.analyte === c.analyte); return v === undefined || l.blank.has(v.analyte) ? "" : String(v.value); }
      case "note": return l.notes.join("; ");
      case "number": return l.row.dilution === null ? "" : String(l.row.dilution);
      default: return c.role === "sample_id" ? l.row.sample_id : c.role === "injection_id" ? (l.row.injection_id ?? "") : (l.row.result_id ?? "");
    }
  };
  const head = [BANNER, header.join(sep) + end, ...unitsRow];
  const keyRows: KeyRow[] = [];
  const manifest: EmittedFile["manifest"] = [];
  const body = lines.map((l, i) => {
    const line = head.length + i + 1;
    const w = wallOf(local(l.row.stamp_s));
    const quirks = [...l.quirks];
    if (stampAmbiguous(w, device)) quirks.push("RQ2");
    if (resolution > 1 && l.row.stamp_s % resolution !== 0) quirks.push("RQ3");
    if (l.row.values.some((v) => device.unit_texts?.[v.analyte] !== undefined && device.unit_texts[v.analyte] !== (dialect.columns.find((c) => c.analyte === v.analyte)?.unit_text))) quirks.push("RQ7");
    keyRows.push({ line, sample_id: l.row.sample_id, intended_s: l.row.t_s, resolution_s: resolution, ambiguous: stampAmbiguous(w, device), repeat: l.repeat, quirks: [...new Set(quirks)], unreadable: false });
    manifest.push({ line, src: l.row.src });
    return [...columns.map((c) => cell(c, l)), ...(device.extra_columns ?? []).map(() => "")].join(sep) + end;
  });
  const exportText = `${[...head, ...body].join("\n")}\n`;
  const e = wallOf(local(input.export_at));
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const file_name = `${dialect.file.name_prefix}_${device.instrument}_${pad(e.y, 4)}-${pad(e.m)}-${pad(e.d)}_${pad(e.hh)}${pad(e.mm)}${pad(e.ss)}.${dialect.file.extension}`;
  const file: EmittedFile = { file_name, text: exportText, instrument: device.instrument, dialect_id: dialect.dialect_id, received_at: input.export_at, replay_of: null, key_rows: keyRows, manifest };

  // RQ4, file level: a transfer retry drops the same file twice
  const replay = replayDraw(plan.seed, exportId);
  opportunities.push(replay);
  const replayed = plan.forced?.replay === true || (plan.rates?.replay !== undefined && replay.u < plan.rates.replay);
  const copy: EmittedFile[] = replayed ? [{ ...file, replay_of: file_name, key_rows: keyRows.map((k) => ({ ...k, repeat: true, quirks: [...new Set([...k.quirks, "RQ4"])] })) }] : [];
  return { files: [file, ...copy], opportunities };
};

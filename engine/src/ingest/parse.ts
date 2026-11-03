import { hashString } from "../rng.ts";
import type { AdapterEntry } from "./adapters/entry.ts";
import type { IngestFinding, ParseErrorCode, ParseErrorRow, ParseOutput, RawFileRow, RawRecordRow } from "./canonical.ts";
import { parseRow } from "./row.ts";
import type { RowEnv } from "./row.ts";
import { pinOrder } from "./stamp.ts";
import type { IngestStore } from "./store.ts";

// The generic parser (spec section 2.4.1; data_model section 16; docs/prompts/20 Step 6): one function from file text and an adapter entry to a raw_file, raw_record rows,
// canonical records and parse_error rows. It branches on no dialect id: the shape comes from the entry. Per line the outcome is loaded, no-op, or an action hold,
// quarantine or reject with its rule id (VR-023 to VR-026, VR-005, VR-006, VR-008, VR-008b, VR-019). The parser never reads truth, the raw quirk key or the run bookkeeping.

export interface ParseContext {
  entry: AdapterEntry;
  file_name: string;
  raw_file_id: string;
  /** The host clock when the file arrived (seconds of the scenario): becomes the ingested_at of everything loaded. */
  received_at: number;
  /** Epoch seconds (UTC) of scenario second 0. */
  anchor_epoch_s: number;
  /** The two flags an adapter acts on: duplicates and replays are no-ops (ingest_idempotency), and a reanalysis is a new version rather than an overwrite (append_only_versions). */
  flags: { ingest_idempotency: boolean; append_only_versions: boolean };
  store: IngestStore;
}

/** Split a line at the separator outside double quotes; the quotes are removed. */
const split = (line: string, sep: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

export const parseFile = (text: string, ctx: ParseContext): ParseOutput => {
  const { entry } = ctx;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const raw_file: RawFileRow = {
    raw_file_id: ctx.raw_file_id, adapter_id: entry.adapter_id, adapter_version: entry.adapter_version, file_name: ctx.file_name,
    content_hash: hashString(text).toString(16).padStart(16, "0"), row_count: 0, received_at: ctx.received_at, instrument_id: entry.instrument, state: "received",
  };
  const out: ParseOutput = { raw_file, raw_records: [], records: [], parse_errors: [], findings: [], conflicts: [] };
  const fileError = (code: ParseErrorCode, role: string | null, reason: string): void => {
    out.parse_errors.push({ parse_error_id: `${ctx.raw_file_id}:E${out.parse_errors.length + 1}`, raw_file_id: ctx.raw_file_id, line_no: null, column_role: role, code, rule_id: "VR-023", reason, raised_at: ctx.received_at });
    raw_file.state = "rejected";
  };

  let first = lines[0] === entry.banner ? 1 : 0;
  const headerLine = lines[first];
  if (headerLine === undefined || headerLine.trim() === "") {
    fileError("unknown_dialect_or_template", null, "the file has no header row");
    return out;
  }
  first += 1;
  const headerCells = split(headerLine, entry.separator);
  const trailing = headerCells[headerCells.length - 1] === "";
  if (trailing) headerCells.pop();

  const byLabel = new Map(entry.columns.map((c) => [c.label, c.role]));
  const at = new Map<string, number>();
  const header_units = new Map<string, string>();
  headerCells.forEach((raw, j) => {
    const cellText = raw.trim();
    const m = entry.units_in_header ? /^(.*) \((.+)\)$/.exec(cellText) : null;
    const role = byLabel.get(m ? (m[1] as string) : cellText);
    if (role === undefined) {
      out.findings.push({ rule: "VR-023", severity: "info", action: "no-op", target: `file:${ctx.raw_file_id}`, status: "resolved" } satisfies IngestFinding);
      return;
    }
    at.set(role, j);
    if (m) header_units.set(role, m[2] as string);
  });
  if (at.size === 0) {
    fileError("unknown_dialect_or_template", null, "no header cell is a column of the template map");
    return out;
  }
  const required = ["sample_id", "stamp", ...entry.required_analytes.map((a) => `analyte:${a}`)];
  const missing = required.filter((r) => !at.has(r));
  for (const role of missing) fileError("required_column_missing", role, `the required column ${role} is not in the header`);

  // the optional units row sits under the header: no sample id, no stamp, a unit text in a value column
  const row_units = new Map<string, string>();
  const nextCells = lines[first] === undefined ? null : split(lines[first] as string, entry.separator);
  const cellOf = (cells: string[], role: string): string => (at.has(role) ? (cells[at.get(role) as number] ?? "").trim() : "");
  if (!entry.units_in_header && nextCells && cellOf(nextCells, "sample_id") === "" && cellOf(nextCells, "stamp") === "") {
    for (const c of entry.columns) if (c.kind === "value" && cellOf(nextCells, c.role) !== "") row_units.set(c.role, cellOf(nextCells, c.role));
    first += 1;
  }

  const data = lines.slice(first).map((line, k) => ({ line, line_no: first + k + 1 })).filter((d) => d.line.trim() !== "");
  raw_file.row_count = data.length;
  if (raw_file.state === "rejected") return out; // a rejected file loads nothing; the parse_error rows are file level, and the key counts every row it holds

  const rows = data.map((d) => ({ ...d, cells: split(d.line, entry.separator) }));
  if (trailing) for (const r of rows) if (r.cells[r.cells.length - 1] === "") r.cells.pop();
  const stampTexts = rows.flatMap((r) => [cellOf(r.cells, "stamp"), cellOf(r.cells, "sample_time")]).filter((s) => s !== "");
  const env: RowEnv = { entry, raw_file_id: ctx.raw_file_id, received_at: ctx.received_at, anchor_epoch_s: ctx.anchor_epoch_s, flags: ctx.flags, store: ctx.store, pinned: entry.date_order === "unknown" ? pinOrder(stampTexts, entry) : null, at, header_units, row_units };

  for (const r of rows) {
    const record_kind = entry.columns.some((c) => c.role === "injection_id") ? "injection" : "analysis";
    const outcome = r.cells.length !== headerCells.length
      ? { state: "rejected" as const, rule_id: "VR-023", source_event_id: null, results: [], error: { code: "bad_row_width" as const, role: null, reason: `the row has ${r.cells.length} cells, the header ${headerCells.length}` }, conflicts: [], findings: [] }
      : parseRow(env, r.cells, r.line_no);
    const rec: RawRecordRow = { raw_record_id: `${ctx.raw_file_id}:${r.line_no}`, raw_file_id: ctx.raw_file_id, line_no: r.line_no, record_kind, raw_text: r.line, source_event_id: outcome.source_event_id, state: outcome.state, rule_id: outcome.rule_id };
    out.raw_records.push(rec);
    out.records.push(...outcome.results);
    out.findings.push(...outcome.findings);
    out.conflicts.push(...outcome.conflicts);
    if (outcome.error) {
      const e: ParseErrorRow = { parse_error_id: `${ctx.raw_file_id}:E${out.parse_errors.length + 1}`, raw_file_id: ctx.raw_file_id, line_no: r.line_no, column_role: outcome.error.role, code: outcome.error.code, rule_id: "VR-023", reason: outcome.error.reason, raised_at: ctx.received_at };
      out.parse_errors.push(e);
    }
  }
  raw_file.state = "parsed";
  return out;
};

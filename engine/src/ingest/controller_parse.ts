import type { CanonicalAlarm, CanonicalHistorian, CanonicalPhase, CanonicalResult, IngestFinding, ParseErrorCode, ParseErrorRow, RawFileRow, RawRecordRow } from "./canonical.ts";
import type { ControllerEntry, EntryLog } from "./controller_entry.ts";
import { parseControllerRow } from "./controller_row.ts";
import type { ControllerEnv } from "./controller_row.ts";
import type { IngestStore } from "./store.ts";

// The generic controller parser (spec 2.4.1; data_model 16; docs/prompts/20 Step 7): one function from file text and a controller entry to a raw_file, raw_record rows, canonical
// records (historian values, alarm events, batch phase records) and parse_error rows. It branches on no profile id: the log a file belongs to comes from the file-name prefix of
// the entry, and a line is read by the role of its columns. Per line the outcome is loaded, no-op, or an action hold, quarantine or reject with its rule id (VR-025, VR-024,
// VR-023, VR-008, VR-008b). The parser never reads truth, the raw quirk key or the run bookkeeping.

export interface ControllerContext {
  entry: ControllerEntry;
  file_name: string;
  raw_file_id: string;
  /** The host clock when the file arrived (seconds of the scenario): becomes the ingested_at of everything loaded. */
  received_at: number;
  /** Epoch seconds (UTC) of scenario second 0. */
  anchor_epoch_s: number;
  /** The flag a controller adapter acts on: a copy of a row is a no-op (ingest_idempotency). Reanalysis does not exist for a tag, an alarm or a phase. */
  flags: { ingest_idempotency: boolean };
  store: IngestStore;
}

export interface ControllerParseOutput {
  raw_file: RawFileRow;
  raw_records: RawRecordRow[];
  /** Always empty: the analyzer results of ParseOutput, so the raw-layer metrics read both kinds of output alike. */
  records: CanonicalResult[];
  parse_errors: ParseErrorRow[];
  findings: IngestFinding[];
  historian: CanonicalHistorian[];
  alarms: CanonicalAlarm[];
  phases: CanonicalPhase[];
}

/** A content hash that is cheap on a file of hundreds of kilobytes: two 32-bit FNV-1a lanes, 16 hex digits. Equal text gives the equal hash; it is no security hash. */
const contentHash = (text: string): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + i;
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
};

/** Split a line at the comma outside double quotes; the quotes are removed. */
const split = (line: string): string[] => {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

/** The roles a line cannot be read without, by kind of log. */
const REQUIRED: Record<EntryLog["kind"], readonly string[]> = {
  tag: ["stamp", "tag", "value"], alarm: ["stamp", "alarm"], phase: ["stamp", "phase", "recipe"], unmodelled: [],
};

export const parseControllerFile = (text: string, ctx: ControllerContext): ControllerParseOutput => {
  const { entry } = ctx;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const raw_file: RawFileRow = {
    raw_file_id: ctx.raw_file_id, adapter_id: entry.adapter_id, adapter_version: entry.adapter_version, file_name: ctx.file_name,
    content_hash: contentHash(text), row_count: 0, received_at: ctx.received_at, instrument_id: entry.controller, state: "received",
  };
  const out: ControllerParseOutput = { raw_file, raw_records: [], records: [], parse_errors: [], findings: [], historian: [], alarms: [], phases: [] };
  const fileError = (code: ParseErrorCode, role: string | null, reason: string): void => {
    out.parse_errors.push({ parse_error_id: `${ctx.raw_file_id}:E${out.parse_errors.length + 1}`, raw_file_id: ctx.raw_file_id, line_no: null, column_role: role, code, rule_id: "VR-023", reason, raised_at: ctx.received_at });
    raw_file.state = "rejected";
  };

  // the data rows of the file, counted before any rejection: a rejected file counts every row it holds (spec 2.4.7, parse failure rate)
  const first = lines[0] === entry.banner ? 1 : 0;
  const data = lines.slice(first + 1).map((line, k) => ({ line, line_no: first + 2 + k })).filter((d) => d.line.trim() !== "");
  raw_file.row_count = data.length;

  // the log of the file: the longest file-name prefix of the entry that the name starts with
  const log = entry.logs.filter((l) => ctx.file_name.startsWith(`${l.file_prefix}_`)).sort((a, b) => b.file_prefix.length - a.file_prefix.length)[0];
  if (!log) {
    fileError("unknown_dialect_or_template", null, `the file name ${JSON.stringify(ctx.file_name)} starts with no log prefix of the adapter`);
    return out;
  }
  if (log.kind === "unmodelled") {
    fileError("unknown_dialect_or_template", null, `no row of the log ${log.log} is modelled, so the adapter has no mapping for it`);
    return out;
  }
  const headerLine = lines[first];
  if (headerLine === undefined || headerLine.trim() === "") {
    fileError("unknown_dialect_or_template", null, "the file has no header row");
    return out;
  }
  const header = split(headerLine);
  const byLabel = new Map(log.columns.map((c, i) => [c, log.roles[i] as string]));
  const at = new Map<string, number>();
  header.forEach((raw, j) => {
    const role = byLabel.get(raw.trim());
    if (role === undefined) out.findings.push({ rule: "VR-023", severity: "info", action: "no-op", target: `file:${ctx.raw_file_id}`, status: "resolved" });
    else at.set(role, j);
  });
  for (const role of REQUIRED[log.kind].filter((r) => !at.has(r) && log.roles.includes(r))) fileError("required_column_missing", role, `the required column ${role} is not in the header`);
  if (raw_file.state === "rejected") return out;

  const env: ControllerEnv = { entry, log, raw_file_id: ctx.raw_file_id, received_at: ctx.received_at, anchor_epoch_s: ctx.anchor_epoch_s, flags: ctx.flags, store: ctx.store, at };
  const record_kind = log.kind === "tag" ? "tag_value" : log.kind === "alarm" ? "alarm_transition" : "phase_transition";
  for (const d of data) {
    const cells = split(d.line);
    const o = cells.length !== header.length
      ? { state: "rejected" as const, rule_id: "VR-023", source_event_id: null, error: { code: "bad_row_width" as const, role: null, reason: `the row has ${cells.length} cells, the header ${header.length}` }, findings: [] }
      : parseControllerRow(env, cells, d.line_no);
    out.raw_records.push({ raw_record_id: `${ctx.raw_file_id}:${d.line_no}`, raw_file_id: ctx.raw_file_id, line_no: d.line_no, record_kind, raw_text: d.line, source_event_id: o.source_event_id, state: o.state, rule_id: o.rule_id });
    if ("historian" in o && o.historian) out.historian.push(o.historian);
    if ("alarm" in o && o.alarm) out.alarms.push(o.alarm);
    if ("phase" in o && o.phase) out.phases.push(o.phase);
    out.findings.push(...o.findings);
    if (o.error) out.parse_errors.push({ parse_error_id: `${ctx.raw_file_id}:E${out.parse_errors.length + 1}`, raw_file_id: ctx.raw_file_id, line_no: d.line_no, column_role: o.error.role, code: o.error.code, rule_id: "VR-023", reason: o.error.reason, raised_at: ctx.received_at });
  }
  raw_file.state = "parsed";
  return out;
};

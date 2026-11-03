import { dimensionMatches, physicallyPossible } from "../record/entry_checks.ts";
import type { AdapterEntry } from "./adapters/entry.ts";
import type { CanonicalResult, Finding, IngestConflict, IngestFinding, ParseErrorCode, RangeFlag, RawRecordState, RecordState } from "./canonical.ts";
import { parseStamp } from "./stamp.ts";
import type { DateOrder } from "../raw/types.ts";
import type { IngestStore } from "./store.ts";

// One data line to canonical results (docs/prompts/20 Step 6): the outcome is loaded, no-op, or an action hold, quarantine or reject with its rule id. A rule changes a
// state and never a value. The parser reads the file text, the adapter entry and the store; it never reads truth and never reads the raw quirk key.

export interface RowEnv {
  entry: AdapterEntry;
  raw_file_id: string;
  received_at: number;
  anchor_epoch_s: number;
  flags: { ingest_idempotency: boolean; append_only_versions: boolean };
  store: IngestStore;
  /** The order pinned by another row of the file, or null. */
  pinned: DateOrder | null;
  /** Column index by role, unit text found in the header by role, unit text found in the units row by role. */
  at: ReadonlyMap<string, number>;
  header_units: ReadonlyMap<string, string>;
  row_units: ReadonlyMap<string, string>;
}

export interface RowOutcome {
  state: RawRecordState;
  rule_id: string | null;
  source_event_id: string | null;
  results: CanonicalResult[];
  error: { code: ParseErrorCode; role: string | null; reason: string } | null;
  conflicts: IngestConflict[];
  findings: IngestFinding[];
}

const FAIL = (code: ParseErrorCode, role: string | null, reason: string): RowOutcome => ({ state: "rejected", rule_id: "VR-023", source_event_id: null, results: [], error: { code, role, reason }, conflicts: [], findings: [] });
const RANK: Record<RecordState, number> = { loaded: 0, held: 1, quarantined: 2 };

export const parseRow = (env: RowEnv, cells: readonly string[], line_no: number): RowOutcome => {
  const { entry, store } = env;
  const cell = (role: string): string => (env.at.has(role) ? ((cells[env.at.get(role) as number] ?? "").trim()) : "");
  const sample_id = cell("sample_id");
  if (sample_id === "") return FAIL("required_column_missing", "sample_id", "the sample id is blank");

  const stampText = cell("stamp");
  const sampleTimeText = cell("sample_time") || stampText;
  const stamp = parseStamp(stampText, entry, env.pinned);
  const sampleTime = sampleTimeText === stampText ? stamp : parseStamp(sampleTimeText, entry, env.pinned);
  if (stamp.status === "malformed" || sampleTime.status === "malformed") return FAIL("malformed_stamp", "stamp", `the stamp ${JSON.stringify(stampText)} is not a valid date and time`);
  // an unresolved stamp (ambiguous, or the entry has no zone) is stored and quarantined (VR-024); the instant stays unknown
  const resolved = sampleTime.status === "ok" && stamp.status === "ok" && entry.source_zone_s !== null;
  const measured_at = resolved ? (sampleTime as { local_s: number }).local_s - (entry.source_zone_s as number) - env.anchor_epoch_s + (entry.stamp_means === "start" ? entry.run_s : 0) : null;

  const dilutionText = cell("dilution");
  const dilution = dilutionText === "" ? null : Number(dilutionText);
  if (dilution !== null && !Number.isFinite(dilution)) return FAIL("non_numeric_value", "dilution", `the dilution ${JSON.stringify(dilutionText)} is not a number`);
  const note = cell("note");
  const injection = entry.columns.some((c) => c.role === "injection_id");
  const rowKey = injection ? `${cell("injection_id")}|${cell("result_id")}` : `${stampText}|${sample_id}`;

  const results: CanonicalResult[] = [];
  const findings: IngestFinding[] = [];
  const conflicts: IngestConflict[] = [];
  let noOps = 0;
  let source_event_id: string | null = null;

  for (const col of entry.columns) {
    if (col.kind !== "value" || !env.at.has(col.role)) continue;
    const analyte = col.analyte as string;
    const expect = entry.expect[analyte];
    const raw = cell(col.role);
    const flag: RangeFlag | null = entry.range_words && note.includes(`${col.label} Analytical Range ${entry.range_words.high}`) ? "above_analytical" : entry.range_words && note.includes(`${col.label} Analytical Range ${entry.range_words.low}`) ? "below_analytical" : null;
    if (raw === "" && flag === null && !entry.required_analytes.includes(analyte)) continue; // not measured: a blank cell for an analyte the method does not require
    const value = raw === "" ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) return FAIL("non_numeric_value", col.role, `the value ${JSON.stringify(raw)} of ${analyte} is not a number`);

    // the unit: the units row, the header, or the entry (RQ7: a file without a units row takes the unit from the entry)
    const original = env.row_units.get(col.role) ?? env.header_units.get(col.role) ?? null;
    const unit = entry.unit_map[original ?? (expect?.unit_text as string)];
    if (!unit) return FAIL("unknown_unit", col.role, `the unit text ${JSON.stringify(original)} of ${analyte} is not in the unit map of the entry`);

    const found: Finding[] = [];
    let state: RecordState = "loaded";
    const add = (rule: string, severity: Finding["severity"], action: "hold" | "quarantine"): void => {
      found.push({ rule, severity, action });
      if (RANK[action === "hold" ? "held" : "quarantined"] > RANK[state]) state = action === "hold" ? "held" : "quarantined";
    };
    if (measured_at === null) add("VR-024", "error", "quarantine");
    if (expect && !dimensionMatches(expect.dimension, unit.dimension)) add("VR-005", "error", "quarantine");
    else if (expect && value !== null && !physicallyPossible(expect.physical, value)) add("VR-006", "error", "quarantine");
    if (value === null && flag === null) add("VR-026", "warning", "hold");

    const source_event = `${entry.instrument}|${rowKey}|${analyte}`;
    source_event_id = source_event_id ?? source_event;
    const idempotency_key = `${entry.instrument}|${source_event}|v1`;
    const content = `${value}|${unit.ucum}|${dilution}|${measured_at}`;
    const known = store.keys.get(idempotency_key);
    if (env.flags.ingest_idempotency && known) {
      if (known.content === content) {
        noOps += 1;
        findings.push({ rule: "VR-008", severity: "info", action: "no-op", target: `source_event:${source_event}`, status: "resolved" });
      } else {
        conflicts.push({ source_system: entry.instrument, source_event_id: source_event, idempotency_key, received_at: env.received_at, sample_id, analyte, value, measured_at, raw_ref: { raw_file_id: env.raw_file_id, line_no } });
      }
      continue;
    }

    // versions (RQ5): a reanalysis row is version n+1 of the measurement with the original time; without version n it is VR-019; with append_only_versions off it overwrites
    const canonical_id = `${env.raw_file_id}:${line_no}:${analyte}`;
    const link = `${entry.instrument}|${sample_id}|${analyte}|${measured_at}`;
    const latest = store.latest.get(link);
    const reanalysis = measured_at !== null && (injection ? latest !== undefined && latest.tag !== rowKey : sampleTimeText !== stampText);
    let version = 1;
    let supersedes: string | null = null;
    if (reanalysis) {
      if (!latest) {
        version = 2;
        add("VR-019", "error", "quarantine");
      } else if (env.flags.append_only_versions) {
        version = latest.version + 1;
        supersedes = latest.canonical_id;
      } else version = latest.version;
    }
    if (measured_at !== null && (!reanalysis || latest !== undefined)) store.latest.set(link, { version, canonical_id, tag: rowKey });
    store.keys.set(idempotency_key, { content, canonical_id });

    const rec: CanonicalResult = {
      record_kind: "result",
      envelope: { source_system: entry.instrument, source_event_id: source_event, idempotency_key, schema_version: "1", raw_ref: { raw_file_id: env.raw_file_id, line_no }, event_time: stampText, received_at: env.received_at },
      payload: {
        sample_id, analyte, value, unit_original: original, unit_ucum: unit.ucum, dilution_factor: dilution, measured_at, source_zone_s: entry.source_zone_s,
        time_resolution_s: entry.time_resolution_s, range_flag: value === null ? flag : null, version, supersedes,
      },
      state, findings: found,
    };
    results.push(rec);
  }
  // the state of the line is the worst state of its results; a conflict (VR-008b) is a quarantine; a line whose every result was a repeat is a no-op
  const worst = results.reduce<RecordState>((w, r) => (RANK[r.state] > RANK[w] ? r.state : w), "loaded");
  const action = worst === "held" ? "hold" : "quarantine";
  const quarantined = worst === "quarantined" || conflicts.length > 0;
  const state: RawRecordState = quarantined ? "quarantined" : worst === "held" ? "held" : results.length === 0 && noOps > 0 ? "no_op" : "loaded";
  const rule_id = quarantined && worst !== "quarantined" ? "VR-008b" : state === "no_op" ? "VR-008" : state === "loaded" ? null : (results.flatMap((r) => (r.state === worst ? r.findings : [])).find((f) => f.action === action)?.rule ?? null);
  return { state, rule_id, source_event_id, results, error: null, conflicts, findings };
};

import { secondsOfWall, validDate } from "../calendar.ts";
import { INITIAL, MACHINES, isTransition } from "../record/transitions.ts";
import type { Entity } from "../record/transitions.ts";
import type { CanonicalAlarm, CanonicalHistorian, CanonicalPhase, Envelope, IngestFinding, ParseErrorCode, RawRecordState, RecordState } from "./canonical.ts";
import type { ControllerEntry, EntryLog } from "./controller_entry.ts";
import { parseStamp } from "./stamp.ts";
import type { IngestStore } from "./store.ts";

// One data line of a controller log to a canonical record (data_model 16.3 and 16.4; docs/prompts/20 Step 7): the outcome is loaded, no-op, or an action hold, quarantine or reject
// with its rule id. A rule changes a state and never a value. The line is read by the role of its columns (the entry, from the profile), never by position or label. The parser
// reads the text, the entry and the store; it never reads truth, the raw quirk key or the run bookkeeping.

export interface ControllerEnv {
  entry: ControllerEntry;
  log: EntryLog;
  raw_file_id: string;
  received_at: number;
  anchor_epoch_s: number;
  flags: { ingest_idempotency: boolean };
  store: IngestStore;
  /** Column index by role. */
  at: ReadonlyMap<string, number>;
}

export interface ControllerOutcome {
  state: RawRecordState;
  rule_id: string | null;
  source_event_id: string | null;
  historian?: CanonicalHistorian;
  alarm?: CanonicalAlarm;
  phase?: CanonicalPhase;
  error?: { code: ParseErrorCode; role: string | null; reason: string };
  findings: IngestFinding[];
}

const FAIL = (code: ParseErrorCode, role: string | null, reason: string): ControllerOutcome => ({ state: "rejected", rule_id: "VR-023", source_event_id: null, error: { code, role, reason }, findings: [] });
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;
const TAG = /^([^.\s()]+)\.(PV|SP|OUT)$/;
const UNIT_SUFFIX = /^(.*\S) \(([^()\s]+)\)$/;

type Stamp = { status: "ok"; ts: number } | { status: "unresolved" } | { status: "malformed" };

/** The stamp text to seconds of the scenario: a UTC instant with its offset in the text, or a local wall-clock text that the entry's zone resolves (RQ1). */
const stampOf = (text: string, env: ControllerEnv): Stamp => {
  if (env.entry.stamp_form === "iso_utc_offset") {
    const m = ISO.exec(text);
    if (!m) return { status: "malformed" };
    const [y, mo, d, hh, mm, ss] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
    if (!validDate(y, mo, d) || hh > 23 || mm > 59 || ss > 59) return { status: "malformed" };
    const zone = m[7] === "Z" ? 0 : (m[7]?.startsWith("-") ? -1 : 1) * (Number(m[7]?.slice(1, 3)) * 3600 + Number(m[7]?.slice(4, 6)) * 60);
    return { status: "ok", ts: secondsOfWall({ y, m: mo, d, hh, mm, ss }) - zone - env.anchor_epoch_s };
  }
  const s = parseStamp(text, { date_order: "year_first", date_separator: "-", clock_style: "24h" }, null);
  if (s.status === "malformed") return { status: "malformed" };
  if (s.status !== "ok" || env.entry.source_zone_s === null) return { status: "unresolved" };
  return { status: "ok", ts: s.local_s - env.entry.source_zone_s - env.anchor_epoch_s };
};

/** A name and its unit: from the unit column where the log has one, else from the parentheses after the name (A171). */
const withUnit = (cell: string, unit: string | null): { name: string; unit: string } | null => {
  if (unit !== null) return cell !== "" && unit !== "" ? { name: cell, unit } : null;
  const m = UNIT_SUFFIX.exec(cell);
  return m ? { name: m[1] as string, unit: m[2] as string } : null;
};

const statesOf = (entity: Entity): Set<string> => new Set(MACHINES[entity].flatMap((e) => [e.from, e.to]));

export const parseControllerRow = (env: ControllerEnv, cells: readonly string[], line_no: number): ControllerOutcome => {
  const { entry, log, store } = env;
  const has = (role: string): boolean => env.at.has(role);
  const cell = (role: string): string => (env.at.has(role) ? ((cells[env.at.get(role) as number] ?? "").trim()) : "");
  const unitCol = has("unit") ? cell("unit") : null;

  const stampText = cell("stamp");
  const stamp = stampOf(stampText, env);
  if (stamp.status === "malformed") return FAIL("malformed_stamp", "stamp", `the stamp ${JSON.stringify(stampText)} is not a valid date and time`);

  // what the line says, by the kind of log
  let id: string; // the natural key of the line (data_model 16.3, envelope)
  let content: string; // what a copy under the same key must repeat
  let build: (ts: number, state: RecordState, findings: { rule: string; severity: "info" | "warning" | "error"; action: "hold" | "quarantine" }[], envelope: Envelope) => Pick<ControllerOutcome, "historian" | "alarm" | "phase">;
  let instance: { entity: Entity; key: string; from: string | null; to: string } | null = null;

  if (log.kind === "tag") {
    const named = withUnit(cell("tag"), unitCol);
    const name = named ? TAG.exec(named.name) : null;
    const raw = cell("value");
    if (!named || !name) return FAIL("unknown_name", "tag", `the tag ${JSON.stringify(cell("tag"))} is not signal.role${unitCol === null ? " (unit)" : ""}`);
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value)) return FAIL("non_numeric_value", "value", `the value ${JSON.stringify(raw)} is not a number`);
    const quality = has("quality") ? cell("quality") : "good";
    const tag = `${named.unit}.${name[1]}.${name[2]}`;
    id = `${tag}|${stampText}`;
    content = `${value}|${quality}`;
    build = (ts, state, findings, envelope) => ({ historian: { record_kind: "tag_value", envelope, payload: { tag, ts, value, quality }, state, findings } });
  } else if (log.kind === "alarm") {
    const named = withUnit(cell("alarm"), unitCol);
    const to = has("to_state") ? cell("to_state") : cell("state");
    const from = has("from_state") ? cell("from_state") : null;
    if (!named) return FAIL("unknown_name", "alarm", `the alarm ${JSON.stringify(cell("alarm"))} has no unit`);
    const states = statesOf("alarm_event");
    const unknown = [to, from].find((s) => s !== null && !states.has(s));
    if (unknown !== undefined) return FAIL("unknown_name", "state", `the alarm state ${JSON.stringify(unknown)} is not in the alarm model (A174)`);
    const watched = has("tag") ? cell("tag") : "";
    if (watched !== "" && !TAG.test(watched)) return FAIL("unknown_name", "tag", `the watched tag ${JSON.stringify(watched)} is not signal.role`);
    const sev = has("severity") ? cell("severity") : "";
    const severity = sev === "" ? null : Number(sev);
    if (severity !== null && !Number.isInteger(severity)) return FAIL("non_numeric_value", "severity", `the severity ${JSON.stringify(sev)} is not a whole number`);
    const actor = cell("user") || null;
    const tag = watched === "" ? null : `${named.unit}.${watched}`;
    id = `${named.unit}|${named.name}|${to}|${stampText}`;
    content = `${from}|${severity}|${actor}|${tag}`;
    instance = { entity: "alarm_event", key: `${entry.controller}|A|${named.unit}|${named.name}`, from, to };
    build = (ts, state, findings, envelope) => ({
      alarm: { record_kind: "alarm_transition", envelope, payload: { alarm_id: named.name, unit_id: named.unit, tag, severity, from_state: instance?.from ?? "", to_state: to, ts, actor, comment: null }, state, findings },
    });
  } else {
    const named = withUnit(cell("phase"), unitCol);
    const to = has("to_state") ? cell("to_state") : cell("state");
    const from = has("from_state") ? cell("from_state") : null;
    if (!named) return FAIL("unknown_name", "phase", `the phase ${JSON.stringify(cell("phase"))} has no unit`);
    const states = statesOf("batch_phase_record");
    const unknown = [to, from].find((s) => s !== null && !states.has(s));
    if (unknown !== undefined) return FAIL("unknown_name", "state", `the phase state ${JSON.stringify(unknown)} is not one of the 13 states (A170)`);
    const recipe = cell("recipe");
    if (recipe === "") return FAIL("unknown_name", "recipe", "the recipe is blank");
    const optional = (role: string): string | null => (has(role) ? cell(role) || null : null);
    const [batch, procedure, unit_procedure, operation] = [optional("batch"), optional("procedure"), optional("unit_procedure"), optional("operation")];
    id = `${named.unit}|${batch ?? "-"}|${named.name}|${to}|${stampText}`;
    content = `${from}|${recipe}|${procedure}|${unit_procedure}|${operation}`;
    instance = { entity: "batch_phase_record", key: `${entry.controller}|P|${named.unit}|${batch ?? ""}|${recipe}|${procedure ?? ""}|${unit_procedure ?? ""}|${operation ?? ""}|${named.name}`, from, to };
    build = (ts, state, findings, envelope) => ({
      phase: { record_kind: "phase_transition", envelope, payload: { batch_id: batch, unit_id: named.unit, recipe_id: recipe, procedure, unit_procedure, operation, phase: named.name, from_state: instance?.from ?? "", to_state: to, ts, actor: null, command: null }, state, findings },
    });
  }

  const finding = (rule: string, severity: IngestFinding["severity"], action: IngestFinding["action"], target: string, status: IngestFinding["status"]): IngestFinding => ({ rule, severity, action, target, status });
  const source = `source_event:${id}`;
  // ingest_idempotency (data_model 7): the key is the controller, the natural key of the line and the content version
  const idempotency_key = `${entry.controller}|${id}|v1`;
  if (env.flags.ingest_idempotency) {
    const known = store.keys.get(idempotency_key);
    if (known) {
      return known.content === content
        ? { state: "no_op", rule_id: "VR-008", source_event_id: id, findings: [finding("VR-008", "info", "no-op", source, "resolved")] }
        : { state: "quarantined", rule_id: "VR-008b", source_event_id: id, findings: [finding("VR-008b", "error", "quarantine", source, "open")] };
    }
    store.keys.set(idempotency_key, { content, canonical_id: `${env.raw_file_id}:${line_no}` });
  }

  // an unresolved stamp (the entry has no zone) is stored and quarantined (VR-024); the instant stays unknown, so no record is built.
  // 2026-10-30 S2f F8: this comes after the idempotency check, as in the analyzer parser (ingest/row.ts), so a replayed file of unresolved rows is a no-op and not quarantined again
  if (stamp.status === "unresolved") return { state: "quarantined", rule_id: "VR-024", source_event_id: id, findings: [finding("VR-024", "error", "quarantine", source, "open")] };

  // VR-025: a transition the state model does not list, when the instance has an earlier record. The first row seen is accepted (the log may start mid-instance), and a held row
  // does not advance the instance, so the next row is judged against the last accepted state.
  let held = false;
  if (instance) {
    const prev = store.states.get(instance.key);
    held = prev !== undefined && !isTransition(instance.entity, prev, instance.to);
    instance.from ??= prev ?? INITIAL[instance.entity] ?? "";
    if (!held) store.states.set(instance.key, instance.to);
  }
  const envelope: Envelope = { source_system: entry.controller, source_event_id: id, idempotency_key, schema_version: "1", raw_ref: { raw_file_id: env.raw_file_id, line_no }, event_time: stampText, received_at: env.received_at };
  const target = `${instance?.entity ?? "tag"}:${env.raw_file_id}:${line_no}`;
  return {
    state: held ? "held" : "loaded", rule_id: held ? "VR-025" : null, source_event_id: id,
    ...build(stamp.ts, held ? "held" : "loaded", held ? [{ rule: "VR-025", severity: "warning", action: "hold" }] : [], envelope),
    findings: held ? [finding("VR-025", "warning", "hold", target, "open")] : [],
  };
};

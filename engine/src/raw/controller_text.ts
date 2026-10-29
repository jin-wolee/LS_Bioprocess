import { wallOf } from "../calendar.ts";
import type { AlarmTransition, ControllerProfile, PhaseTransition, TagRow } from "./controller_types.ts";
import { formatStamp } from "./stamp_text.ts";

// Seconds and rows to the text of a controller file, inside the emitter only (spec 2.4.1, rule 1). The shape comes from the profile data: the stamp form, the tag naming (the unit in
// a column of its own or in parentheses inside the name, A171) and the role of each column. The engine branches on no profile id.

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export interface TextContext {
  profile: ControllerProfile;
  anchor_epoch_s: number;
  zone_offset_s: number;
}

/** The stamp of an instant, in the form the profile declares: a UTC instant with its offset, or a local wall-clock text with no zone (RQ1). */
export const stampText = (ts: number, c: TextContext): string => {
  if (c.profile.stamp.form === "iso_utc_offset") {
    const w = wallOf(c.anchor_epoch_s + ts);
    return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}T${pad(w.hh)}:${pad(w.mm)}:${pad(w.ss)}+00:00`;
  }
  return formatStamp(c.anchor_epoch_s + ts + c.zone_offset_s, { order: "year_first", separator: "-", clock: "24h", day_part_marker: false }, 1);
};

/** The calendar date (UTC, year first) of an instant of the scenario: the date in a file name. */
export const dateText = (ts: number, c: TextContext): string => {
  const w = wallOf(c.anchor_epoch_s + ts);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
};

/** The time of day (UTC, hhmmss) of an instant: the time in the name of a one-row file. */
export const clockText = (ts: number, c: TextContext): string => {
  const w = wallOf(c.anchor_epoch_s + ts);
  return `${pad(w.hh)}${pad(w.mm)}${pad(w.ss)}`;
};

export type Row = { kind: "tag"; row: TagRow } | { kind: "alarm"; row: AlarmTransition } | { kind: "phase"; row: PhaseTransition };

/** The name of a thing with its unit: in a column of its own where the log has one, else with the unit in parentheses after the name (A171). */
const named = (name: string, unit: string, hasUnitColumn: boolean): string => (hasUnitColumn ? name : `${name} (${unit})`);

/** One cell of a row, by the role of its column. */
export const cellText = (role: string, r: Row, hasUnitColumn: boolean, c: TextContext): string => {
  const x = r.row;
  switch (role) {
    case "stamp": return stampText(x.ts, c);
    case "unit": return x.unit;
    case "quality": return "good";
    case "recipe": return c.profile.phase_model.recipe;
    case "procedure": return c.profile.phase_model.procedure;
    case "unit_procedure": return c.profile.phase_model.unit_procedure;
    case "operation": return c.profile.phase_model.operation;
    default:
  }
  if (r.kind === "tag") {
    if (role === "tag") return named(`${r.row.signal}.${r.row.role}`, r.row.unit, hasUnitColumn);
    if (role === "value") return String(r.row.value);
  } else if (r.kind === "alarm") {
    const a = r.row;
    if (role === "alarm") return named(a.alarm_id, a.unit, hasUnitColumn);
    if (role === "tag") return a.tag ?? "";
    if (role === "severity") return a.severity === null ? "" : String(a.severity);
    if (role === "from_state") return a.from;
    if (role === "to_state" || role === "state") return a.to;
    if (role === "user") return a.actor ?? "";
  } else {
    const p = r.row;
    if (role === "batch") return p.batch;
    if (role === "phase") return named(p.phase, p.unit, hasUnitColumn);
    if (role === "from_state") return p.from;
    if (role === "to_state" || role === "state") return p.to;
  }
  throw new Error(`controller emitter: no cell for the role ${role} in a ${r.kind} row`);
};

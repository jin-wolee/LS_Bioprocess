import { cellText, clockText, dateText } from "./controller_text.ts";
import type { Row, TextContext } from "./controller_text.ts";
import { logKindOf } from "./controller_types.ts";
import type { AlarmTransition, ControllerFile, ControllerProfile, PhaseTransition, TagRow } from "./controller_types.ts";
import { BANNER } from "./types.ts";

// The generic controller emitter (spec 2.4.1; prompts/20 Step 7): one function from tag rows, alarm and phase transitions and a controller profile to file text. It branches on no
// profile id: the logs, their columns and the role of each column are profile data. Integer seconds become wall-clock text only here. The files are cut by the scenario's
// controller_log_cut (A217): one file per record type per day, which reaches the host at the end of its day, or one file per row, which reaches the host at its own stamp.
// A log with no row has no file (an empty log carries no information), so the second family's user-event and error exports are never written: nothing models a user action or a
// controller error. The emitter reads plain data only; it never reads truth.

const DAY = 86400;

export interface EmitControllerInput {
  profile: ControllerProfile;
  /** The controller (one per bay): the second part of every file name. */
  controller: string;
  anchor_epoch_s: number;
  /** The zone a local wall-clock stamp is written in (A161: the instrument's configured zone). */
  zone_offset_s: number;
  cut: "daily" | "per_row";
  tags: readonly TagRow[];
  alarms: readonly AlarmTransition[];
  phases: readonly PhaseTransition[];
}

export const emitController = (input: EmitControllerInput): ControllerFile[] => {
  if (input.cut !== "daily" && input.cut !== "per_row") throw new Error(`controller emitter: the cut must be daily or per_row (A217), got ${String(input.cut)}`);
  const c: TextContext = { profile: input.profile, anchor_epoch_s: input.anchor_epoch_s, zone_offset_s: input.zone_offset_s };
  const files: ControllerFile[] = [];
  for (const log of input.profile.logs) {
    const kind = logKindOf(log.log);
    if (kind === "unmodelled") continue;
    const rows: Row[] = kind === "tag" ? input.tags.map((row) => ({ kind, row })) : kind === "alarm" ? input.alarms.map((row) => ({ kind, row })) : input.phases.map((row) => ({ kind, row }));
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.row.ts - b.row.ts);
    const hasUnitColumn = log.roles.includes("unit");
    const header = log.columns.join(",");
    const line = (r: Row): string => log.roles.map((role) => cellText(role, r, hasUnitColumn, c)).join(",");
    const file = (name: string, group: readonly Row[], received_at: number): ControllerFile => ({
      file_name: `${log.file_prefix}_${input.controller}_${name}.csv`, text: `${[BANNER, header, ...group.map(line)].join("\n")}\n`,
      controller: input.controller, profile_id: input.profile.profile_id, log: log.log, received_at, rows: group.length,
    });
    if (input.cut === "per_row") {
      rows.forEach((r, i) => files.push(file(`${dateText(r.row.ts, c)}_${clockText(r.row.ts, c)}_${String(i + 1).padStart(6, "0")}`, [r], r.row.ts)));
      continue;
    }
    // daily: rows are in time order, so the days come out in order
    const days = new Map<number, Row[]>();
    for (const r of rows) {
      const day = Math.floor(r.row.ts / DAY);
      const group = days.get(day);
      if (group) group.push(r);
      else days.set(day, [r]);
    }
    for (const [day, group] of days) files.push(file(dateText(day * DAY, c), group, (day + 1) * DAY));
  }
  return files;
};

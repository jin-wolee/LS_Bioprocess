import { anchorEpoch } from "../../calendar.ts";
import { param } from "../../profiles.ts";
import type { Profile } from "../../profiles.ts";
import type { EntryConfig } from "../../record/rule_types.ts";
import type { Roster } from "../../record/review.ts";
import type { RawSettings } from "../../scenario.ts";
import type { Dialect } from "../../raw/types.ts";
import type { RawSetup } from "./raw_path.ts";

// The raw-layer setup of a run, built from the scenario's raw settings, the analyzer profile and the dialects (all parsed data; the engine reads no file). The assembly may read
// the profile; the emitters and the parser receive plain data only.

const DAY = 86400;

/** The export schedule window_end: once per instrument at the end of each staffed window (spec section 2.4.2; A216, the window is A098). A result after the window end goes out at once. */
export const exportAtWindowEnd = (roster: Roster): ((t: number) => number) => (t) => {
  const day = Math.floor(t / DAY);
  return Math.max(t, day * DAY + (day % 7 >= 5 ? roster.end_weekend_s : roster.end_weekday_s));
};

/** The export schedule per_run (A216): each result leaves at the host instant it is produced, which is the entry time the manual path gives the same result. */
export const exportPerRun = (t: number): number => t;

export const rawSetupFor = (raw: RawSettings, analyzer: Profile, dialects: Readonly<Record<string, Dialect>>, roster: Roster): RawSetup => {
  const ladder = analyzer.route?.[0]?.dilution_factors;
  return {
    dialects, anchor_epoch_s: anchorEpoch(raw.calendar_anchor), zone_offset_s: raw.zone_offset_s,
    visits: (analyzer.route ?? []).map((st) => {
      if (st.dialect === undefined) throw new Error(`analyzer profile ${analyzer.profile_id}: the stage ${st.group} names no dialect, which the raw layer needs`);
      return { dialect: st.dialect, analytes: st.analytes.map((a) => a.id), run_s: param(analyzer.params, st.service, "s") };
    }),
    default_dilution: ladder && ladder[0] !== undefined ? param(analyzer.params, ladder[0], "factor") : null,
    export_at: raw.export_schedule === "per_run" ? exportPerRun : exportAtWindowEnd(roster),
    ...(raw.capture_path !== undefined && { capture_path: raw.capture_path }),
  };
};

/** What the rules on a typed entry (VR-005, VR-006, VR-013) expect: the units, bounds and dilution rule of the method, from the dialect data and the analyzer profile (A090). */
export const entryConfigFor = (analyzer: Profile, dialects: Readonly<Record<string, Dialect>>): EntryConfig => {
  const analytes: EntryConfig["analytes"] = {};
  const dimension_of: Record<string, string> = {};
  for (const d of Object.values(dialects)) {
    for (const u of Object.values(d.units)) dimension_of[u.ucum] = u.dimension;
    for (const c of d.columns) {
      const unit = c.unit_text === undefined ? undefined : d.units[c.unit_text];
      if (c.kind === "value" && c.analyte && unit) (analytes as Record<string, { dimension: string; physical: "non_negative" | "percent" | "ph_scale" }>)[c.analyte] = { dimension: unit.dimension, physical: (c.physical ?? "non_negative") as "non_negative" | "percent" | "ph_scale" };
    }
  }
  const stages = (analyzer.route ?? []).filter((s) => (s.dilution_factors ?? []).length > 0);
  return {
    analytes, dimension_of,
    dilution: { analytes: stages.flatMap((s) => s.analytes.map((a) => a.id)), factors: [...new Set(stages.flatMap((s) => (s.dilution_factors ?? []).map((n) => param(analyzer.params, n, "factor"))))] },
  };
};

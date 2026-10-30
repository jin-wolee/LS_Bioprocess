import { anchorEpoch } from "../../calendar.ts";
import { param } from "../../profiles.ts";
import type { Profile } from "../../profiles.ts";
import type { EntryConfig } from "../../record/rule_types.ts";
import type { Roster } from "../../record/review.ts";
import type { RawSettings } from "../../scenario.ts";
import type { ControllerProfile } from "../../raw/controller_types.ts";
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

/** The analyzer profile of a scenario, or the distinct listed profiles of a mixed fleet in the order of the plan (spec section 4.5.4): the visit k is the stage k of the plan. */
export type Analyzers = Profile | readonly Profile[];
const planOf = (analyzers: Analyzers): readonly Profile[] => ("profile_id" in analyzers ? [analyzers] : analyzers);
/** The stages of the plan with the profile whose parameters they name. */
const stagesOf = (analyzers: Analyzers): { stage: NonNullable<Profile["route"]>[number]; profile: Profile }[] =>
  planOf(analyzers).flatMap((profile) => (profile.route ?? []).map((stage) => ({ stage, profile })));

export const rawSetupFor = (raw: RawSettings, analyzers: Analyzers, dialects: Readonly<Record<string, Dialect>>, roster: Roster, controllers: Readonly<Record<string, ControllerProfile>> = {}): RawSetup => {
  const stages = stagesOf(analyzers);
  const first = stages[0];
  const ladder = first?.stage.dilution_factors;
  return {
    dialects, anchor_epoch_s: anchorEpoch(raw.calendar_anchor), zone_offset_s: raw.zone_offset_s,
    visits: stages.map(({ stage: st, profile }) => {
      if (st.dialect === undefined) throw new Error(`analyzer profile ${profile.profile_id}: the stage ${st.group} names no dialect, which the raw layer needs`);
      return { dialect: st.dialect, analytes: st.analytes.map((a) => a.id), run_s: param(profile.params, st.service, "s") };
    }),
    default_dilution: first && ladder && ladder[0] !== undefined ? param(first.profile.params, ladder[0], "factor") : null,
    export_at: raw.export_schedule === "per_run" ? exportPerRun : exportAtWindowEnd(roster),
    ...(raw.capture_path !== undefined && { capture_path: raw.capture_path }),
    // the controller side exists only where the scenario puts a controller profile on each bay (spec 2.4.2); the cut is A217
    ...(raw.bay_controllers !== undefined && { controller: { profiles: controllers, bays: raw.bay_controllers, cut: raw.controller_log_cut, set_points: raw.set_points } }),
  };
};

/** What the rules on a typed entry (VR-005, VR-006, VR-013) expect: the units, bounds and dilution rule of the method, from the dialect data and the analyzer profile (A090). */
export const entryConfigFor = (analyzers: Analyzers, dialects: Readonly<Record<string, Dialect>>): EntryConfig => {
  const analytes: EntryConfig["analytes"] = {};
  const dimension_of: Record<string, string> = {};
  for (const d of Object.values(dialects)) {
    for (const u of Object.values(d.units)) dimension_of[u.ucum] = u.dimension;
    for (const c of d.columns) {
      const unit = c.unit_text === undefined ? undefined : d.units[c.unit_text];
      if (c.kind === "value" && c.analyte && unit) (analytes as Record<string, { dimension: string; physical: "non_negative" | "percent" | "ph_scale" }>)[c.analyte] = { dimension: unit.dimension, physical: (c.physical ?? "non_negative") as "non_negative" | "percent" | "ph_scale" };
    }
  }
  const stages = stagesOf(analyzers).filter(({ stage }) => (stage.dilution_factors ?? []).length > 0);
  return {
    analytes, dimension_of,
    dilution: { analytes: stages.flatMap(({ stage }) => stage.analytes.map((a) => a.id)), factors: [...new Set(stages.flatMap(({ stage, profile }) => (stage.dilution_factors ?? []).map((n) => param(profile.params, n, "factor"))))] },
  };
};

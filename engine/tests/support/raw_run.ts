import { evaluationSettings } from "../../src/evaluate/config.ts";
import { seedInputFromRun } from "../../src/experiments/assembly/from_run.ts";
import { rawSetupFor, entryConfigFor } from "../../src/experiments/assembly/raw_setup.ts";
import type { SeedInput } from "../../src/experiments/assembly/run_seed.ts";
import type { ControllerProfile } from "../../src/generated/controller_profile.schema";
import type { Dialect } from "../../src/generated/dialect.schema";
import type { Profile } from "../../src/profiles.ts";
import { loadProfile } from "../../src/profiles.ts";
import type { CapturePath } from "../../src/raw/types.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { runScenario } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import type { ScenarioConfig } from "../../src/scenario.ts";
import { profileOf } from "./controller_fixtures.ts";
import { dialectOf } from "./raw_fixtures.ts";
import { readJson } from "./paths.ts";
import { REVIEW } from "./review_setup.ts";
import { lookup, patched, rawScenario } from "./scenarios.ts";
import type { Patch } from "./scenarios.ts";

// A scenario with the raw device layer on (test-side): the default scenario plus raw_layer, a calendar anchor (the synthetic Monday 2030-01-07), the instruments' zone (0 h, A161: a
// scenario input) and, when asked, a capture path override. The truth run is the same as the scenario without the layer: the layer adds no truth event.

export const DIALECTS: Readonly<Record<string, Dialect>> = Object.fromEntries(["allinone_csv", "counter_csv", "cds_table"].map((id) => [id, dialectOf(id)]));
export const CONTROLLERS: Readonly<Record<string, ControllerProfile>> = Object.fromEntries(["ctrl_neutral", "ctrl_bench"].map((id) => [id, profileOf(id)]));

/** The default raw-layer scenario puts one bay on each controller family (spec 2.4.2: a design choice, no claim about any site); `bay_controllers: null` leaves the layer analyzer-side only. */
export const BAY_FAMILIES = ["ctrl_neutral", "ctrl_bench"] as const;

export interface RawOverrides {
  capture_path?: CapturePath;
  raw_layer?: boolean;
  export_schedule?: "window_end" | "per_run";
  controller_log_cut?: "daily" | "per_row";
  bay_controllers?: readonly string[] | null;
}

export const rawConfigOf = (name: string, p: Patch = {}, over: RawOverrides = {}): ScenarioConfig => {
  const doc = patched(rawScenario(name), p);
  doc.raw_layer = over.raw_layer ?? true;
  doc.calendar_anchor = "2030-01-07";
  (doc.settings as Record<string, unknown>).device_zone_h = { value: 0, unit: "h", ref: "A161" };
  if (over.capture_path) doc.capture_path = over.capture_path;
  if (over.export_schedule) doc.export_schedule = over.export_schedule;
  if (over.controller_log_cut) doc.controller_log_cut = over.controller_log_cut;
  // one controller profile per bay (S2f F6): the default puts the families on the bays in order, so a one-bay variant (SMALL) gets the first family only; an explicit list is taken as given
  const setting = (name: string): number => ((doc.settings as Record<string, { value: number }>)[name] as { value: number }).value;
  const bays = Math.ceil(setting("reactor_count") / setting("bay_size"));
  if (over.bay_controllers !== null) doc.bay_controllers = [...(over.bay_controllers ?? BAY_FAMILIES.slice(0, bays))];
  return loadScenario(doc, lookup);
};

const staff = loadProfile(lookup("staff", "experienced"), "staff").params;
const evaluation = evaluationSettings(readJson("data", "scenarios", "evaluation", "default.json"));

/** The input of `runSeed` for a layer-on scenario run, with the raw setup and the typed-entry rules built from the scenario, the analyzer profile and the dialects. */
export const rawInputOf = (run: ScenarioRun, config: ScenarioConfig, scenario_id: string, architectures: readonly Architecture[], days: number): SeedInput => {
  if (!config.raw) throw new Error("the scenario has the raw layer off");
  const analyzer = lookup("analyzer", "allinone_atline") as Profile;
  const roster = { start_s: config.sampling.start_s, shift_change_s: config.sampling.shiftChange_s, end_weekday_s: config.sampling.endWeekday_s, end_weekend_s: config.sampling.endWeekend_s };
  return seedInputFromRun(run, {
    scenario_id, staff, evaluation, architectures, days, review: REVIEW,
    raw: rawSetupFor(config.raw, analyzer, DIALECTS, roster, CONTROLLERS), entry_rules: entryConfigFor(analyzer, DIALECTS),
  });
};

export const rawRunOf = (name: string, p: Patch, over?: Parameters<typeof rawConfigOf>[2]): { run: ScenarioRun; config: ScenarioConfig } => {
  const config = rawConfigOf(name, p, over);
  return { run: runScenario(config), config };
};

import type { Profile, ProfileLookup } from "../../../profiles.ts";
import { loadProfile } from "../../../profiles.ts";
import { loadScenario } from "../../../scenario.ts";
import type { ScenarioConfig } from "../../../scenario.ts";
import type { CapturePath } from "../../../raw/types.ts";

// What the lab Worker holds: parsed JSON only. The engine reads no file (spec section 3), so src/worker/data.ts imports the files and hands them over as they are.

export interface LabData {
  /** The parsed scenario documents by scenario_id: the ones the lab offers. */
  scenarios: Readonly<Record<string, unknown>>;
  /** The parsed profiles the scenarios and the Setup lists can name. */
  lookup: ProfileLookup;
  /** The same profiles as a list, for the catalogue of `ready` (bioreactor, analyzer and staff profiles). */
  profiles: readonly unknown[];
  /** The parsed analyzer dialects by dialect_id: the raw layer needs them when a run names a capture path. */
  dialects: Readonly<Record<string, unknown>>;
  /** The parsed preset documents, A, B and C in this order. */
  architectures: readonly unknown[];
  /** The parsed evaluation settings. */
  evaluation: unknown;
  /** The parsed experiment 1 config: its seed list is the list the Setup page offers (A103). */
  experiment: unknown;
  /** The lab's own inputs for the raw layer (the calendar anchor and the instruments' zone, A161). */
  rawLayer: unknown;
}

/** The parts of a RunSpec that change the scenario beyond its settings. */
export interface ScenarioExtras {
  bay_profiles?: readonly string[];
  analyzer_profiles?: readonly string[];
  capture_path?: CapturePath;
}

interface ScenarioDoc {
  settings: Record<string, { value: number; unit: string; ref: string }>;
  profiles: Record<string, string>;
  [field: string]: unknown;
}

interface RawLayerDoc {
  calendar_anchor: string;
  device_zone_h: { value: number; unit: string; ref: string };
}

/** The parsed document of a bundled scenario; the caller has checked the id. */
export const scenarioDoc = (data: LabData, id: string): ScenarioDoc => data.scenarios[id] as ScenarioDoc;

export const rawLayerDoc = (data: LabData): RawLayerDoc => data.rawLayer as RawLayerDoc;

/**
 * The scenario with the `value` of named settings replaced (unit and ref stay), the profile lists set when given, the raw layer switched on when a capture path is named, and the
 * run seed set. A name the scenario lacks throws, as loading a bad scenario does; so do the engine's own checks of the lists (spec section 4.5.3), with the engine's message.
 */
export const scenarioConfig = (data: LabData, id: string, settings: Readonly<Record<string, number>>, seed: number, extras: ScenarioExtras = {}): ScenarioConfig => {
  const doc = structuredClone(data.scenarios[id]) as ScenarioDoc;
  for (const [name, value] of Object.entries(settings)) {
    const setting = doc.settings[name];
    if (!setting) throw new Error(`scenario ${id}: no setting ${name}`);
    setting.value = value;
  }
  if (extras.bay_profiles) doc.bay_profiles = [...extras.bay_profiles];
  if (extras.analyzer_profiles) doc.analyzer_profiles = [...extras.analyzer_profiles];
  if (extras.capture_path) {
    const raw = rawLayerDoc(data);
    doc.raw_layer = true;
    doc.calendar_anchor = raw.calendar_anchor;
    doc.settings.device_zone_h = structuredClone(raw.device_zone_h);
    doc.capture_path = extras.capture_path;
  }
  return { ...loadScenario(doc, data.lookup), seed };
};

/** The analyzer profiles of a run in the order of the plan (spec section 4.5.4): the distinct listed profiles, or the scenario's own when no list is given. */
export const analyzerPlan = (data: LabData, id: string, listed?: readonly string[]): Profile[] =>
  [...new Set(listed ?? [scenarioDoc(data, id).profiles.analyzer])].map((profile) => loadProfile(data.lookup("analyzer", profile as string), "analyzer"));

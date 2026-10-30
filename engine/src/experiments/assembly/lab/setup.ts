import type { ProfileLookup } from "../../../profiles.ts";
import { loadScenario } from "../../../scenario.ts";
import type { ScenarioConfig } from "../../../scenario.ts";

// What the lab Worker holds: parsed JSON only. The engine reads no file (spec section 3), so src/worker/data.ts imports the files and hands them over as they are.

export interface LabData {
  /** The parsed scenario documents by scenario_id: the ones the lab offers. */
  scenarios: Readonly<Record<string, unknown>>;
  /** The parsed profiles the scenarios name. */
  lookup: ProfileLookup;
  /** The parsed preset documents, A, B and C in this order. */
  architectures: readonly unknown[];
  /** The parsed evaluation settings. */
  evaluation: unknown;
}

interface ScenarioDoc {
  settings: Record<string, { value: number; unit: string; ref: string }>;
  profiles: Record<string, string>;
}

/** The parsed document of a bundled scenario; the caller has checked the id. */
export const scenarioDoc = (data: LabData, id: string): ScenarioDoc => data.scenarios[id] as ScenarioDoc;

/** The scenario with the `value` of named settings replaced (unit and ref stay) and the run seed set. A name the scenario lacks throws, as loading a bad scenario does. */
export const scenarioConfig = (data: LabData, id: string, settings: Readonly<Record<string, number>>, seed: number): ScenarioConfig => {
  const doc = structuredClone(data.scenarios[id]) as ScenarioDoc;
  for (const [name, value] of Object.entries(settings)) {
    const setting = doc.settings[name];
    if (!setting) throw new Error(`scenario ${id}: no setting ${name}`);
    setting.value = value;
  }
  return { ...loadScenario(doc, data.lookup), seed };
};

import { FLAG_NAMES } from "../../../record/architecture.ts";
import { ENGINE_VERSION } from "../../../trace.ts";
import { scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";

// What the Worker tells the page at start-up, as plain data (docs/design/lab_ui.md section 4, `ready`): the engine version, the schema version, the flags the engine has (the page never
// types how many there are) and the scenarios the lab offers with every setting, its unit and its ledger id (ADR-0012: each parameter is {value, unit, ref}).

export interface RefValue {
  name: string;
  value: number | string;
  unit: string;
  ref: string;
}

export interface ScenarioInfo {
  id: string;
  description: string;
  settings: RefValue[];
  profiles: Record<string, string>;
}

export interface Ready {
  engine_version: string;
  schema_version: "1";
  flags: string[];
  scenarios: ScenarioInfo[];
}

export const scenarioInfos = (data: LabData): ScenarioInfo[] =>
  Object.keys(data.scenarios).map((id) => {
    const doc = scenarioDoc(data, id) as ReturnType<typeof scenarioDoc> & { description: string };
    return {
      id,
      description: doc.description,
      settings: Object.entries(doc.settings).map(([name, s]) => ({ name, value: s.value, unit: s.unit, ref: s.ref })),
      profiles: { ...doc.profiles },
    };
  });

export const readyOf = (data: LabData): Ready => ({ engine_version: ENGINE_VERSION, schema_version: "1", flags: [...FLAG_NAMES], scenarios: scenarioInfos(data) });

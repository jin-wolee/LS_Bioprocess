import { ABLATIONS, parseArchitecture } from "../../../record/architecture.ts";
import { checkSeeds } from "../config.ts";
import { scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";

// The RunSpec of the lab protocol (docs/design/lab_ui.md section 4). A shareable link is user input, so the Worker checks the spec before it runs anything: the
// scenario id, the names of the settings against the scenario's own, the architecture ids and the seeds (the rules of the experiment config).

export interface RunSpec {
  schema_version: "1";
  scenario: string;
  /** Replaces only the `value` of named scenario settings; unit and ref stay. */
  settings: Record<string, number>;
  architectures: string[];
  seeds: number[];
}

export type SpecCheck = { ok: true; spec: RunSpec } | { ok: false; message: string };

const KEYS = ["schema_version", "scenario", "settings", "architectures", "seeds"];

const refuse = (message: string): SpecCheck => ({ ok: false, message });

/** The ids a spec may name: the presets, and the last one (C, the preset that is ablated flag by flag) with one flag off. The engine branches on no preset id (scenarios_data.test.ts), so C is the last of the list. */
export const architectureIds = (data: LabData): string[] => {
  const presets = data.architectures.map(parseArchitecture);
  const ablated = presets.slice(-1).flatMap((a) => ABLATIONS(a).map((x) => x.config.id));
  return [...presets.map((a) => a.id), ...ablated];
};

export const checkRunSpec = (raw: unknown, data: LabData): SpecCheck => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return refuse("the spec must be an object");
  const doc = raw as Record<string, unknown>;
  for (const key of Object.keys(doc)) if (!KEYS.includes(key)) return refuse(`unknown key "${key}"`);
  if (doc.schema_version !== "1") return refuse('schema_version must be "1"');

  const bundled = Object.keys(data.scenarios);
  const scenario = doc.scenario;
  if (typeof scenario !== "string" || !Object.hasOwn(data.scenarios, scenario)) return refuse(`unknown scenario ${JSON.stringify(scenario)} (bundled: ${bundled.join(", ")})`);

  const given = doc.settings ?? {};
  if (typeof given !== "object" || given === null || Array.isArray(given)) return refuse("settings must be an object");
  const known = scenarioDoc(data, scenario).settings;
  for (const [name, value] of Object.entries(given)) {
    if (!Object.hasOwn(known, name)) return refuse(`unknown setting "${name}" for scenario ${scenario}`);
    if (typeof value !== "number" || !Number.isFinite(value)) return refuse(`setting ${name} must be a finite number`);
  }

  const architectures = doc.architectures;
  if (!Array.isArray(architectures)) return refuse("architectures must be a list");
  const ids = architectureIds(data);
  for (const [i, id] of architectures.entries()) {
    if (typeof id !== "string" || !ids.includes(id)) return refuse(`unknown architecture ${JSON.stringify(id)} (offered: ${ids.join(", ")})`);
    if (architectures.indexOf(id) !== i) return refuse(`architecture "${id}" is repeated`);
  }

  if (Array.isArray(doc.seeds) && doc.seeds.length === 0) return refuse("seeds must name at least one seed"); // checkSeeds would cite the report minimum (A103), which is not this rule
  let seeds: number[];
  try {
    seeds = checkSeeds(doc.seeds, 1);
  } catch (e) {
    return refuse((e as Error).message.replace(/^experiment config: /, ""));
  }
  return { ok: true, spec: { schema_version: "1", scenario, settings: { ...(given as Record<string, number>) }, architectures: [...(architectures as string[])], seeds } };
};

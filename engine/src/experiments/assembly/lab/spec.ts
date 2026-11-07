import type { CapturePath } from "../../../raw/types.ts";
import { ABLATIONS, FLAG_NAMES, parseArchitecture } from "../../../record/architecture.ts";
import type { Architecture } from "../../../record/architecture.ts";
import { checkSeeds } from "../config.ts";
import { checkSettings } from "./settings_bounds.ts";
import { scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";

// The RunSpec of the lab protocol (docs/design/lab_ui.md section 4). A shareable link is user input, so the Worker checks the spec before it runs anything: the scenario id, the names of
// the settings against the scenario's own, their values against physical possibility and the size of the run (settings_bounds.ts; audit A1, F5 and F6), the architecture ids, the
// profile ids of the two lists against the bundled profiles of the right kind, the capture path and the seeds (the rules of the experiment config). The lengths of the two lists and
// every other check of spec section 4.5.3 are the engine's and arrive as engine errors.

export interface RunSpec {
  schema_version: "1";
  scenario: string;
  /** Replaces only the `value` of named scenario settings; unit and ref stay. */
  settings: Record<string, number>;
  /** One bioreactor profile id per bay, bay 1 first (spec section 4.5.2); absent: every bay takes the scenario's own. */
  bay_profiles?: string[];
  /** One analyzer profile id per analyzer, analyzer 1 first; absent: every analyzer takes the scenario's own. */
  analyzer_profiles?: string[];
  /** Overrides the capture path of every preset and turns the raw layer on (spec section 5, "Capture path"). */
  capture_path?: CapturePath;
  architectures: string[];
  seeds: number[];
}

export type SpecCheck = { ok: true; spec: RunSpec } | { ok: false; message: string };

const KEYS = ["schema_version", "scenario", "settings", "bay_profiles", "analyzer_profiles", "capture_path", "architectures", "seeds"];
const CAPTURE_PATHS = ["manual_transcription", "adapter_ingest"];

const refuse = (message: string): SpecCheck => ({ ok: false, message });

/**
 * The architectures a spec may name, in report order: the presets, and the preset that is ablated flag by flag (C) with one flag off. The engine branches on no preset id
 * (scenarios_data.test.ts), so the ablated preset is the first one whose flags are all on, a fact of the data and not a position in the list; a list without one offers no ablation.
 */
export const architecturesOf = (data: LabData): Architecture[] => {
  const presets = data.architectures.map(parseArchitecture);
  const base = ablationBase(presets);
  return [...presets, ...(base ? ABLATIONS(base).map((x) => x.config) : [])];
};

/** The preset that is ablated flag by flag: the first one with every flag on. */
const ablationBase = (presets: readonly Architecture[]): Architecture | undefined => presets.find((a) => FLAG_NAMES.every((f) => a.flags[f]));

/** The id of the preset whose ablations a report names (`<id>_minus_<flag>`); none when no preset has every flag on. */
export const ablationBaseId = (data: LabData): string => ablationBase(data.architectures.map(parseArchitecture))?.id ?? "";

export const architectureIds = (data: LabData): string[] => architecturesOf(data).map((a) => a.id);

/** The ids of the bundled profiles of one kind. */
const profileIds = (data: LabData, kind: string): string[] =>
  data.profiles.flatMap((doc) => {
    const p = doc as { kind?: string; profile_id?: string };
    return p.kind === kind && typeof p.profile_id === "string" ? [p.profile_id] : [];
  });

/** One of the two lists of a spec: a non-empty list of ids of bundled profiles of the right kind. */
const checkProfileList = (data: LabData, field: string, kind: string, given: unknown): { ok: true; list: string[] } | { ok: false; message: string } => {
  if (!Array.isArray(given)) return { ok: false, message: `${field} must be a list` };
  if (given.length === 0) return { ok: false, message: `${field} must name at least one profile` };
  const bundled = profileIds(data, kind);
  for (const [i, id] of given.entries()) {
    if (typeof id !== "string" || !bundled.includes(id)) return { ok: false, message: `${field}[${i}] names ${JSON.stringify(id)}, which is not a bundled ${kind} profile (bundled: ${bundled.join(", ")})` };
  }
  return { ok: true, list: [...(given as string[])] };
};

/** The exact seed rules of a run, also available for a no-run preflight. */
export const checkRunSeeds = (raw: unknown): { ok: true; seeds: number[] } | { ok: false; message: string } => {
  if (Array.isArray(raw) && raw.length === 0) return { ok: false, message: "seeds must name at least one seed" };
  try {
    return { ok: true, seeds: checkSeeds(raw, 1) };
  } catch (e) {
    return { ok: false, message: (e as Error).message.replace(/^experiment config: /, "") };
  }
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
  const impossible = checkSettings(given as Record<string, number>, scenarioDoc(data, scenario));
  if (impossible !== null) return refuse(impossible);

  const lists: { bay_profiles?: string[]; analyzer_profiles?: string[] } = {};
  for (const [field, kind] of [["bay_profiles", "bioreactor"], ["analyzer_profiles", "analyzer"]] as const) {
    if (doc[field] === undefined) continue;
    const checked = checkProfileList(data, field, kind, doc[field]);
    if (!checked.ok) return refuse(checked.message);
    lists[field] = checked.list;
  }
  if (doc.capture_path !== undefined && !CAPTURE_PATHS.includes(doc.capture_path as string)) return refuse(`capture_path must be one of ${CAPTURE_PATHS.join(", ")}`);
  const capture = doc.capture_path as CapturePath | undefined;

  const architectures = doc.architectures;
  if (!Array.isArray(architectures)) return refuse("architectures must be a list");
  const ids = architectureIds(data);
  for (const [i, id] of architectures.entries()) {
    if (typeof id !== "string" || !ids.includes(id)) return refuse(`unknown architecture ${JSON.stringify(id)} (offered: ${ids.join(", ")})`);
    if (architectures.indexOf(id) !== i) return refuse(`architecture "${id}" is repeated`);
  }

  const checkedSeeds = checkRunSeeds(doc.seeds);
  if (!checkedSeeds.ok) return refuse(checkedSeeds.message);
  const seeds = checkedSeeds.seeds;
  return {
    ok: true,
    spec: { schema_version: "1", scenario, settings: { ...(given as Record<string, number>) }, ...lists, ...(capture && { capture_path: capture }), architectures: [...(architectures as string[])], seeds },
  };
};

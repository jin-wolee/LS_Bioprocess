import type { CapturePath, PlantAction, PlantSpec } from "../protocol.ts";
import { DEFAULT_PLANT } from "./spec.ts";

// The link of the plant (docs/design/plant_ui.md section 7, "As built in P5c"): `#/plant?scenario=..&set.<name>=..&bays=..&analyzers=..&capture=..&arch=..&seed=..&actions=..&t=..&schema=1&engine=<version>`.
// It holds the spec, the actions and the instant, never a result. A link is user input, so it is read like a spec: a key the page knows how to check it checks and, when the value is not good, falls back
// on the default and says which key fell back (`notes`); what only the Worker can check (the profile lists, the setting names, the seed rules, each action and its bounds) it passes on untouched, and the
// Worker's refusal is shown as the plant's problem. Pure functions, no DOM.

const CAPTURE: readonly CapturePath[] = ["manual_transcription", "adapter_ingest"];

/** What the page knows of the build, to check a link against: the scenarios and the record architectures (the presets and the ablations of C). */
export interface Known {
  scenarios: readonly string[];
  architectures: readonly string[];
}

/** A key of the link whose value the page could not use, and the value as given. */
export interface LinkNote {
  field: "scenario" | "settings" | "capture" | "arch" | "seed" | "actions" | "t" | "schema";
  given: string;
}

export interface PlantLink {
  spec: PlantSpec;
  /** The instant of the run the clock opens at, whole seconds; null when the link has none (or has a bad one, which is in `notes`). Whether it lies inside the run is `instantIn`'s. */
  t: number | null;
  /** The sample of a drill-down (`sample=`). */
  sample: string | null;
  /** The link came from the plant (`from=plant`). */
  from: boolean;
  /** The engine version the link was made with; the page says so when it is not the build's. */
  engine: string | null;
  notes: LinkNote[];
}

const encode = (value: string): string => encodeURIComponent(value).replaceAll("%2C", ",");

/** The query of a plant: the keys that differ from the defaults (settings, lists, capture path, actions, instant) only when they are there. `t` is whole seconds of the run. */
export const plantQuery = (spec: PlantSpec, { engine, t }: { engine: string; t?: number | null }): string => {
  const { run } = spec;
  const pairs: [string, string][] = [["scenario", run.scenario]];
  for (const name of Object.keys(run.settings).sort()) pairs.push([`set.${name}`, String(run.settings[name])]);
  if (run.bay_profiles) pairs.push(["bays", run.bay_profiles.join(",")]);
  if (run.analyzer_profiles) pairs.push(["analyzers", run.analyzer_profiles.join(",")]);
  if (run.capture_path) pairs.push(["capture", run.capture_path]);
  pairs.push(["arch", run.architectures.join(",")], ["seed", String(spec.seed)]);
  const out = pairs.map(([k, v]) => `${k}=${encode(v)}`);
  if (spec.actions.length > 0) out.push(`actions=${encodeURIComponent(JSON.stringify(spec.actions))}`);
  if (t !== undefined && t !== null) out.push(`t=${t}`);
  out.push("schema=1", `engine=${encode(engine)}`);
  return out.join("&");
};

const list = (text: string): string[] => text.split(",").filter((x) => x !== "");

/** The plant a query describes, with the default plant for whatever it does not say or says badly. */
export const plantFromQuery = (query: string, known: Known, fallback: PlantSpec = DEFAULT_PLANT): PlantLink => {
  const q = new URLSearchParams(query);
  const notes: LinkNote[] = [];
  const note = (field: LinkNote["field"], given: string): void => void notes.push({ field, given });

  let scenario = fallback.run.scenario;
  const named = q.get("scenario");
  if (named !== null && known.scenarios.includes(named)) scenario = named;
  else if (named !== null) note("scenario", named);

  const settings: Record<string, number> = {};
  for (const [key, value] of q.entries()) {
    if (!key.startsWith("set.")) continue;
    if (/^-?\d+(\.\d+)?$/.test(value)) settings[key.slice(4)] = Number(value);
    else note("settings", `${key}=${value}`);
  }

  let capture: CapturePath | undefined;
  const path = q.get("capture");
  if (path !== null) {
    capture = CAPTURE.find((c) => c === path);
    if (!capture) note("capture", path);
  }

  let architectures = [...fallback.run.architectures];
  const halls = q.get("arch");
  if (halls !== null) {
    const given = list(halls);
    const kept = given.filter((a) => known.architectures.includes(a));
    const dropped = given.filter((a) => !known.architectures.includes(a));
    if (dropped.length > 0 || kept.length === 0) note("arch", dropped.length > 0 ? dropped.join(",") : halls);
    if (kept.length > 0) architectures = kept;
  }

  let seed = fallback.seed;
  const typed = q.get("seed");
  if (typed !== null) {
    if (/^\d{1,15}$/.test(typed)) seed = Number(typed);
    else note("seed", typed);
  }

  let actions: PlantAction[] = [];
  const carried = q.get("actions");
  if (carried !== null) {
    try {
      const parsed: unknown = JSON.parse(carried);
      if (Array.isArray(parsed)) actions = parsed as PlantAction[];
      else note("actions", carried);
    } catch {
      note("actions", carried);
    }
  }

  let t: number | null = null;
  const instant = q.get("t");
  if (instant !== null) {
    if (/^\d{1,15}$/.test(instant)) t = Number(instant);
    else note("t", instant);
  }

  const schema = q.get("schema");
  if (schema !== null && schema !== "1") note("schema", schema);

  const lists: { bay_profiles?: string[]; analyzer_profiles?: string[] } = {};
  if (q.has("bays")) lists.bay_profiles = list(q.get("bays") ?? "");
  if (q.has("analyzers")) lists.analyzer_profiles = list(q.get("analyzers") ?? "");

  return {
    spec: { run: { schema_version: "1", scenario, settings, ...lists, ...(capture && { capture_path: capture }), architectures, seeds: [seed] }, seed, actions },
    t,
    sample: q.get("sample"),
    from: q.get("from") === "plant",
    engine: q.get("engine"),
    notes,
  };
};

/** The instant of a link against the run it opens: kept when it lies from the start of the run to its horizon, else none and the value as given. */
export const instantIn = (t: number | null, horizon: number): { t: number | null; fault: string | null } =>
  t === null ? { t: null, fault: null } : t >= 0 && t <= horizon ? { t, fault: null } : { t: null, fault: String(t) };

/** The key by which two specs are the same plant: the actions as a set (the Worker names them in one order whatever the order of entry) and the rest as it is. */
const keyOf = (spec: PlantSpec): string => {
  const { run } = spec;
  const settings = Object.fromEntries(Object.keys(run.settings).sort().map((k) => [k, run.settings[k]]));
  return JSON.stringify([run.scenario, settings, run.bay_profiles ?? null, run.analyzer_profiles ?? null, run.capture_path ?? null, run.architectures, spec.seed, spec.actions.map((a) => JSON.stringify(a)).sort()]);
};

/** Whether a run has to be asked for again: it has not when the plant on screen was asked for under this very spec. */
export const sameSpec = (a: PlantSpec | null, b: PlantSpec | null): boolean => a !== null && b !== null && keyOf(a) === keyOf(b);

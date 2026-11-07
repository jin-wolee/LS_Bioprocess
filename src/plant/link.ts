import type { CapturePath, PlantAction, PlantCaseSpec, PlantSpec } from "../protocol.ts";
import { DEFAULT_PLANT, isCase } from "./spec.ts";
import type { PlantAsk } from "./spec.ts";

// The link of the plant (docs/design/plant_ui.md section 7, "As built in P5c"): `#/plant?scenario=..&set.<name>=..&bays=..&analyzers=..&capture=..&arch=..&seed=..&actions=..&t=..&schema=1&engine=<version>`.
// It holds the spec, the actions and the instant, never a result. A link is user input, so it is read like a spec: a key the page knows how to check it checks and, when the value is not good, falls back
// on the default and says which key fell back (`notes`); what only the Worker can check (the profile lists, the setting names, the seed rules, each action and its bounds) it passes on untouched, and the
// Worker's refusal is shown as the plant's problem. Pure functions, no DOM.
//
// P7c ("As built in P7c"): a break-out case is `case=<scenario id>` in place of `scenario=` and the keys of the run form, with `arch`, `seed`, `actions` and `t` as in any link. `askFromQuery` reads
// either kind; `plantFromQuery` reads the run form only.

const CAPTURE: readonly CapturePath[] = ["manual_transcription", "adapter_ingest"];

/** What the page knows of the build, to check a link against: the scenarios and the record architectures (the presets and the ablations of C). */
export interface Known {
  scenarios: readonly string[];
  architectures: readonly string[];
  /** The Break-out cases of the build and the defaults of its form (the first seed, the records it starts from); null, or absent, in a build that offers none (the public build). */
  breakout?: { cases: readonly string[]; seed: number; architectures: readonly string[] } | null;
}

/** A key of the link whose value the page could not use, and the value as given. */
export interface LinkNote {
  field: "case" | "scenario" | "settings" | "capture" | "arch" | "seed" | "actions" | "t" | "schema";
  given: string;
}

export interface PlantLink<S extends PlantAsk = PlantSpec> {
  spec: S;
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

/** A link of either kind: a run form or a break-out case. */
export type AskLink = PlantLink<PlantAsk>;

const encode = (value: string): string => encodeURIComponent(value).replaceAll("%2C", ",");

/** The query of a plant: the keys that differ from the defaults (settings, lists, capture path, actions, instant) only when they are there. `t` is whole seconds of the run. A case is its case, halls, seed, actions and instant. */
export const plantQuery = (spec: PlantAsk, { engine, t }: { engine: string; t?: number | null }): string => {
  const pairs: [string, string][] = [];
  if (isCase(spec)) pairs.push(["case", spec.case], ["arch", spec.architectures.join(",")], ["seed", String(spec.seed)]);
  else {
    const { run } = spec;
    pairs.push(["scenario", run.scenario]);
    for (const name of Object.keys(run.settings).sort()) pairs.push([`set.${name}`, String(run.settings[name])]);
    if (run.bay_profiles) pairs.push(["bays", run.bay_profiles.join(",")]);
    if (run.analyzer_profiles) pairs.push(["analyzers", run.analyzer_profiles.join(",")]);
    if (run.capture_path) pairs.push(["capture", run.capture_path]);
    pairs.push(["arch", run.architectures.join(",")], ["seed", String(spec.seed)]);
  }
  const out = pairs.map(([k, v]) => `${k}=${encode(v)}`);
  if (spec.actions.length > 0) out.push(`actions=${encodeURIComponent(JSON.stringify(spec.actions))}`);
  if (t !== undefined && t !== null) out.push(`t=${t}`);
  out.push("schema=1", `engine=${encode(engine)}`);
  return out.join("&");
};

const list = (text: string): string[] => text.split(",").filter((x) => x !== "");

type Note = (field: LinkNote["field"], given: string) => void;

/** The record halls of a link: the ones the page knows (the others are dropped and named), else `fallback`. */
const hallsFrom = (q: URLSearchParams, known: Known, fallback: readonly string[], note: Note): string[] => {
  const halls = q.get("arch");
  if (halls === null) return [...fallback];
  const given = list(halls);
  const kept = given.filter((a) => known.architectures.includes(a));
  const dropped = given.filter((a) => !known.architectures.includes(a));
  if (dropped.length > 0 || kept.length === 0) note("arch", dropped.length > 0 ? dropped.join(",") : halls);
  return kept.length > 0 ? kept : [...fallback];
};

const seedFrom = (q: URLSearchParams, fallback: number, note: Note): number => {
  const typed = q.get("seed");
  if (typed === null) return fallback;
  if (/^\d{1,15}$/.test(typed)) return Number(typed);
  note("seed", typed);
  return fallback;
};

/** Bound untrusted action payloads before comparison or structured cloning. */
export const safeActions = (value: unknown): value is PlantAction[] =>
  Array.isArray(value) && value.length <= 16 && value.every((action: unknown) => {
    if (typeof action !== "object" || action === null || Array.isArray(action)) return false;
    const entries = Object.entries(action);
    return entries.length <= 16 && entries.every(([key, v]) => key.length <= 128 &&
      (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 256)));
  });

const actionsFrom = (q: URLSearchParams, note: Note): PlantAction[] => {
  const carried = q.get("actions");
  if (carried === null) return [];
  try {
    const parsed: unknown = carried.length <= 65536 ? JSON.parse(carried) : null;
    if (safeActions(parsed)) return parsed;
  } catch {
    // not JSON: named below
  }
  note("actions", carried.slice(0, 256));
  return [];
};

const instantFrom = (q: URLSearchParams, note: Note): number | null => {
  const instant = q.get("t");
  if (instant === null) return null;
  if (/^\d{1,15}$/.test(instant)) return Number(instant);
  note("t", instant);
  return null;
};

const schemaFrom = (q: URLSearchParams, note: Note): void => {
  const schema = q.get("schema");
  if (schema !== null && schema !== "1") note("schema", schema);
};

/** The plant a query describes, with the default plant for whatever it does not say or says badly. */
export const plantFromQuery = (query: string, known: Known, fallback: PlantSpec = DEFAULT_PLANT): PlantLink => {
  const q = new URLSearchParams(query);
  const notes: LinkNote[] = [];
  const note: Note = (field, given) => void notes.push({ field, given });

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

  const architectures = hallsFrom(q, known, fallback.run.architectures, note);
  const seed = seedFrom(q, fallback.seed, note);
  const actions = actionsFrom(q, note);
  const t = instantFrom(q, note);
  schemaFrom(q, note);

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

/** The keys of the run form: a case beside any of them is a pair the Worker would refuse (`invalid_spec`). */
const hasRunKey = (q: URLSearchParams): boolean => [...q.keys()].some((k) => k === "scenario" || k === "bays" || k === "analyzers" || k === "capture" || k.startsWith("set."));

/**
 * The plant a query describes, of either kind. A `case` the build offers (and no key of the run form beside it) is a break-out case, with the halls and the seed of the Break-out form for what the link
 * does not say or says badly. A `case` the build does not offer, which is every case in the public build, is the default plant with nothing else of the link read, and the note names the case.
 */
export const askFromQuery = (query: string, known: Known, fallback: PlantSpec = DEFAULT_PLANT): AskLink => {
  const q = new URLSearchParams(query);
  const given = q.get("case");
  if (given === null) return plantFromQuery(query, known, fallback);
  const offered = known.breakout ?? null;
  if (offered === null || !offered.cases.includes(given) || hasRunKey(q)) {
    return { spec: fallback, t: null, sample: null, from: q.get("from") === "plant", engine: q.get("engine"), notes: [{ field: "case", given }] };
  }
  const notes: LinkNote[] = [];
  const note: Note = (field, field_given) => void notes.push({ field, given: field_given });
  const architectures = hallsFrom(q, known, offered.architectures, note);
  const seed = seedFrom(q, offered.seed, note);
  const actions = actionsFrom(q, note);
  const t = instantFrom(q, note);
  schemaFrom(q, note);
  const spec: PlantCaseSpec = { case: given, architectures, seed, actions };
  return { spec, t, sample: q.get("sample"), from: q.get("from") === "plant", engine: q.get("engine"), notes };
};

/** The instant of a link against the run it opens: kept when it lies from the start of the run to its horizon, else none and the value as given. */
export const instantIn = (t: number | null, horizon: number): { t: number | null; fault: string | null } =>
  t === null ? { t: null, fault: null } : t >= 0 && t <= horizon ? { t, fault: null } : { t: null, fault: String(t) };

/** The key by which two specs are the same plant: the actions as a set (the Worker names them in one order whatever the order of entry) and the rest as it is. */
const keyOf = (spec: PlantAsk): string => {
  const actions = spec.actions.map((a) => JSON.stringify(a)).sort();
  if (isCase(spec)) return JSON.stringify(["case", spec.case, spec.architectures, spec.seed, actions]);
  const { run } = spec;
  const settings = Object.fromEntries(Object.keys(run.settings).sort().map((k) => [k, run.settings[k]]));
  return JSON.stringify([run.scenario, settings, run.bay_profiles ?? null, run.analyzer_profiles ?? null, run.capture_path ?? null, run.architectures, spec.seed, actions]);
};

/** Whether a run has to be asked for again: it has not when the plant on screen was asked for under this very spec. */
export const sameSpec = (a: PlantAsk | null, b: PlantAsk | null): boolean => a !== null && b !== null && keyOf(a) === keyOf(b);

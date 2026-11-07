import { rangeOf } from "../ledger.ts";
import { safeActions } from "../plant/link.ts";
import { resultsKept } from "../plant/action_list.ts";
import type { CapturePath, PlantAction, Request, RunSpec } from "../protocol.ts";
import type { ReadyInfo } from "./state.ts";

// The Setup form (docs/design/lab_ui.md sections 3 and 4). What the reader typed or picked is kept as text where it is a number, so that a half-typed value is not lost; the form becomes a
// RunSpec only when every field is valid, and travels in the link as a query. Pure functions, no DOM.

export interface Form {
  scenario: string;
  /** Bioreactors (N), the bay size and the analyzers (M), as typed. */
  n: string;
  baySize: string;
  m: string;
  /** One bioreactor profile id per bay and one analyzer profile id per analyzer, by position. */
  bays: string[];
  analyzers: string[];
  /** The presets (A, B, C) that are selected, and the one ablation of C, if any. */
  archs: string[];
  ablation: string;
  /** "" keeps the capture path of each preset. */
  capture: "" | CapturePath;
  /** Whole numbers separated by commas or spaces, as typed. */
  seeds: string;
  /** The plant's unit and analyzer actions that a Setup opened from the plant carries (docs/design/lab_ui.md section 22), applied to every seed; empty when the screen was not opened from the plant. */
  actions: PlantAction[];
}

/** The settings of the scenario that the three counts of the form are (the names its files use). */
export const COUNT_SETTINGS = { n: "reactor_count", baySize: "bay_size", m: "analyzer_count" } as const;
type Count = keyof typeof COUNT_SETTINGS;

const CAPTURE: readonly CapturePath[] = ["manual_transcription", "adapter_ingest"];

/** The bays of a plant: the reactors in bays of `baySize`, the last bay may be smaller (A001). */
export const bayCount = (reactors: number, baySize: number): number => Math.ceil(reactors / baySize);

/** A list of the given length: the picks kept by position, a new position taking the fallback. */
export const resizeList = (picks: readonly string[], length: number, fallback: string): string[] => Array.from({ length }, (_, i) => picks[i] ?? fallback);

/**
 * The analyzer list after M changes: the picks kept by position, a new position taking the profile of the analyzer before it, and the scenario default only when no analyzer is before it. A profile
 * listed on two analyzers is one pool (spec section 4.5), so a copy never clashes with its original; the default would, whenever the reader had picked another profile for analyzer 1.
 */
export const growAnalyzers = (picks: readonly string[], length: number, fallback: string): string[] => {
  const grown: string[] = [];
  for (let i = 0; i < length; i++) grown.push(picks[i] ?? grown[i - 1] ?? fallback);
  return grown;
};

/** A whole number of one or more, as typed; null for anything else. */
export const whole = (text: string): number | null => (/^\d+$/.test(text.trim()) && Number.isSafeInteger(Number(text)) && Number(text) >= 1 && Number(text) <= 100 ? Number(text) : null);

const scenarioOf = (ready: ReadyInfo, id: string) => ready.scenarios.find((s) => s.id === id) ?? ready.scenarios[0];
const settingOf = (ready: ReadyInfo, scenario: string, name: string): number => Number(scenarioOf(ready, scenario)?.settings.find((s) => s.name === name)?.value ?? 0);
const profileDefaults = (ready: ReadyInfo, scenario: string) => ({ bay: scenarioOf(ready, scenario)?.profiles.bioreactor ?? "", analyzer: scenarioOf(ready, scenario)?.profiles.analyzer ?? "" });

/** The seeds of a text: whole numbers separated by commas or white space; null when the text holds none or holds something else. */
export const parseSeeds = (text: string): number[] | null => {
  const tokens = text.split(/[\s,]+/).filter((t) => t !== "");
  const seeds = tokens.map((t) => (/^\d+$/.test(t) ? Number(t) : Number.NaN));
  return seeds.length > 0 && seeds.every(Number.isSafeInteger) ? seeds : null;
};

/** The form of a scenario at its defaults: its sizes and profiles, A, B and C, the first seeds of the list (A103). Choices that do not depend on the scenario are taken from `previous`. */
export const defaultForm = (ready: ReadyInfo, scenarioId: string, previous?: Form): Form => {
  const scenario = scenarioOf(ready, scenarioId);
  const id = scenario?.id ?? scenarioId;
  const [n, baySize, m] = (["n", "baySize", "m"] as const).map((c) => settingOf(ready, id, COUNT_SETTINGS[c]));
  const d = profileDefaults(ready, id);
  return {
    scenario: id,
    n: String(n),
    baySize: String(baySize),
    m: String(m),
    bays: resizeList([], bayCount(n ?? 0, baySize ?? 1), d.bay),
    analyzers: resizeList([], m ?? 0, d.analyzer),
    archs: previous?.archs ?? ready.presets.filter((p) => p.role === "preset").map((p) => p.id),
    ablation: previous?.ablation ?? "",
    capture: previous?.capture ?? "",
    seeds: previous?.seeds ?? ready.seed_list.slice(0, ready.min_seeds).join(", "),
    actions: previous?.actions ?? [],
  };
};

/** A count changed: both lists are rebuilt, the picks kept by position. A new bay takes the scenario default; a new analyzer takes the profile of the analyzer before it (`growAnalyzers`). A count that is not a whole number of one or more is kept as typed and the lists are left alone. */
export const withCounts = (form: Form, ready: ReadyInfo, patch: Partial<Pick<Form, Count>>): Form => {
  const next = { ...form, ...patch };
  const [n, baySize, m] = [whole(next.n), whole(next.baySize), whole(next.m)];
  const d = profileDefaults(ready, next.scenario);
  return {
    ...next,
    bays: n !== null && baySize !== null ? resizeList(form.bays, bayCount(n, baySize), d.bay) : next.bays,
    analyzers: m !== null ? growAnalyzers(form.analyzers, m, d.analyzer) : next.analyzers,
  };
};

export type SpecOut = { ok: true; spec: RunSpec } | { ok: false; problems: ("n" | "baySize" | "m" | "architectures" | "seeds")[] };

/** The form as a RunSpec: only the settings that differ from the scenario, the lists only when a position differs from the default, the architectures in the order of `ready`. */
export const specOf = (form: Form, ready: ReadyInfo): SpecOut => {
  const problems: Exclude<SpecOut, { ok: true }>["problems"] = [];
  const counts = { n: whole(form.n), baySize: whole(form.baySize), m: whole(form.m) };
  for (const c of ["n", "baySize", "m"] as const) if (counts[c] === null) problems.push(c);
  const architectures = ready.presets.filter((p) => (p.role === "preset" && form.archs.includes(p.id)) || p.id === form.ablation).map((p) => p.id);
  if (architectures.length === 0) problems.push("architectures");
  const seeds = parseSeeds(form.seeds);
  if (seeds === null) problems.push("seeds");
  if (problems.length > 0 || seeds === null) return { ok: false, problems };

  const settings: Record<string, number> = {};
  for (const c of ["n", "baySize", "m"] as const) {
    const value = counts[c] as number;
    if (value !== settingOf(ready, form.scenario, COUNT_SETTINGS[c])) settings[COUNT_SETTINGS[c]] = value;
  }
  const d = profileDefaults(ready, form.scenario);
  return {
    ok: true,
    spec: {
      schema_version: "1",
      scenario: form.scenario,
      settings,
      ...(form.bays.some((b) => b !== d.bay) && { bay_profiles: [...form.bays] }),
      ...(form.analyzers.some((a) => a !== d.analyzer) && { analyzer_profiles: [...form.analyzers] }),
      ...(form.capture !== "" && { capture_path: form.capture }),
      architectures,
      seeds,
    },
  };
};

/** The `run` request of a form: its spec and, when the plant's actions are carried, the actions beside it; with none the request has no `actions` (Setup opened without the plant is as before). */
export const runRequest = (form: Form, ready: ReadyInfo, id: number): Extract<Request, { type: "run" }> | null => {
  const out = specOf(form, ready);
  return out.ok ? { type: "run", id, spec: out.spec, ...(form.actions.length > 0 && { actions: form.actions }) } : null;
};

// ---- the check of the analyzer list (U2; lab_ui.md section 4, rule 6) ----

/** What the check depends on: the scenario (its menu) and the analyzer picks. N, the bay size and the bays do not change the verdict, so a change of those asks nothing. */
export const fleetKey = (form: Pick<Form, "scenario" | "analyzers">): string => JSON.stringify([form.scenario, form.analyzers]);

/** The `fleet_check` request of a form: the engine's own check of the two lists, asked of the Worker, which runs nothing. */
export const fleetRequest = (form: Pick<Form, "scenario" | "analyzers">, id: number): Extract<Request, { type: "fleet_check" }> => ({ type: "fleet_check", id, scenario: form.scenario, analyzers: [...form.analyzers] });

// ---- the link: `#/setup?<query>` holds the setup and never a result (lab_ui.md section 4, rule 5) ----

const encode = (value: string): string => encodeURIComponent(value).replaceAll("%2C", ",");
const commas = (text: string): string => text.split(/[\s,]+/).filter((t) => t !== "").join(",");

/** The query of a form: the scenario, the counts that differ from it, the lists that differ, the architectures, the capture path, the plant's actions, the seeds, the schema and the engine version. */
export const toQuery = (form: Form, ready: ReadyInfo): string => {
  const d = profileDefaults(ready, form.scenario);
  const pairs: [string, string][] = [["scenario", form.scenario]];
  for (const c of ["n", "baySize", "m"] as const) {
    if (form[c].trim() !== String(settingOf(ready, form.scenario, COUNT_SETTINGS[c]))) pairs.push([`set.${COUNT_SETTINGS[c]}`, form[c].trim()]);
  }
  if (form.bays.some((b) => b !== d.bay)) pairs.push(["bays", form.bays.join(",")]);
  if (form.analyzers.some((a) => a !== d.analyzer)) pairs.push(["analyzers", form.analyzers.join(",")]);
  pairs.push(["arch", [...ready.presets.filter((p) => p.role === "preset" && form.archs.includes(p.id)).map((p) => p.id), ...(form.ablation ? [form.ablation] : [])].join(",")]);
  if (form.capture !== "") pairs.push(["capture", form.capture]);
  if (form.actions.length > 0) pairs.push(["actions", JSON.stringify(form.actions)]);
  pairs.push(["seeds", commas(form.seeds)], ["schema", "1"], ["engine", ready.engine_version]);
  return pairs.map(([k, v]) => `${k}=${encode(v)}`).join("&");
};

/** The actions a link carries: the JSON of a list, of which the page keeps the kinds Results carries (its own copy of the filter) and the Worker checks the rest; anything else is none. */
const actionsOf = (carried: string | null): PlantAction[] => {
  try {
    const parsed: unknown = carried === null ? [] : carried.length <= 65536 ? JSON.parse(carried) : null;
    const objects = safeActions(parsed) ? parsed.filter((x) => typeof x.kind === "string") : [];
    return resultsKept(objects);
  } catch {
    return [];
  }
};

/** The form a link describes, and the engine version it was made with. A key, scenario, architecture or capture path the page does not know is ignored: a link is user input. */
export const fromQuery = (query: string, ready: ReadyInfo): { form: Form; engine: string | null } => {
  const q = new URLSearchParams(query);
  const scenario = ready.scenarios.find((s) => s.id === q.get("scenario"))?.id ?? ready.scenarios[0]?.id ?? "";
  let form = defaultForm(ready, scenario);
  const typed: Partial<Pick<Form, Count>> = {};
  for (const c of ["n", "baySize", "m"] as const) {
    const value = q.get(`set.${COUNT_SETTINGS[c]}`);
    if (value !== null) typed[c] = value;
  }
  form = withCounts(form, ready, typed);
  const list = (key: string, kind: "bioreactor" | "analyzer", current: string[], fallback: string): string[] => {
    const ids = ready.profiles.filter((p) => p.kind === kind).map((p) => p.id);
    return resizeList((q.get(key) ?? "").split(",").map((id) => (ids.includes(id) ? id : "")), current.length, fallback).map((id, i) => (id === "" ? (current[i] ?? fallback) : id));
  };
  const d = profileDefaults(ready, scenario);
  if (q.has("bays")) form = { ...form, bays: list("bays", "bioreactor", form.bays, d.bay) };
  if (q.has("analyzers")) form = { ...form, analyzers: list("analyzers", "analyzer", form.analyzers, d.analyzer) };
  if (q.has("arch")) {
    const named = (q.get("arch") ?? "").split(",");
    form = { ...form, archs: ready.presets.filter((p) => p.role === "preset" && named.includes(p.id)).map((p) => p.id), ablation: ready.presets.find((p) => p.role === "ablation" && named.includes(p.id))?.id ?? "" };
  }
  const capture = CAPTURE.find((c) => c === q.get("capture"));
  if (capture) form = { ...form, capture };
  const seeds = q.get("seeds");
  if (seeds !== null) form = { ...form, seeds: seeds.split(/[\s,]+/).filter((t) => t !== "").join(", ") };
  form = { ...form, actions: actionsOf(q.get("actions")) };
  return { form, engine: q.get("engine") };
};

/** The ledger range of an id when a typed value lies outside it; null inside the range, or when the ledger gives no numeric range. */
export const rangeWarning = (id: string, value: number): [number, number] | null => {
  const range = rangeOf(id);
  return range && (value < range[0] || value > range[1]) ? range : null;
};

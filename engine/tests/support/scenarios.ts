import { runScenario } from "../../src/run.ts";
import type { ScenarioRun } from "../../src/run.ts";
import type { ProfileKind } from "../../src/profiles.ts";
import { loadScenario } from "../../src/scenario.ts";
import type { ScenarioConfig } from "../../src/scenario.ts";
import { readJson } from "./paths.ts";
import type { Json } from "./schemas.ts";

// Test-side access to scenarios/ and scenarios/profiles/ (engine/src reads no files).

export const rawScenario = (name: string): Json => readJson<Json>("scenarios", `${name}.json`);
export const lookup = (kind: ProfileKind, id: string): unknown => readJson("scenarios", "profiles", kind, `${id}.json`);

export interface Patch {
  seed?: number;
  queue_policy?: string;
  sampling_plan?: string;
  label_method?: string;
  feedback?: boolean;
  profiles?: Partial<Record<ProfileKind, string>>;
  /** Replaces only the `value` of a setting; unit and ref stay. */
  settings?: Record<string, number>;
  /** Top-level fields replaced as they are (maintenance, lot_changes, scripted_events, stability, ...). */
  fields?: Json;
}

export const patched = (raw: Json, p: Patch = {}): Json => {
  const doc = structuredClone(raw);
  if (p.seed !== undefined) doc.seed = p.seed;
  if (p.queue_policy !== undefined) doc.queue_policy = p.queue_policy;
  if (p.sampling_plan !== undefined) doc.sampling_plan = p.sampling_plan;
  if (p.label_method !== undefined) doc.label_method = p.label_method;
  if (p.feedback !== undefined) doc.feedback = p.feedback;
  if (p.profiles) doc.profiles = { ...(doc.profiles as Json), ...p.profiles };
  for (const [name, value] of Object.entries(p.settings ?? {})) {
    const setting = (doc.settings as Record<string, Json>)[name];
    if (!setting) throw new Error(`no setting ${name}`);
    setting.value = value;
  }
  Object.assign(doc, p.fields ?? {});
  return doc;
};

export const configOf = (name: string, p?: Patch): ScenarioConfig => loadScenario(patched(rawScenario(name), p), lookup);

export const runOf = (name: string, p?: Patch, opts: Parameters<typeof runScenario>[1] = {}): ScenarioRun => runScenario(configOf(name, p), opts);

/** A small, quick variant of the default scenario for tests that do not need 24 reactors or 21 days. */
export const SMALL: Record<string, number> = { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 8, production_days: 6 };

/** Death off: both ends of the coupled death rate (A212, A081) at zero. */
export const NO_DEATH: Record<string, number> = { early_death_per_h: 0, late_death_per_h: 0 };

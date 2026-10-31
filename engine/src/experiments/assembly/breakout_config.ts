import type { Param } from "../../generated/profile.schema";
import { checkParams } from "../../profiles.ts";
import { checkSeeds } from "./config.ts";

// The config of the break-out experiment SC12 (scenarios/experiments/sc12.json): which cases, which architectures, which seeds. A case is one scenario file, optionally with a swept input of its
// break-out block and an assumed lag for the walk-back. The engine reads no file: the caller passes the parsed JSON, and the seed list is written before any run (the rules of every seed list,
// `checkSeeds`: neutral integers, no repeat, none date-shaped, at least the A103 minimum).

export interface BreakoutCaseConfig {
  case_id: string;
  /** The scenario file name without extension. */
  scenario: string;
  /**
   * A swept input: the path inside the `breakout` block of the scenario (`inputs.<name>` or `response.<name>`) and the value that replaces it, `{value, unit, ref}`. The path has to exist in the
   * scenario already, so a misspelt input is refused and never added.
   */
  set: Record<string, Param>;
  /** The assumed lag of the walk-back (a decision setting, not truth; spec 11.4). Absent: the lag the scenario sets for the event. */
  assumed_lag?: Param;
}

export interface BreakoutExperimentConfig {
  experiment_id: string;
  presets: string[];
  /** The preset that is ablated flag by flag (spec section 5: C with exactly one flag off, ten runs). */
  ablations_of: string;
  seeds: number[];
  cases: BreakoutCaseConfig[];
}

const KEYS = ["schema_version", "experiment_id", "description", "presets", "ablations_of", "seeds", "cases"];
const CASE_KEYS = ["case_id", "scenario", "description", "set", "assumed_lag"];
const SETTABLE = /^(inputs|response)\.[A-Za-z0-9_]+$/;

const fail = (why: string): never => {
  throw new Error(`break-out experiment config: ${why}`);
};

const text = (v: unknown, what: string): string => (typeof v === "string" && v !== "" ? v : fail(`${what} must be a non-empty string`));

const object = (v: unknown, what: string): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be an object`));

const caseOf = (raw: unknown): BreakoutCaseConfig => {
  const doc = object(raw, "a case");
  for (const k of Object.keys(doc)) if (!CASE_KEYS.includes(k)) fail(`unknown key ${k} in a case`);
  const case_id = text(doc.case_id, "case_id");
  const set = object(doc.set ?? {}, `${case_id}: set`);
  for (const path of Object.keys(set)) if (!SETTABLE.test(path)) fail(`${case_id}: set names ${path}, which is not inputs.<name> or response.<name> of the break-out block`);
  checkParams(set, `${case_id}: set`);
  if (doc.assumed_lag !== undefined) checkParams({ assumed_lag: doc.assumed_lag }, `${case_id}: assumed_lag`);
  return { case_id, scenario: text(doc.scenario, `${case_id}: scenario`), set: set as Record<string, Param>, ...(doc.assumed_lag !== undefined && { assumed_lag: doc.assumed_lag as Param }) };
};

export const parseBreakoutConfig = (raw: unknown, minSeeds: number): BreakoutExperimentConfig => {
  const doc = object(raw, "the document");
  for (const k of Object.keys(doc)) if (!KEYS.includes(k)) fail(`unknown key ${k}`);
  if (doc.schema_version !== "1") fail('schema_version must be "1"');
  const presets = doc.presets;
  if (!Array.isArray(presets) || presets.length === 0) return fail("presets must be a non-empty list");
  const cases = doc.cases;
  if (!Array.isArray(cases) || cases.length === 0) return fail("cases must be a non-empty list");
  const parsed = cases.map(caseOf);
  const dup = parsed.find((c, i) => parsed.findIndex((o) => o.case_id === c.case_id) !== i);
  if (dup) fail(`case ${dup.case_id} is listed twice`);
  return {
    experiment_id: text(doc.experiment_id, "experiment_id"),
    presets: presets.map((p) => text(p, "a preset")),
    ablations_of: text(doc.ablations_of, "ablations_of"),
    seeds: checkSeeds(doc.seeds, minSeeds),
    cases: parsed,
  };
};

/**
 * The scenario document of a case: a copy of the parsed scenario with the swept inputs put into its break-out block. A scenario without a block, or without the input a case sets, is refused.
 * The copy is plain data for `loadScenario`, which validates the result as it validates any scenario (a unit, a ref, a flag of 0 or 1).
 */
export const patchScenario = (raw: unknown, set: Readonly<Record<string, Param>>, case_id: string): unknown => {
  const doc = structuredClone(raw) as { breakout?: Record<string, Record<string, unknown> | undefined> };
  for (const [path, value] of Object.entries(set)) {
    const [group, name] = path.split(".") as [string, string];
    const target = doc.breakout?.[group];
    if (target === undefined || !(name in target)) fail(`${case_id}: the scenario has no breakout.${path} to set`);
    (target as Record<string, unknown>)[name] = structuredClone(value);
  }
  return doc;
};

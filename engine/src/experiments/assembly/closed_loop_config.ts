import { checkSeeds } from "./config.ts";

// The config of experiment 2 (data/scenarios/experiments/experiment2.json): which scenario, which architectures, the sensitivity variants, the seed list, the bootstrap settings
// and the assumption ids the result text names. The engine reads no file: the caller passes the parsed JSON. The seed list is written before any run (docs/prompts/20 Step 4).

export interface Variant {
  id: string;
  /** The preset whose record the variant reads. */
  of: string;
  /** The modelled variant of the C rule (a sensitivity, reported only): subtract the open-sample offset instead of excluding the value. */
  bias_handling: "model";
}

export interface ClosedLoopConfig {
  experiment_id: string;
  /** The scenario file name without extension; its `feedback` must be true. */
  scenario: string;
  presets: string[];
  variants: Variant[];
  seeds: number[];
  /** The keyed stream of the bootstrap: a neutral integer in the run_seed slot, and the number of resamples. */
  bootstrap: { seed: number; resamples: number };
  /** The assumption ids the result text names; the five of the spec (A041, A051, A094, A095, A108) are always among them. */
  assumptions: string[];
}

const KEYS = ["schema_version", "experiment_id", "description", "scenario", "presets", "variants", "seeds", "bootstrap", "assumptions"];
/** The five assumptions the result template of spec 6.2 names before "and the others used". */
export const NAMED_ASSUMPTIONS = ["A041", "A051", "A094", "A095", "A108"] as const;
const ID = /^A\d{3}$/;

const fail = (why: string): never => {
  throw new Error(`experiment 2 config: ${why}`);
};
const text = (v: unknown, what: string): string => (typeof v === "string" && v !== "" ? v : fail(`${what} must be a non-empty string`));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const parseClosedLoopConfig = (raw: unknown, minSeeds: number): ClosedLoopConfig => {
  if (!isRecord(raw)) return fail("the document must be an object");
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) fail(`unknown key ${k}`);
  if (raw.schema_version !== "1") fail('schema_version must be "1"');
  if (!Array.isArray(raw.presets) || raw.presets.length === 0) fail("presets must be a non-empty list");
  const presets = (raw.presets as unknown[]).map((p) => text(p, "a preset"));
  const variants = (Array.isArray(raw.variants) ? (raw.variants as unknown[]) : fail("variants must be a list")).map((v): Variant => {
    if (!isRecord(v)) return fail("a variant must be an object");
    const of = text(v.of, "variant.of");
    if (!presets.includes(of)) fail(`variant ${String(v.id)} reads the record of ${of}, which is not a listed preset`);
    if (v.bias_handling !== "model") fail("variant.bias_handling must be model (the default rule is the preset's own)");
    return { id: text(v.id, "variant.id"), of, bias_handling: "model" };
  });
  const b = raw.bootstrap;
  if (!isRecord(b) || !Number.isInteger(b.seed) || (b.seed as number) < 0) return fail("bootstrap needs a non-negative integer seed");
  if (!Number.isInteger(b.resamples) || (b.resamples as number) < 1) fail("bootstrap.resamples must be an integer, at least 1");
  const assumptions = (Array.isArray(raw.assumptions) ? (raw.assumptions as unknown[]) : fail("assumptions must be a list")).map((a) => (typeof a === "string" && ID.test(a) ? a : fail(`assumption ${String(a)} is not an A### id`)));
  for (const id of NAMED_ASSUMPTIONS) if (!assumptions.includes(id)) fail(`the result text names ${id}; it must be in assumptions`);
  return {
    experiment_id: text(raw.experiment_id, "experiment_id"),
    scenario: text(raw.scenario, "scenario"),
    presets,
    variants,
    seeds: checkSeeds(raw.seeds, minSeeds),
    bootstrap: { seed: b.seed as number, resamples: b.resamples as number },
    assumptions,
  };
};

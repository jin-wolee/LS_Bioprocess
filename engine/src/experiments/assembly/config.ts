// The config of an experiment run (scenarios/experiments/*.json): which scenario, which architectures, which seeds. The engine reads no file: the
// caller passes the parsed JSON. The seed list is written before any run (prompts/20 Step 4); the minimum comes from the evaluation settings (A103).

export interface ExperimentConfig {
  experiment_id: string;
  /** The scenario file name without extension. */
  scenario: string;
  /** Architecture presets by file name without extension, in report order. */
  presets: string[];
  /** The preset that is ablated flag by flag (spec section 5: C with exactly one flag off, eight runs). */
  ablations_of: string;
  seeds: number[];
}

const KEYS = ["schema_version", "experiment_id", "description", "scenario", "presets", "ablations_of", "seeds"];
/** A seed that reads like a date, YYYYMMDD with year 19xx or 20xx (00 section 2 item 2). */
const DATE_SHAPED = /^(19|20)\d{6}$/;

const fail = (why: string): never => {
  throw new Error(`experiment config: ${why}`);
};

const text = (v: unknown, what: string): string => (typeof v === "string" && v !== "" ? v : fail(`${what} must be a non-empty string`));

export const parseExperimentConfig = (raw: unknown, minSeeds: number): ExperimentConfig => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("the document must be an object");
  const doc = raw as Record<string, unknown>;
  for (const k of Object.keys(doc)) if (!KEYS.includes(k)) fail(`unknown key ${k}`);
  if (doc.schema_version !== "1") fail('schema_version must be "1"');
  const presets = doc.presets;
  if (!Array.isArray(presets) || presets.length === 0) return fail("presets must be a non-empty list");
  const seeds = doc.seeds;
  if (!Array.isArray(seeds)) return fail("seeds must be a list");
  for (const s of seeds) {
    if (!Number.isInteger(s) || (s as number) < 0) fail(`seed ${String(s)} must be a non-negative integer`);
    if (DATE_SHAPED.test(String(s))) fail(`seed ${String(s)} is date-shaped (seeds are neutral values)`);
  }
  if (new Set(seeds).size !== seeds.length) fail("a seed is repeated");
  if (seeds.length < minSeeds) fail(`at least ${minSeeds} seeds are needed (A103), the list has ${seeds.length}`);
  return {
    experiment_id: text(doc.experiment_id, "experiment_id"),
    scenario: text(doc.scenario, "scenario"),
    presets: presets.map((p) => text(p, "a preset")),
    ablations_of: text(doc.ablations_of, "ablations_of"),
    seeds: [...(seeds as number[])],
  };
};

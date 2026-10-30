import { evaluationSettings } from "../../../evaluate/config.ts";
import { loadProfile } from "../../../profiles.ts";
import { parseArchitecture } from "../../../record/architecture.ts";
import { runScenario } from "../../../run.ts";
import { loadScenario } from "../../../scenario.ts";
import { ENGINE_VERSION, canonicalJson, logHash, sha256Hex } from "../../../trace.ts";
import { runOpenLoop } from "../open_loop.ts";
import { scenarioConfig, scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";

// The browser check of ADR-0016 under ADR-0019 (docs/design/lab_ui.md section 7): one strict comparison, no tolerance. The page runs the default scenario in the Worker and compares
//   truth    the log hash of seeds 1, 2 and 3 with the reference,
//   repeats  five runs of seed 1 in a row, which must agree with each other (no reference needed),
//   cells    the digest of the metric cells of seed 1 under A, B and C with the reference.
// The reference is built in Node by engine/tests/support/lab_reference_cli.ts, which refuses it unless the truth hashes equal the goldens. Time never enters a result: `now` is
// injected, and the timings are the only thing it feeds (the I12 marks: START before runScenario, STOP after it returns).

export const CHECK_SEEDS = [1, 2, 3] as const;
/** The runs of seed 1 in a row. */
export const REPEATS = 5;
const CELL_SEED = 1;
const CHECKED_SCENARIO = "default";

export interface Reference {
  schema_version: "1";
  engine_version: string;
  node: { version: string; flags: string[] };
  truth: { seed: number; log_hash: string }[];
  cells: { seed: number; architectures: string[]; digest: string };
}

export type CheckState = "identical" | "failed" | "error";

export interface CheckDetail {
  /** The timed runs of seed 1. */
  runs_ms: number[];
  truth: { seed: number; equal: boolean }[];
  repeats_equal: boolean;
  cells_equal: boolean;
  /** Only in the state `error`. */
  reason?: string;
}

export interface CheckDeps {
  engine_version: string;
  /** The log hash of the default scenario for one seed, and the time its scenario run took. */
  truth(seed: number): Promise<{ log_hash: string; ms: number }>;
  /** The digest of the metric cells of seed 1 under A, B and C. */
  cells(): Promise<{ architectures: string[]; digest: string }>;
}

export const makeDeps = (data: LabData, now: () => number): CheckDeps => ({
  engine_version: ENGINE_VERSION,
  truth: async (seed) => {
    const cfg = scenarioConfig(data, CHECKED_SCENARIO, {}, seed);
    const start = now();
    const run = runScenario(cfg);
    const ms = now() - start;
    return { log_hash: await logHash(run.events), ms };
  },
  cells: async () => {
    const doc = scenarioDoc(data, CHECKED_SCENARIO);
    const architectures = data.architectures.map(parseArchitecture);
    const result = await runOpenLoop({
      scenario: loadScenario(data.scenarios[CHECKED_SCENARIO], data.lookup),
      seeds: [CELL_SEED],
      staff: loadProfile(data.lookup("staff", doc.profiles.staff as string), "staff").params,
      evaluation: evaluationSettings(data.evaluation),
      architectures,
    });
    return { architectures: architectures.map((a) => a.id), digest: await sha256Hex(canonicalJson(result.outcomes[0]?.cells)) };
  },
});

export const computeReference = async (deps: CheckDeps, node: { version: string; flags: readonly string[] }): Promise<Reference> => {
  const truth: Reference["truth"] = [];
  for (const seed of CHECK_SEEDS) truth.push({ seed, log_hash: (await deps.truth(seed)).log_hash });
  const cells = await deps.cells();
  return {
    schema_version: "1",
    engine_version: deps.engine_version,
    node: { version: node.version, flags: [...node.flags] },
    truth,
    cells: { seed: CELL_SEED, ...cells },
  };
};

const HEX64 = /^[0-9a-f]{64}$/;

/** The reference as fetched is data from a file: a shape that does not fit is a reason, not a crash. */
const readReference = (raw: unknown): Reference | string => {
  if (typeof raw !== "object" || raw === null) return "the reference is missing or not an object";
  const ref = raw as Partial<Reference>;
  if (ref.schema_version !== "1") return 'the reference has no schema_version "1"';
  for (const seed of CHECK_SEEDS) {
    const row = Array.isArray(ref.truth) ? ref.truth.find((t) => t?.seed === seed) : undefined;
    if (!row || typeof row.log_hash !== "string" || !HEX64.test(row.log_hash)) return `the reference has no usable log hash for seed ${seed}`;
  }
  const cells = ref.cells;
  if (!cells || !Array.isArray(cells.architectures) || typeof cells.digest !== "string" || !HEX64.test(cells.digest)) return "the reference has no usable cell digest";
  return ref as Reference;
};

/** The outcome when the check could not run: the reason is the whole detail. */
export const checkError = (reason: string): { state: "error"; detail: CheckDetail } => ({
  state: "error",
  detail: { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false, reason },
});

export const runCheck = async (rawReference: unknown, deps: CheckDeps): Promise<{ state: CheckState; detail: CheckDetail }> => {
  const ref = readReference(rawReference);
  if (typeof ref === "string") return checkError(ref);
  if (typeof crypto === "undefined" || !crypto.subtle) return checkError("this browser has no crypto.subtle (it needs a secure context)");
  try {
    const runs_ms: number[] = [];
    const repeats: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const run = await deps.truth(1);
      runs_ms.push(run.ms);
      repeats.push(run.log_hash);
    }
    const hashes = new Map<number, string>([[1, repeats[0] as string]]);
    for (const seed of CHECK_SEEDS) if (seed !== 1) hashes.set(seed, (await deps.truth(seed)).log_hash);
    const truth = CHECK_SEEDS.map((seed) => ({ seed, equal: hashes.get(seed) === ref.truth.find((t) => t.seed === seed)?.log_hash }));
    const repeats_equal = repeats.every((h) => h === repeats[0]);
    const cells = await deps.cells();
    const cells_equal = cells.digest === ref.cells.digest && cells.architectures.join(",") === ref.cells.architectures.join(",");
    const state = repeats_equal && cells_equal && truth.every((t) => t.equal) ? "identical" : "failed";
    return { state, detail: { runs_ms, truth, repeats_equal, cells_equal } };
  } catch (e) {
    return checkError(e instanceof Error ? e.message : String(e));
  }
};

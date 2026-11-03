import { evaluationSettings } from "../../src/evaluate/config.ts";
import { seedInputFromRun } from "../../src/experiments/assembly/from_run.ts";
import type { SeedInput } from "../../src/experiments/assembly/run_seed.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { loadProfile } from "../../src/profiles.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { readJson } from "./paths.ts";
import { REVIEW } from "./review_setup.ts";
import { lookup } from "./scenarios.ts";

// One scenario run through chosen architectures with the assembly of S2b (production settings: no forced errors). Test-side only.

const staff = loadProfile(lookup("staff", "experienced"), "staff").params;
const evaluation = evaluationSettings(readJson("data", "scenarios", "evaluation", "default.json"));

export const inputOf = (run: ScenarioRun, scenario_id: string, architectures: readonly Architecture[], days: number): SeedInput =>
  seedInputFromRun(run, { scenario_id, staff, evaluation, architectures, days, review: REVIEW });

export const assemble = (run: ScenarioRun, scenario_id: string, architectures: readonly Architecture[], days: number): ReturnType<typeof runSeed> =>
  runSeed(inputOf(run, scenario_id, architectures, days));

/** The truth events of one type, typed (the truth log is what the assembly and the evaluator may read; a recorder never does). */
export const eventsOf = <T extends ScenarioRun["events"][number]["type"]>(run: ScenarioRun, type: T): Extract<ScenarioRun["events"][number], { type: T }>[] =>
  run.events.filter((e): e is Extract<ScenarioRun["events"][number], { type: T }> => e.type === type);

export interface KeyedError {
  type: string;
  sample_id: string;
  detail?: { as_id?: string };
}

/** The realised errors of one architecture, read from the key file text (plain JSON; the evaluator module stays the only reader of the key for scoring). */
export const keyErrors = (keyText: string, architecture: string): KeyedError[] =>
  (JSON.parse(keyText) as { architectures: Record<string, { errors: KeyedError[] }> }).architectures[architecture]?.errors ?? [];

/** Ids that a realised label error touches: the sample and the id its results were recorded under. Their results are mixed up, which is another relation. */
export const mixedUp = (keyText: string, architecture: string): Set<string> =>
  new Set(keyErrors(keyText, architecture).flatMap((e) => (e.type === "label_error" ? [e.sample_id, String(e.detail?.as_id)] : [])));

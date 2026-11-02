import { evaluationSettings } from "../../../evaluate/config.ts";
import type { ExperimentReport } from "../../../generated/experiment_report.schema";
import { loadProfile } from "../../../profiles.ts";
import type { Dialect } from "../../../raw/types.ts";
import { runScenario } from "../../../run.ts";
import { loadScenario } from "../../../scenario.ts";
import { ENGINE_VERSION, logHash } from "../../../trace.ts";
import { rosterOf, seedInputFromRun } from "../from_run.ts";
import type { OpenLoopResult, SeedOutcome } from "../open_loop.ts";
import { entryConfigFor, rawSetupFor } from "../raw_setup.ts";
import { buildReport } from "../report.ts";
import { runSeed } from "../run_seed.ts";
import { checkBounds } from "./action_bounds.ts";
import { actionInputs, applyActions, parseResultsActions } from "./actions.ts";
import type { Action, PlantRefusal } from "./actions.ts";
import { evaluationRefs } from "./catalogue.ts";
import type { RefValue } from "./catalogue.ts";
import { analyzerPlan, rawLayerDoc, scenarioConfig, scenarioDoc, scenarioDocument } from "./setup.ts";
import type { LabData, ScenarioExtras } from "./setup.ts";
import { ablationBaseId, architecturesOf } from "./spec.ts";
import type { RunSpec } from "./spec.ts";
import { utilisationView } from "./utilisation.ts";
import type { UtilisationView } from "./utilisation.ts";

// The `run` request in full (docs/design/lab_ui.md section 4): for each seed the truth is run once and recorded under the chosen architectures, a seed at a time so that the Worker can post
// `progress` and read a `cancel` between seeds; the per-seed outcomes are put together and `buildReport` is called once. This is the loop of runOpenLoop (experiment 1, spec section 6.1)
// with the raw layer added for a run that names a capture path; engine/tests/lab/run_lab.test.ts holds the two to the same report. Only the report, the utilisation view and the printed
// inputs leave this function: the truth log and the answer key stay here (spec section 3, rule 2).
//
// P6b (docs/design/lab_ui.md section 22): the request may carry the plant's actions that name a unit or an analyzer. `checkRunActions` is the Worker's check, before any seed runs; `runLab` then builds
// the scenario of every seed from the document with the list applied by `applyActions`, the one `plant_run` uses. With none, or an empty list, nothing below the check of the list is different.

const DAY = 86400;

export interface RunHooks {
  /** Called after each seed with the count done and the total. */
  onProgress?: (done: number, total: number) => void;
  /** Read before each seed. */
  isCancelled?: () => boolean;
}

export type LabRun =
  | { ok: true; report: ExperimentReport; utilisation: UtilisationView; inputs: RefValue[] }
  | { ok: false; reason: "cancelled"; done: number };

/** The inputs a result prints: the inputs of the metrics, each scenario setting the reader changed, and the zone of the raw layer when a capture path is named. */
export const inputsOf = (data: LabData, spec: RunSpec, actions: readonly Action[] = []): RefValue[] => {
  const known = scenarioDoc(data, spec.scenario).settings;
  const changed = Object.entries(spec.settings).map(([name, value]): RefValue => ({ name, value, unit: known[name]?.unit ?? "", ref: known[name]?.ref ?? "" }));
  const raw = spec.capture_path ? [{ name: "device_zone_h", ...rawLayerDoc(data).device_zone_h }] : [];
  return [...evaluationRefs(data), ...changed, ...raw, ...actionInputs(actions)];
};

/** The parts of a spec that change the scenario beyond its settings. */
const extrasOf = (spec: RunSpec): ScenarioExtras => ({
  ...(spec.bay_profiles && { bay_profiles: spec.bay_profiles }), ...(spec.analyzer_profiles && { analyzer_profiles: spec.analyzer_profiles }), ...(spec.capture_path && { capture_path: spec.capture_path }),
});

/**
 * The actions of a `run` request, checked before any seed runs (lab_ui.md section 22, item 2): the shape, the kinds, a kind Results does not carry, then the bounds against the run. The bounds of the
 * four kinds Results carries are the scenario's (a unit's culture, an analyzer's windows) and none is keyed by the seed, so they are checked once, with the first seed, and a refusal names the place of the
 * action and no seed (item 3). An error of the engine for the scenario itself is thrown with its message, as `runLab` throws it.
 */
export const checkRunActions = (data: LabData, spec: RunSpec, raw: unknown): { ok: true; actions: Action[] } | PlantRefusal => {
  const parsed = parseResultsActions(raw);
  if (!parsed.ok || parsed.actions.length === 0) return parsed;
  if (spec.architectures.length === 0) return { ok: false, code: "invalid_spec", message: "a run with no architecture takes no actions: it is one seed of the plain scenario" };
  const seed = spec.seeds[0] ?? 0;
  return checkBounds(scenarioConfig(data, spec.scenario, spec.settings, seed, extrasOf(spec)), seed, spec.architectures, parsed.actions) ?? parsed;
};

/** Let the event loop run, so that a `cancel` message waiting in the Worker is handled before the next seed. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Run a checked spec. An error of the engine (a scenario that fails its own validation, a list of the wrong length) is thrown with the engine's message, before any seed runs; the
 * Worker reports it as `engine_error`. A cancel read between two seeds ends the run without a report.
 */
export const runLab = async (data: LabData, spec: RunSpec, hooks: RunHooks = {}, actions: readonly Action[] = []): Promise<LabRun> => {
  const evaluation = evaluationSettings(data.evaluation);
  const wanted = architecturesOf(data);
  const architectures = spec.architectures.map((id) => wanted.find((a) => a.id === id) ?? ((): never => { throw new Error(`no architecture ${id}`); })());
  const { staff: staffId } = scenarioDoc(data, spec.scenario).profiles;
  const staff = loadProfile(data.lookup("staff", staffId as string), "staff").params;
  const extras = extrasOf(spec);
  const first = spec.seeds[0] ?? 0;
  const config = actions.length === 0
    ? scenarioConfig(data, spec.scenario, spec.settings, first, extras)
    : { ...loadScenario(applyActions({ scenario: scenarioDocument(data, spec.scenario, spec.settings, extras), capture_path: spec.capture_path, architectures: [] }, actions).scenario, data.lookup), seed: first };
  const roster = rosterOf(config.sampling);
  const plan = analyzerPlan(data, spec.scenario, spec.analyzer_profiles);
  const dialects = data.dialects as Readonly<Record<string, Dialect>>;
  const raw = config.raw ? { raw: rawSetupFor(config.raw, plan, dialects, roster), entry_rules: entryConfigFor(plan, dialects) } : {};

  const review = { timing: "next_shift_start" as const, reject_also: [] as string[] };
  const outcomes: SeedOutcome[] = [];
  for (const seed of spec.seeds) {
    if (hooks.isCancelled?.()) return { ok: false, reason: "cancelled", done: outcomes.length };
    const run = runScenario({ ...config, seed });
    const truth_log_hash = await logHash(run.events);
    const out = runSeed({ ...seedInputFromRun(run, { scenario_id: config.scenario_id, staff, evaluation, architectures, days: config.process.horizon_s / DAY, review: { roster, ...review }, ...raw }), with_hold_limit: true });
    const after = await logHash(run.events);
    if (after !== truth_log_hash) throw new Error(`lab run: the truth log of seed ${seed} changed while the architectures were recorded (${truth_log_hash} before, ${after} after)`);
    outcomes.push({ seed, truth_log_hash, key_text: out.key_text, cells: out.cells, hold_limit: out.hold_limit });
    hooks.onProgress?.(outcomes.length, spec.seeds.length);
    await yieldToLoop();
  }
  const result: OpenLoopResult = { scenario_id: config.scenario_id, engine_version: ENGINE_VERSION, seeds: [...spec.seeds], review, outcomes };
  return {
    ok: true,
    report: buildReport(result, { experiment_id: "lab", min_seeds: evaluation.min_seeds, ablations_of: ablationBaseId(data) }),
    // utilisation is read from the shared truth run, so the cells of the first architecture stand for all
    utilisation: utilisationView(outcomes.flatMap((o) => (o.cells[0] ? [o.cells[0]] : []))),
    inputs: inputsOf(data, spec, actions),
  };
};

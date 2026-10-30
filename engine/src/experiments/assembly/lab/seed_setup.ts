import { evaluationSettings } from "../../../evaluate/config.ts";
import { inject } from "../../../inject/inject.ts";
import type { MaterialisedError } from "../../../inject/types.ts";
import { loadProfile } from "../../../profiles.ts";
import type { Architecture } from "../../../record/architecture.ts";
import { runScenario } from "../../../run.ts";
import type { ScenarioRun } from "../../../run.ts";
import type { Dialect } from "../../../raw/types.ts";
import { rosterOf, seedInputFromRun } from "../from_run.ts";
import { entryConfigFor, rawSetupFor } from "../raw_setup.ts";
import type { SeedInput } from "../run_seed.ts";
import { architecturesOf } from "./spec.ts";
import type { RunSpec } from "./spec.ts";
import { analyzerPlan, scenarioConfig, scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";

// 2026-10-30 S3e (docs/design/lab_ui.md sections 4, 8 and 9): one seed of a spec, truth run and the input of `runSeed`, for the requests that look at one seed (lineage, challenge). It is the
// set-up of `runLab` (run.ts) for a single seed; the three copies (run, lineage, challenge) change for the same reason, so run.ts is left as the Step 3 batch built it and the two new users share this.

const DAY = 86400;

export interface LabSeed {
  run: ScenarioRun;
  input: SeedInput;
}

/** The architectures a spec names, in the order named. The caller has checked the ids against `architectureIds`. */
export const architecturesNamed = (data: LabData, ids: readonly string[]): Architecture[] => {
  const all = architecturesOf(data);
  return ids.map((id) => all.find((a) => a.id === id) ?? ((): never => { throw new Error(`no architecture ${id}`); })());
};

/** The records the reveal of a challenge compares: the presets (A, B, C) in order, then the shown architecture when it is an ablation of C. */
export const comparedWith = (data: LabData, shown: string): Architecture[] => {
  const presets = data.architectures.map((doc) => (doc as Architecture).id);
  return architecturesNamed(data, presets.includes(shown) ? presets : [...presets, shown]);
};

/** The truth run of the seed and the input of `runSeed` for the chosen architectures. A scenario that fails the engine's own validation throws with the engine's message. */
export const labSeed = (data: LabData, spec: RunSpec, seed: number, architectures: readonly Architecture[]): LabSeed => {
  const evaluation = evaluationSettings(data.evaluation);
  const { staff: staffId } = scenarioDoc(data, spec.scenario).profiles;
  const staff = loadProfile(data.lookup("staff", staffId as string), "staff").params;
  const config = scenarioConfig(data, spec.scenario, spec.settings, seed, {
    ...(spec.bay_profiles && { bay_profiles: spec.bay_profiles }),
    ...(spec.analyzer_profiles && { analyzer_profiles: spec.analyzer_profiles }),
    ...(spec.capture_path && { capture_path: spec.capture_path }),
  });
  const roster = rosterOf(config.sampling);
  const plan = analyzerPlan(data, spec.scenario, spec.analyzer_profiles);
  const dialects = data.dialects as Readonly<Record<string, Dialect>>;
  const raw = config.raw ? { raw: rawSetupFor(config.raw, plan, dialects, roster), entry_rules: entryConfigFor(plan, dialects) } : {};
  const run = runScenario({ ...config, seed });
  const input = seedInputFromRun(run, {
    scenario_id: config.scenario_id, staff, evaluation, architectures, days: config.process.horizon_s / DAY,
    review: { roster, timing: "next_shift_start", reject_also: [] }, ...raw,
  });
  return { run, input };
};

/**
 * The injector's realised errors of each architecture, as plain data. It is the same call `runSeed` makes (same seed, events, rates, offsets and forced list), so it gives the same
 * list the answer key is written from; the lab reads it here instead of the key (spec section 3, rule 2: the evaluator is the key's only reader). The injector is a keyed function of
 * its input, so calling it again changes nothing.
 */
export const materialisedOf = (input: SeedInput): Record<string, MaterialisedError[]> =>
  Object.fromEntries(
    input.architectures.map((architecture) => [
      architecture.id,
      inject({
        seed: input.seed, architecture, events: input.events,
        ...(input.label_rate_by_operator && { label_rate_by_operator: input.label_rate_by_operator }),
        ...(input.clock_offsets && { clock_offsets: input.clock_offsets }),
        ...(input.forced && { forced: input.forced }),
      }).materialised,
    ]),
  );

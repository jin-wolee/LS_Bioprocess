import type { EvaluationSettings } from "../../evaluate/config.ts";
import type { ForcedError } from "../../inject/types.ts";
import type { Architecture } from "../../record/architecture.ts";
import { createRng } from "../../rng.ts";
import type { Rng } from "../../rng.ts";
import { runScenario } from "../../run.ts";
import type { ScenarioConfig } from "../../scenario.ts";
import { ENGINE_VERSION } from "../../trace.ts";
import { runArm } from "./closed_loop_arm.ts";
import type { ArmOutcome, ArmSpec } from "./closed_loop_arm.ts";
import type { Variant } from "./closed_loop_config.ts";
import { buildShared } from "./closed_loop_shared.ts";

// 2026-10-30 S2c3, experiment 2, closed loop (SC8, spec 6.2). For each seed one lab run is shared by every arm (the truth of the lab is the open-loop run: nothing in the lab
// depends on pH), then the pH loop runs once per arm: the oracle, A, B, C, and the sensitivity variants of the config. Every arm draws from the same canonical keys, so the
// arms differ only by their decisions. The plain run refuses `feedback: true`; the loop is run here, on a scenario that sets it.

export interface ClosedLoopInput {
  /** The parsed SC8 scenario: `feedback` is true and the pH feedback settings are present. Its own `seed` is replaced by each seed of the list. */
  scenario: ScenarioConfig;
  seeds: readonly number[];
  evaluation: EvaluationSettings;
  /** A, B and C, in report order. */
  architectures: readonly Architecture[];
  variants: readonly Variant[];
  /** S3d: errors to plant in the record of every architecture (the injector's forced mode, lab_ui.md section 9). Absent or empty: no plant, and every output is what it was without this field. */
  forced?: readonly ForcedError[];
}

export interface SeedOutcome {
  seed: number;
  /** The oracle first, then the architectures, then the variants. */
  arms: ArmOutcome[];
}

export interface ClosedLoopResult {
  scenario_id: string;
  engine_version: string;
  seeds: number[];
  outcomes: SeedOutcome[];
}

export const runClosedLoopSeed = (input: ClosedLoopInput, seed: number, rng: Rng = createRng()): SeedOutcome => {
  if (!input.scenario.feedback) throw new Error("closed loop: the scenario must set feedback: true (SC8); every other scenario stays open loop");
  const run = runScenario({ ...input.scenario, seed, feedback: false });
  const shared = buildShared(run, input.scenario, seed, { architectures: input.architectures, evaluation: input.evaluation, rng, ...(input.forced && { forced: input.forced }) });
  const specs: ArmSpec[] = [
    { id: "oracle", kind: "oracle" },
    ...input.architectures.map((a): ArmSpec => ({ id: a.id, kind: "architecture", structure: a.id })),
    ...input.variants.map((v): ArmSpec => ({ id: v.id, kind: "sensitivity", structure: v.of, bias_handling: v.bias_handling })),
  ];
  return { seed, arms: specs.map((spec) => runArm(shared, spec, rng)) };
};

export const runClosedLoop = (input: ClosedLoopInput): ClosedLoopResult => ({
  scenario_id: input.scenario.scenario_id,
  engine_version: ENGINE_VERSION,
  seeds: [...input.seeds],
  outcomes: input.seeds.map((seed) => runClosedLoopSeed(input, seed)),
});

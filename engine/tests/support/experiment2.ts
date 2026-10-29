import { evaluationSettings } from "../../src/evaluate/config.ts";
import { parseClosedLoopConfig } from "../../src/experiments/assembly/closed_loop_config.ts";
import type { ClosedLoopConfig } from "../../src/experiments/assembly/closed_loop_config.ts";
import type { ClosedLoopInput } from "../../src/experiments/assembly/closed_loop.ts";
import type { ClosedLoopHead } from "../../src/experiments/assembly/closed_loop_report.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { loadScenario } from "../../src/scenario.ts";
import { readJson } from "./paths.ts";
import { lookup } from "./scenarios.ts";

// Test-side file access for the experiment 2 runner (engine/src reads no file): the experiment config in, the plain-data inputs of the closed loop out.

export interface ClosedLoopExperiment {
  config: ClosedLoopConfig;
  input: ClosedLoopInput;
  head: ClosedLoopHead;
}

export const loadClosedLoop = (configDoc: unknown): ClosedLoopExperiment => {
  const evaluation = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
  const config = parseClosedLoopConfig(configDoc, evaluation.min_seeds);
  return {
    config,
    head: { experiment_id: config.experiment_id, min_seeds: evaluation.min_seeds, bootstrap: config.bootstrap, assumptions: config.assumptions },
    input: {
      scenario: loadScenario(readJson("scenarios", `${config.scenario}.json`), lookup),
      seeds: config.seeds,
      evaluation,
      architectures: config.presets.map((name) => parseArchitecture(readJson("scenarios", "architectures", `${name}.json`))),
      variants: config.variants,
    },
  };
};

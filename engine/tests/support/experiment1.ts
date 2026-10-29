import { evaluationSettings } from "../../src/evaluate/config.ts";
import { parseExperimentConfig } from "../../src/experiments/assembly/config.ts";
import type { ExperimentConfig } from "../../src/experiments/assembly/config.ts";
import type { OpenLoopInput } from "../../src/experiments/assembly/open_loop.ts";
import type { ReportHead } from "../../src/experiments/assembly/report.ts";
import { loadProfile } from "../../src/profiles.ts";
import { ABLATIONS, parseArchitecture } from "../../src/record/architecture.ts";
import { loadScenario } from "../../src/scenario.ts";
import { readJson } from "./paths.ts";
import { lookup } from "./scenarios.ts";

// Test-side file access for the experiment runner (engine/src reads no file): the experiment config in, the plain-data inputs of the open loop out.

export interface Experiment {
  config: ExperimentConfig;
  input: OpenLoopInput;
  head: ReportHead;
}

export const loadExperiment = (configDoc: unknown): Experiment => {
  const evaluation = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
  const config = parseExperimentConfig(configDoc, evaluation.min_seeds);
  const preset = (name: string) => parseArchitecture(readJson("scenarios", "architectures", `${name}.json`));
  const ablated = ABLATIONS(preset(config.ablations_of)).map((x) => x.config);
  const rawScenario = readJson<{ profiles: { staff: string } }>("scenarios", `${config.scenario}.json`);
  return {
    config,
    head: { experiment_id: config.experiment_id, min_seeds: evaluation.min_seeds, ablations_of: config.ablations_of },
    input: {
      scenario: loadScenario(rawScenario, lookup),
      seeds: config.seeds,
      staff: loadProfile(lookup("staff", rawScenario.profiles.staff), "staff").params,
      evaluation,
      architectures: [...config.presets.map(preset), ...ablated],
    },
  };
};

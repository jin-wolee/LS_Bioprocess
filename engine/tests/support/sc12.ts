import { evaluationSettings } from "../../src/evaluate/config.ts";
import { breakoutCase } from "../../src/experiments/assembly/breakout.ts";
import type { BreakoutRunInput } from "../../src/experiments/assembly/breakout.ts";
import { parseBreakoutConfig, patchScenario } from "../../src/experiments/assembly/breakout_config.ts";
import type { BreakoutExperimentConfig } from "../../src/experiments/assembly/breakout_config.ts";
import type { BreakoutReportHead } from "../../src/experiments/assembly/breakout_report.ts";
import { loadProfile } from "../../src/profiles.ts";
import { ABLATIONS, parseArchitecture } from "../../src/record/architecture.ts";
import { loadScenario } from "../../src/scenario.ts";
import { readJson } from "./paths.ts";
import { lookup } from "./scenarios.ts";

// Test-side file access for the SC12 runner (engine/src reads no file): the experiment config in, the plain-data inputs of the break-out experiment out.

export interface BreakoutExperiment {
  config: BreakoutExperimentConfig;
  input: BreakoutRunInput;
  head: BreakoutReportHead;
}

export const loadSc12 = (configDoc: unknown, only?: readonly string[]): BreakoutExperiment => {
  const evaluation = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
  const config = parseBreakoutConfig(configDoc, evaluation.min_seeds);
  const preset = (name: string) => parseArchitecture(readJson("scenarios", "architectures", `${name}.json`));
  const ablated = ABLATIONS(preset(config.ablations_of)).map((x) => x.config);
  const chosen = config.cases.filter((c) => only === undefined || only.includes(c.case_id));
  const staffs = new Set(chosen.map((c) => readJson<{ profiles: { staff: string } }>("scenarios", `${c.scenario}.json`).profiles.staff));
  if (staffs.size !== 1) throw new Error(`the cases use ${staffs.size} staff profiles; the runner takes one`);
  return {
    config,
    head: { experiment_id: config.experiment_id, min_seeds: evaluation.min_seeds, ablations_of: config.ablations_of },
    input: {
      cases: chosen.map((c) => breakoutCase(c, loadScenario(patchScenario(readJson("scenarios", `${c.scenario}.json`), c.set, c.case_id), lookup))),
      seeds: config.seeds,
      staff: loadProfile(lookup("staff", [...staffs][0] as string), "staff").params,
      evaluation,
      architectures: [...config.presets.map(preset), ...ablated],
    },
  };
};

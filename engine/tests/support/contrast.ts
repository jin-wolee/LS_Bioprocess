import { evaluationSettings } from "../../src/evaluate/config.ts";
import { parseContrastConfig } from "../../src/experiments/assembly/capture_contrast.ts";
import type { ContrastConfig, ContrastInput } from "../../src/experiments/assembly/capture_contrast.ts";
import { loadProfile } from "../../src/profiles.ts";
import type { Profile } from "../../src/profiles.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { loadScenario } from "../../src/scenario.ts";
import { readJson } from "./paths.ts";
import { CONTROLLERS, DIALECTS } from "./raw_run.ts";
import { REVIEW } from "./review_setup.ts";
import { lookup, patched, rawScenario } from "./scenarios.ts";
import type { Patch } from "./scenarios.ts";

// Test-side file access for the capture-path contrast runner (engine/src reads no file): the config in, the plain-data input of `runContrast` out.

export const loadContrast = (configDoc: unknown, p: Patch = {}, seeds?: readonly number[]): { config: ContrastConfig; input: ContrastInput } => {
  const evaluation = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
  const config = parseContrastConfig(configDoc, evaluation.min_seeds);
  const doc = patched(rawScenario(config.scenario), p);
  doc.raw_layer = true;
  doc.bay_controllers = config.bay_controllers;
  doc.calendar_anchor = config.calendar_anchor;
  (doc.settings as Record<string, unknown>).device_zone_h = config.device_zone_h;
  const scenario = loadScenario(doc, lookup);
  const staffId = (doc.profiles as { staff: string }).staff;
  return {
    config,
    input: {
      scenario, seeds: seeds ?? config.seeds, presets: config.presets.map((n) => parseArchitecture(readJson("scenarios", "architectures", `${n}.json`))), blocks: config.blocks,
      analyzer: lookup("analyzer", (doc.profiles as { analyzer: string }).analyzer) as Profile, dialects: DIALECTS, controllers: CONTROLLERS,
      staff: loadProfile(lookup("staff", staffId), "staff").params, evaluation, review: REVIEW,
    },
  };
};

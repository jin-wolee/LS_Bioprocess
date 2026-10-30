import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { readJson } from "./paths.ts";
import { lookup } from "./scenarios.ts";

// The bundle the lab Worker holds (src/worker/data.ts), read from the files instead of imported: scenarios/default.json, its profiles through the test lookup, A, B and C, the evaluation settings.

export const labData = (): LabData => ({
  scenarios: { default: readJson("scenarios", "default.json") },
  lookup,
  architectures: ["a_manual", "b_lims_lite", "c_context"].map((name) => readJson("scenarios", "architectures", `${name}.json`)),
  evaluation: readJson("scenarios", "evaluation", "default.json"),
});

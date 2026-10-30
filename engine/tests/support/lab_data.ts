import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { readJson } from "./paths.ts";
import { lookup } from "./scenarios.ts";

// The bundle the lab Worker holds (src/worker/data.ts), read from the files instead of imported: the four scenarios of the Setup picker, the profiles and dialects they can name, A, B and C,
// the evaluation settings, the seed list of experiment 1 and the lab's own raw-layer inputs.

export const LAB_SCENARIOS = ["default", "sc02_shift_burst", "sc03_feed_in_gap", "sc05_one_analyzer_down"] as const;
export const LAB_PROFILES: readonly (readonly [kind: "bioreactor" | "analyzer" | "staff", id: string])[] = [
  ["bioreactor", "bench_manual"], ["bioreactor", "micro_mini_parallel"], ["bioreactor", "pilot"],
  ["analyzer", "allinone_atline"], ["analyzer", "hplc"], ["analyzer", "split_cellcounter_metabolite"],
  ["staff", "experienced"], ["staff", "trainee"],
];
export const LAB_DIALECTS = ["allinone_csv", "counter_csv", "cds_table"] as const;

export const labData = (): LabData => ({
  scenarios: Object.fromEntries(LAB_SCENARIOS.map((id) => [id, readJson("scenarios", `${id}.json`)])),
  lookup,
  profiles: LAB_PROFILES.map(([kind, id]) => lookup(kind, id)),
  dialects: Object.fromEntries(LAB_DIALECTS.map((id) => [id, readJson("scenarios", "profiles", "dialect", `${id}.json`)])),
  architectures: ["a_manual", "b_lims_lite", "c_context"].map((name) => readJson("scenarios", "architectures", `${name}.json`)),
  evaluation: readJson("scenarios", "evaluation", "default.json"),
  experiment: readJson("scenarios", "experiments", "experiment1.json"),
  rawLayer: readJson("src", "worker", "raw_layer.json"),
});

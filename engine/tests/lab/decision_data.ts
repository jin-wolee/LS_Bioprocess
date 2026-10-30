import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { SMALL } from "../support/scenarios.ts";

// The bundle of the lab Worker with the decision variant of the challenge (src/worker/data.ts bundles the same two files): SC8, which the Setup picker does not offer, and the seed list of
// experiment 2. The world of the decision tests is the small SC8 with the technique probability at 0.5, as in decisions.test.ts (seed 3).

export const DECISION_SCENARIO = "sc08_ph_restandardisation";

export const decisionData = (): LabData => ({
  ...labData(),
  decision: { scenario: readJson("scenarios", `${DECISION_SCENARIO}.json`), experiment: readJson("scenarios", "experiments", "experiment2.json") },
});

/** The settings of the small world of the decision tests (a quarter of the plant, a technique error in every second sample). */
export const DECISION_SMALL: Record<string, number> = { ...SMALL, technique_error_probability: 0.5 };

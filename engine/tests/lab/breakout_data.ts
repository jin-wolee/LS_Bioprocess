import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";

// The bundle of the lab Worker with the Break-out screen (src/worker/data.ts bundles the same files when the build offers the screen): the five SC12 scenarios, the two event-type profiles
// they name and the experiment config whose seed list the screen offers. The Setup picker does not offer the SC12 scenarios.

export const BREAKOUT_SCENARIOS = ["sc12_medium_lot", "sc12_seed_lot", "sc12_sampling", "sc12_equipment", "sc12_mycoplasma"] as const;
export const BREAKOUT_PROFILES = ["bacterial", "mycoplasma"] as const;

export const breakoutData = (): LabData => ({
  ...labData(),
  breakout: {
    scenarios: Object.fromEntries(BREAKOUT_SCENARIOS.map((id) => [id, readJson("data", "scenarios", `${id}.json`)])),
    profiles: BREAKOUT_PROFILES.map((id) => readJson("data", "scenarios", "profiles", "breakout", `${id}.json`)),
    experiment: readJson("data", "scenarios", "experiments", "sc12.json"),
  },
});

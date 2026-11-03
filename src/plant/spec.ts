import type { PlantCaseSpec, PlantSpec } from "../protocol.ts";

// What the plant of P3 asks the Worker for: the default scenario at its own size, seed 1 (the first seed of the goldens, spec section 7; the page draws no random number), the three presets as the
// record halls (A, B and C), and no operator action yet (the action bar of P6 sends them). `run.seeds` is ignored by a plant run, which is one seed.
export const DEFAULT_PLANT: PlantSpec = {
  run: { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: [1] },
  seed: 1,
  actions: [],
};

/** What the page asks the Worker for: the run form's spec, or a break-out case of the local build (docs/design/plant_ui.md section 6, rule 11; section 7, "As built in P7c"). */
export type PlantAsk = PlantSpec | PlantCaseSpec;

export const isCase = (spec: PlantAsk): spec is PlantCaseSpec => "case" in spec;
/** The name the HUD and the bars give the run: the scenario of a run form, the case of a case. */
export const scenarioOf = (spec: PlantAsk): string => (isCase(spec) ? spec.case : spec.run.scenario);
/** The record halls of the run, as the spec names them (the records the run began with). */
export const hallsOf = (spec: PlantAsk): string[] => (isCase(spec) ? spec.architectures : spec.run.architectures);

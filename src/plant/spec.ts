import type { PlantSpec } from "../protocol.ts";

// What the plant of P3 asks the Worker for: the default scenario at its own size, seed 1 (the first seed of the goldens, spec section 7; the page draws no random number), the three presets as the
// record halls (A, B and C), and no operator action yet (the action bar of P6 sends them). `run.seeds` is ignored by a plant run, which is one seed.
export const DEFAULT_PLANT: PlantSpec = {
  run: { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: [1] },
  seed: 1,
  actions: [],
};

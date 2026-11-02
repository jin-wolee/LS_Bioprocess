import { describe, expect, it } from "vitest";
import { stateAt } from "../src/process.ts";
import { configOf, NO_DEATH, runOf, SMALL } from "./support/scenarios.ts";

// Audit A1, finding F6 (2026-11-02): with a 120 s integration step a feed scripted at 09:01 was logged at 09:01 and applied at the next step, 09:02, so the state at the logged
// instant did not have it. The author's decision: the integration step and the sensor cadence must divide one minute, because scheduled events sit on whole minutes (A200), and
// any other value is refused, so an event can never fall between two steps (spec section 2.1). The default 60 s is unchanged.

/** Growth, death and the uptakes off: the glucose moves only by the dilution of a feed. */
const STILL = { ...SMALL, mu_max_per_h: 0, ...NO_DEATH, glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0 };
/** A feed scripted on U01 at day 1, 09:01 (1440 + 541 = 1981 min). */
const FEED = { scripted_events: [{ type: "feed", unit_id: "U01", at: { value: 1981, unit: "min", ref: "A228" } }] };

describe("F6: the integration step and the sensor cadence divide one minute", () => {
  it("Given an integration step and a sensor cadence of 120 s When the scenario is loaded Then it is refused, naming A200", () => {
    expect(() => configOf("default", { settings: { ...STILL, integration_step_s: 120, sensor_cadence_s: 120 }, fields: FEED })).toThrow(/A200/);
  });

  // By hand: U01 holds 8 g/L glucose (A190) until the feed; the bolus adds 2.4 percent of the volume (A192) at 500 g/L (A193), so at 1981 min the glucose is
  // (8 + 0.024 x 500) / 1.024 = 20 / 1.024 = 19.53125 g/L. The daily rule feeds nothing (no uptake, 8 g/L is above the 1 g/L floor of A010).
  it("Given the default 60 s step and a feed scripted on a whole minute When the state is read at the feed's instant Then it has the feed: 19.53125 g/L", () => {
    const run = runOf("default", { settings: STILL, fields: FEED });
    expect(stateAt(run.process, "U01", 1981 * 60).glucose).toBeCloseTo(19.53125, 10);
  });
});

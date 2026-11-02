import { describe, expect, it } from "vitest";
import { labSeed } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { labData } from "../support/lab_data.ts";

// Audit A1, finding F4 (2026-11-02): the utilisation per staffed window divides by days x 10 h, while the roster gives a weekend day 6 h (A201). The fix is batch A2 (the
// utilisation denominator), not this one, so the test is `it.fails`: it passes while the defect stands and turns the gate red the day A2, or an accident, fixes it; A2 then
// makes it a plain test. By hand: 21 days from a Monday (day 0 is a Monday, A188) are 3 weeks, 15 weekdays of 08:00 to 18:00 (10 h) and 6 weekend days of 08:00 to 14:00
// (6 h, A201), so each of the two analyzers has 15 x 10 + 6 x 6 = 186 staffed hours, and the denominator is 2 x 186 x 3600 = 1,339,200 analyzer-seconds.

const data = labData();

describe("F4 (fixed by A2): the staffed-window denominator follows the roster", () => {
  it.fails("Given the default scenario, seed 1 When utilisation is evaluated Then the staffed-window denominator is 2 x (15 x 10 + 6 x 6) x 3600 analyzer-seconds", () => {
    const spec: RunSpec = { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual"], seeds: [1] };
    const out = runSeed(labSeed(data, spec, 1, data.architectures.map(parseArchitecture).filter((a) => a.id === "a_manual")).input);
    expect(out.cells[0]?.metrics.utilisation.per_staffed_window.with_setup.den).toBe(2 * (15 * 10 + 6 * 6) * 3600);
  });
});

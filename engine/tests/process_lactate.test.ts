import { describe, expect, it } from "vitest";
import { advance, runProcess, stateAt } from "../src/process.ts";
import type { Mult, ProcessConfig, ProcessRun, State } from "../src/process.ts";
import { createRng } from "../src/rng.ts";
import { configOf, NO_DEATH } from "./support/scenarios.ts";

// L1 lactate (spec 2.1; A011, A084, A085, A196). Expected values are hand arithmetic from the ledger values quoted in each test, never engine output.
// One Euler step of 3600 s is used, so dt in hours is 1 and in days 1/24. Lactate units: a rate q in pmol/cell/d at X (1e6 cells/mL) is q x X mmol/L/d,
// times 90.08/1000 g/mmol: production 2.3 gives 0.207184 x X g/L/d, the net rate -0.15 gives -0.13512 g/L/d at X = 10 (-0.00563 g/L per hour).

const DAY = 86400;
const HOUR = 3600;
const BASE: ProcessConfig = configOf("default").process;
const ONE: Mult = { mu: 1, kd: 1, prod: 1 };
const HALF: Mult = { mu: 0.5, kd: 0.5, prod: 1.5 };
/** phi = 1 exactly: no Monod limit (Ks = 0, glucose above 0) and a ceiling so far away that max(0, 1 - X / Xmax) = 1. */
const FREE: Partial<ProcessConfig> = { ks: 0, xmax: 1e300 };
const FALL = (0.15 * 10 * 0.09008) / 24; // 0.00563 g/L lost in one hour at X = 10

/** One explicit Euler step of dt seconds from a state at culture age age_s; unlisted fields take plain values (10 e6 cells/mL, 8 g/L glucose, 0.3 g/L lactate). */
const step = (cfg: Partial<ProcessConfig>, s: Partial<State>, m: Mult = ONE, age_s = 0, dt = HOUR): State => {
  const state: State = { x: 10, d: 0, g: 8, q: 4, l: 0.3, p: 0, ...s };
  advance({ ...BASE, ...cfg }, state, m, dt, age_s);
  return state;
};

describe("L1 lactate: production follows the growth rate in effect, temperature included (A011, A084, A196, S056)", () => {
  it("Given phi = 1 and no shift When one step passes Then lactate rises by the full rate: 0.3 + 0.207184 x 10 / 24 = 0.38632667 g/L", () => {
    expect(step({ ...FREE, mu: 0 }, {}).l).toBeCloseTo(0.3 + (0.207184 * 10) / 24, 12);
  });

  it("Given the same state after the shift (growth multiplier 0.5) Then the step makes half the lactate: 0.3 + 0.5 x 0.207184 x 10 / 24 = 0.34316333 g/L", () => {
    const before = step({ ...FREE, mu: 0 }, {}).l - 0.3;
    const after = step({ ...FREE, mu: 0 }, {}, HALF).l;
    expect(after).toBeCloseTo(0.3 + (0.5 * 0.207184 * 10) / 24, 12);
    expect(after - 0.3).toBeCloseTo(before / 2, 12);
  });

  it("Given a growth multiplier of 0 Then no lactate is made, whatever phi", () => {
    expect(step({ ...FREE, mu: 0 }, {}, { mu: 0, kd: 1, prod: 1 }).l).toBe(0.3);
  });

  it("Given the multiplier changes productivity and death only (mu 1, kd 0.5, prod 1.5) Then lactate is the unshifted value", () => {
    expect(step({ ...FREE, mu: 0 }, {}, { mu: 1, kd: 0.5, prod: 1.5 }).l).toBeCloseTo(0.3 + (0.207184 * 10) / 24, 12);
  });
});

describe("L1 lactate: the switch to net consumption (A085)", () => {
  it("Given age exactly 7 d (the onset) and phi = 1 When one step passes Then the net rate -0.15 x X replaces production: 0.3 - 0.00563 = 0.29437 g/L, not 0.3 + 0.0863 - 0.00563", () => {
    expect(step(FREE, {}, ONE, 7 * DAY).l).toBeCloseTo(0.3 - FALL, 12);
    expect(0.3 - FALL).toBeCloseTo(0.29437, 12); // the hand value of the title
  });

  it("Given 1 s before the onset Then production still rules: 0.3 + 0.207184 x 10 / 24", () => {
    expect(step(FREE, {}, ONE, 7 * DAY - 1).l).toBeCloseTo(0.3 + (0.207184 * 10) / 24, 12);
  });

  it("Given no glucose (phi = 0) and the shift multipliers after the onset Then the step is still -0.15 x X: the net rate depends on neither glucose nor temperature", () => {
    expect(step({}, { g: 0 }, HALF, 9 * DAY).l).toBeCloseTo(0.3 - FALL, 12);
  });

  it("Given X = 20 Then the net change doubles (-0.15 x 20 x 0.09008 / 24 = -0.01126 g/L per hour)", () => {
    expect(step({}, { x: 20 }, ONE, 8 * DAY).l).toBeCloseTo(0.3 - 2 * FALL, 12);
  });

  it("Given lactate 0.001 g/L, below one hour of consumption (0.00563) When a step passes after the onset Then lactate is 0, not negative", () => {
    expect(step({}, { l: 0.001 }, ONE, 7 * DAY).l).toBe(0);
  });

  it("Given lactate 0 When a step passes after the onset Then it stays 0", () => {
    expect(step({}, { l: 0 }, ONE, 10 * DAY).l).toBe(0);
  });

  it("Given the switch off and age 10 d Then the production-only rule holds: 0.3 + 0.207184 x 10 / 24", () => {
    expect(step({ ...FREE, lacOn: false }, {}, ONE, 10 * DAY).l).toBeCloseTo(0.3 + (0.207184 * 10) / 24, 12);
  });

  it("Given a changed net rate (-0.55) and onset day (5 d) Then the step follows them: 0.3 - 0.55 x 10 x 0.09008 / 24 = 0.279357 g/L from age 5 d", () => {
    const cfg = { qLacNet: -0.55, lacOnset_s: 5 * DAY };
    expect(step(cfg, {}, ONE, 5 * DAY).l).toBeCloseTo(0.3 - (0.55 * 10 * 0.09008) / 24, 12);
    expect(step({ ...FREE, ...cfg }, {}, ONE, 5 * DAY - 1).l).toBeCloseTo(0.3 + (0.207184 * 10) / 24, 12);
  });
});

describe("L1 lactate: the switch as scenario data (A085)", () => {
  it("Given the default scenario Then the switch is on from 7 d with -0.15 pmol/cell/d", () => {
    expect(BASE).toMatchObject({ lacOn: true, lacOnset_s: 7 * DAY, qLacNet: -0.15 });
  });

  it("Given lactate_switch_on 0 Then the switch is off", () => {
    expect(configOf("default", { settings: { lactate_switch_on: 0 } }).process.lacOn).toBe(false);
  });

  it("Given a switch value other than 0 or 1, or a negative onset day Then the scenario is refused", () => {
    expect(() => configOf("default", { settings: { lactate_switch_on: 2 } })).toThrow(/lactate switch/);
    expect(() => configOf("default", { settings: { lactate_switch_day: -1 } })).toThrow(/lactate switch/);
  });

  it("Given a fractional onset day (6.3 d) Then the onset is a whole number of seconds", () => {
    expect(Number.isInteger(configOf("default", { settings: { lactate_switch_day: 6.3 } }).process.lacOnset_s)).toBe(true);
  });
});

const proc = (settings: Record<string, number> = {}): ProcessRun => runProcess(configOf("default", { settings }).process, 1, createRng());

// A culture where only lactate moves: no growth, no death, no glucose uptake (so no bolus dilutes anything) and no production, 0.5 g/L lactate at X = 10.
// Before the onset lactate stays 0.5; after it, X is constant, so lactate falls linearly by 0.13512 g/L per day until it reaches 0.
const ONLY_LACTATE = { ...NO_DEATH, mu_max_per_h: 0, glucose_uptake_pmol_per_cell_d: 0, lactate_production_pmol_per_cell_d: 0, inoculation_density_e6_per_ml: 10, initial_lactate_g_per_l: 0.5 };

describe("L1 lactate: a whole run with the switch (A085)", () => {
  const on = proc(ONLY_LACTATE);
  const at = (run: ProcessRun, age: number) => stateAt(run, "U01", (run.byUnit.get("U01")?.inoculated_s as number) + age).lactate;

  it("Given the switch on Then lactate is 0.5 until day 7, 0.5 - 0.13512 = 0.36488 on day 8, and 0 from day 11 (0.5 / 0.13512 = 3.7 d of consumption)", () => {
    expect(at(on, 6 * DAY)).toBeCloseTo(0.5, 9);
    expect(at(on, 7 * DAY)).toBeCloseTo(0.5, 9);
    expect(at(on, 8 * DAY)).toBeCloseTo(0.5 - 0.13512, 9);
    expect(at(on, 11 * DAY)).toBe(0);
    expect(at(on, 14 * DAY)).toBe(0);
  });

  it("Given a query inside a step after the onset (8 d + 30 s) Then the partial step uses the same rule: 0.36488 - 0.13512 x 30 / 86400", () => {
    expect(at(on, 8 * DAY + 30)).toBeCloseTo(0.5 - 0.13512 - (0.13512 * 30) / DAY, 9);
  });

  it("Given the switch off Then lactate stays 0.5 for the whole culture", () => {
    const off = proc({ ...ONLY_LACTATE, lactate_switch_on: 0 });
    expect(at(off, 8 * DAY)).toBeCloseTo(0.5, 9);
    expect(at(off, 14 * DAY)).toBeCloseTo(0.5, 9);
  });
});

describe("L1 lactate: structural relations on the default scenario", () => {
  const stepsAfterDay7 = (run: ProcessRun): { steps: number; rises: number; falls: number } => {
    let steps = 0;
    let rises = 0;
    let falls = 0;
    for (const r of run.reactors) {
      for (let k = Math.ceil((7 * DAY) / r.step_s); k + 1 < r.n; k++) {
        steps++;
        const a = r.l[k] as number;
        const b = r.l[k + 1] as number;
        if (b > a) rises++;
        if (b < a) falls++;
      }
    }
    return { steps, rises, falls };
  };

  it("Given the default scenario Then after culture day 7 lactate never increases in any reactor, and it does fall (the check is not vacuous)", () => {
    const r = stepsAfterDay7(proc());
    expect(r.steps).toBeGreaterThan(0);
    expect(r.falls).toBeGreaterThan(0);
    expect(r.rises).toBe(0);
  });

  it("Given the switch off Then lactate does rise after day 7, so the relation above is a property of the switch", () => {
    expect(stepsAfterDay7(proc({ lactate_switch_on: 0 })).rises).toBeGreaterThan(0);
  });
});

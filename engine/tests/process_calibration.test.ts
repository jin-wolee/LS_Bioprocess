import { describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import { advance, runProcess, stateAt } from "../src/process.ts";
import type { Mult, ProcessConfig, ProcessRun, State } from "../src/process.ts";
import { createRng } from "../src/rng.ts";
import { configOf, NO_DEATH } from "./support/scenarios.ts";
import type { Json } from "./support/schemas.ts";

// L1 calibration (spec 2.1; A011, A050, A212, A081, A008). Expected values are hand arithmetic from the ledger values quoted in each test,
// never engine output. One Euler step of 3600 s is used, so dt in hours is 1 and in days 1/24; units as in process.test.ts:
// glucose uptake per step = 2.5 x X x 180.16/1000 / 24 g/L (X in 1e6 cells/mL), glutamine 1.2 x X / 24 mM, lactate 2.3 x 90.08/1000 x X x phi / 24 g/L.

const DAY = 86400;
const HOUR = 3600;
const BASE: ProcessConfig = configOf("default").process;
const ONE: Mult = { mu: 1, kd: 1, prod: 1 };

/** One explicit Euler step of dt seconds from a state; unlisted fields take plain values (10 e6 cells/mL, 8 g/L glucose, 0.3 g/L lactate). */
const step = (cfg: Partial<ProcessConfig>, s: Partial<State>, m: Mult = ONE, dt = HOUR): State => {
  const state: State = { x: 10, d: 0, g: 8, q: 4, l: 0.3, p: 0, ...s };
  advance({ ...BASE, ...cfg }, state, m, dt);
  return state;
};
/** phi = 1 exactly: no Monod limit (Ks = 0, glucose above 0) and a ceiling so far away that max(0, 1 - X / Xmax) = 1. */
const FREE: Partial<ProcessConfig> = { ks: 0, xmax: 1e300 };

describe("L1 calibration: death coupled to the limitation of growth (A011, A212, A081)", () => {
  it("Given phi = 1 When one step passes Then death is kd_min x m_T,kd: x = 10 - 0.0013 x 0.5 x 10 = 9.9935, dead cells 0.0065", () => {
    const s = step({ ...FREE, mu: 0 }, {}, { mu: 1, kd: 0.5, prod: 1 });
    expect(s.x).toBeCloseTo(9.9935, 12);
    expect(s.d).toBeCloseTo(0.0065, 12);
  });

  it("Given the density is at the ceiling (X = Xmax = 20, phi = 0) When one step passes Then growth is zero and death is kd_late x m_T,kd: x = 20 - 0.0042 x 0.5 x 20 = 19.958", () => {
    const s = step({}, { x: 20 }, { mu: 1, kd: 0.5, prod: 1 });
    expect(s.x).toBeCloseTo(19.958, 12);
    expect(s.d).toBeCloseTo(0.042, 12);
  });

  it("Given no glucose (phi = 0) When one step passes Then growth is zero and death is kd_late x m_T,kd: x = 5 - 0.0042 x 0.5 x 5 = 4.9895", () => {
    const s = step({}, { x: 5, g: 0 }, { mu: 1, kd: 0.5, prod: 1 });
    expect(s.x).toBeCloseTo(4.9895, 12);
    expect(s.d).toBeCloseTo(0.0105, 12);
  });

  it("Given a density above the ceiling (X = 25) When one step passes Then the factor stays at 0 and cells do not grow: x = 25 - 0.0042 x 25 = 24.895", () => {
    const s = step({}, { x: 25 });
    expect(s.x).toBeCloseTo(24.895, 12);
  });

  it("Given glucose = Ks and X = Xmax / 2 (phi = 0.25) When one step passes under the shift multipliers Then the temperature enters growth and death but not phi: mu = 0.027 x 0.5 x 0.25, kd = 0.0013 + 0.0029 x 0.75, x = 10 + (0.003375 - 0.003475) x 10 = 9.999", () => {
    const s = step({}, { g: 0.93 }, { mu: 0.5, kd: 1, prod: 1 });
    expect(s.x).toBeCloseTo(9.999, 12);
    expect(s.d).toBeCloseTo(0.03475, 12); // kd 0.003475 x 10 x 1 h
  });
});

describe("L1 calibration: mass balance (A011, A082, A083, A084)", () => {
  it("Given uptake demand above what is present (0.05 g/L glucose, 0.1 mM glutamine, X = 10) When one step passes Then both are taken up to zero and not below (demands 0.18767 g/L and 0.5 mM)", () => {
    const s = step({}, { g: 0.05, q: 0.1 });
    expect(s.g).toBe(0);
    expect(s.q).toBe(0);
  });

  it("Given enough glucose and glutamine (8 g/L, 4 mM, X = 10) When one step passes Then uptake is the full demand: 8 - 4.504/24 = 7.8123333 g/L and 4 - 12/24 = 3.5 mM", () => {
    const s = step({}, {});
    expect(s.g).toBeCloseTo(8 - 4.504 / 24, 12);
    expect(s.q).toBeCloseTo(3.5, 12);
  });

  it("Given a whole day as one step (dt = 24 h) and demand 4.504 g/L against 1 g/L present Then glucose is 0 and not negative", () => {
    expect(step({}, { g: 1 }, ONE, DAY).g).toBe(0);
  });

  it("Given no glucose When one step passes Then no lactate is produced and glucose stays 0, while the product still accumulates (35 x 5 x 1e-3 / 24)", () => {
    const s = step({}, { x: 5, g: 0 });
    expect(s.l).toBe(0.3);
    expect(s.g).toBe(0);
    expect(s.p).toBeCloseTo((35 * 5 * 1e-3) / 24, 12);
  });

  it("Given phi = 1 When one step passes Then lactate rises at the full rate: 0.3 + 0.207184 x 10 / 24 = 0.38632667 g/L", () => {
    expect(step({ ...FREE, mu: 0 }, {}).l).toBeCloseTo(0.3 + (0.207184 * 10) / 24, 12);
  });

  // 2026-10-29 lactate calibration (A011, A084, A196): lactate follows mu / mu_max, so the growth multiplier of the shift enters it; the second line changed from "whatever the temperature multiplier"
  it("Given phi = 0.25 (glucose = Ks, X = Xmax / 2) When one step passes Then lactate rises at a quarter of the rate: 0.3 + 0.207184 x 10 x 0.25 / 24, and at half of that after the shift (growth multiplier 0.5)", () => {
    expect(step({}, { g: 0.93 }).l).toBeCloseTo(0.3 + (0.207184 * 10 * 0.25) / 24, 12);
    expect(step({}, { g: 0.93 }, { mu: 0.5, kd: 0.5, prod: 1.5 }).l).toBeCloseTo(0.3 + (0.207184 * 10 * 0.25 * 0.5) / 24, 12);
  });

  it("Given the density is at the ceiling (phi = 0) When one step passes Then lactate does not rise", () => {
    expect(step({}, { x: 20 }).l).toBe(0.3);
  });
});

const proc = (settings: Record<string, number> = {}, fields?: Json): ProcessRun => runProcess(configOf("default", { settings, fields }).process, 1, createRng());
type ProcessEv = Extract<Event, { type: "process_event" }>;
const feedsOf = (run: ProcessRun, source: string): ProcessEv[] =>
  run.events.filter((e): e is ProcessEv => e.type === "process_event" && e.unit_id === "U01" && e.kind === "feed" && e.source === source);

// U01 is inoculated at 08:00 and decides first at 10:00, 2 h later. With growth and death off, X stays at its inoculation value and only glucose falls,
// linearly: D = 2.5 x X x 180.16/1000 g/L per day, so glucose at the first decision is g0 - D x 2/24.
const STILL = { ...NO_DEATH, mu_max_per_h: 0 };
const consumption = (x0: number): number => 2.5 * x0 * 0.18016;
const atFirstDecision = (g0: number, x0: number): number => g0 - consumption(x0) * (2 / 24);
/** The smallest bolus (share of the volume) that brings the next decision to the floor 1.0 g/L with the 500 g/L feed: (1.0 + D - g) / (500 - 1.0). */
const share = (g0: number, x0: number): number => (1.0 + consumption(x0) - atFirstDecision(g0, x0)) / 499;

describe("L1 calibration: the predictive feed rule (A050, A010, A193, A192)", () => {
  it("Given X = 10 and 4 g/L at inoculation When the first 10:00 decision comes Then the bolus is (1.0 + 4.504 - 3.62467) / 499 = 0.0037662 of the 2 L volume, not the fixed 2.4 percent", () => {
    const run = proc({ ...STILL, inoculation_density_e6_per_ml: 10, initial_glucose_g_per_l: 4 });
    const feeds = feedsOf(run, "rule");
    expect(feeds[0]).toMatchObject({ t: 10 * HOUR, amount_unit: "L" });
    expect(feeds[0]?.amount).toBeCloseTo(2 * share(4, 10), 12);
    expect(share(4, 10)).toBeCloseTo(0.0037662, 6); // the hand value of the test title
  });

  it("Given the same glucose and twice the viable density Then the consumption term doubles: D = 9.008 and the bolus is (1.0 + 9.008 - 3.24933) / 499", () => {
    const run = proc({ ...STILL, inoculation_density_e6_per_ml: 20, initial_glucose_g_per_l: 4 });
    expect(feedsOf(run, "rule")[0]?.amount).toBeCloseTo(2 * share(4, 20), 12);
    expect(share(4, 20)).toBeCloseTo((1 + 9.008 - (4 - 9.008 / 12)) / 499, 12);
  });

  it("Given that bolus Then glucose is (g + 500 f) / (1 + f) afterwards, cells are diluted to X / (1 + f), and 24 h later, one step before the next decision, glucose is 1.0 + D / (1 + f) / 1440", () => {
    const run = proc({ ...STILL, inoculation_density_e6_per_ml: 10, initial_glucose_g_per_l: 4 });
    const f = share(4, 10);
    const g = atFirstDecision(4, 10);
    const after = stateAt(run, "U01", 10 * HOUR);
    expect(after.glucose).toBeCloseTo((g + 500 * f) / (1 + f), 9);
    expect(after.vcd).toBeCloseTo(10 / (1 + f), 9);
    expect(stateAt(run, "U01", DAY + 10 * HOUR - 60).glucose).toBeCloseTo(1 + 4.504 / (1 + f) / 1440, 9);
  });

  it("Given the prediction at the next decision is above the floor (8 g/L, 8 - 0.375 - 4.504 = 3.12) Then no bolus is fed", () => {
    const run = proc({ ...STILL, inoculation_density_e6_per_ml: 10, initial_glucose_g_per_l: 8 });
    expect(feedsOf(run, "rule").filter((e) => e.t === 10 * HOUR)).toHaveLength(0);
  });

  it("Given the prediction is 0.01 g/L above the floor Then no bolus is fed, and 0.01 g/L below it Then the bolus is 0.01 / 499 of the volume", () => {
    const above = proc({ ...STILL, inoculation_density_e6_per_ml: 10, initial_glucose_g_per_l: 1.01 + 4.504 + 4.504 * (2 / 24) });
    expect(feedsOf(above, "rule").filter((e) => e.t === 10 * HOUR)).toHaveLength(0);
    const below = proc({ ...STILL, inoculation_density_e6_per_ml: 10, initial_glucose_g_per_l: 0.99 + 4.504 + 4.504 * (2 / 24) });
    const feed = feedsOf(below, "rule").find((e) => e.t === 10 * HOUR);
    expect(feed?.amount).toBeCloseTo((2 * 0.01) / 499, 12);
  });

  it("Given a scripted feed Then it keeps the fixed bolus of A192: 2.4 percent of 2 L = 0.048 L", () => {
    const at = { value: 2 * 1440 + 540, unit: "min", ref: "A102" };
    const run = proc({}, { scripted_events: [{ type: "feed", unit_id: "U01", at }] });
    const scripted = feedsOf(run, "scripted");
    expect(scripted).toHaveLength(1);
    expect(scripted[0]?.amount).toBeCloseTo(0.048, 12);
  });
});

describe("L1 calibration: structural relations", () => {
  // The default scenario may never run dry, so the relation is also checked on a run that does: the floor at 0 makes the rule only avoid a negative prediction.
  const runs: [string, ProcessRun][] = [["the default scenario", proc()], ["a run with the glucose floor at 0", proc({ glucose_floor_g_per_l: 0 })]];
  const dryStepsAndRises = (run: ProcessRun): { dry: number; rises: number } => {
    let dry = 0;
    let rises = 0;
    for (const r of run.reactors) {
      for (let k = 0; k + 1 < r.n; k++) {
        if (r.g[k] !== 0) continue;
        dry++;
        if ((r.l[k + 1] as number) > (r.l[k] as number)) rises++;
      }
    }
    return { dry, rises };
  };

  for (const [what, run] of runs) {
    it(`Given ${what} Then no state is negative or not finite (glucose, glutamine, lactate, titer, cells)`, () => {
      let bad = 0;
      for (const r of run.reactors) {
        for (let k = 0; k < r.n; k++) for (const a of [r.x, r.d, r.g, r.q, r.l, r.p]) if (!(Number.isFinite(a[k]) && (a[k] as number) >= 0)) bad++;
      }
      expect(bad).toBe(0);
    });

    it(`Given ${what} Then lactate does not increase in any step that starts with zero glucose`, () => {
      expect(dryStepsAndRises(run).rises).toBe(0);
    });
  }

  it("Given the run with the glucose floor at 0 Then glucose does run dry, so the relation above is not vacuous", () => {
    expect(dryStepsAndRises(runs[1]?.[1] as ProcessRun).dry).toBeGreaterThan(0);
  });
});

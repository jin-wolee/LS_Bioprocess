import { describe, expect, it } from "vitest";
import { runProcess, stateAt } from "../src/process.ts";
import type { ProcessRun, ScriptedEvent } from "../src/process.ts";
import { createRng } from "../src/rng.ts";
import { runOfDoc, set } from "./breakout/support.ts";
import { docOfM, fx12m } from "./breakout/support_m.ts";
import { NO_DEATH, SMALL, configOf, runOf } from "./support/scenarios.ts";

// Batch P7a (the class of the audit's F6; the author's decision of 2026-11-02, plant_ui.md section 11, row P7; spec section 2.1): a moment of the process between two integration steps,
// such as a break-out stop or a change of the multipliers derived from a draw instant, takes effect at its own instant, the one the log gives it, and not at the next step. The moment
// splits the step: the state is integrated to the moment, the moment applies, the rest of the step follows. The stored steps stay on the grid, and `stateAt` between two steps takes
// every moment of that interval into account. Expected values are hand arithmetic, with growth and the uptakes switched off so that one Euler step of the death alone is exact:
// with a death rate r per hour (both ends of A212 and A081 equal, so the limitation of growth does not enter) and a factor f on it, dt seconds take x to x (1 - f r dt / 3600).

const DAY = 86400;
const STEP = 60;
const R = 0.002; // per hour, both ends of the coupled death rate
const TWO: Record<string, number> = { reactor_count: 2, bay_size: 2, cohort_size: 2, inoculation_start_min: 0, inoculation_step_min: 0, horizon_days: 12, production_days: 10 };
const OFF = { glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0, lactate_production_pmol_per_cell_d: 0, productivity_pg_per_cell_d: 0 };
const DEATH_ONLY = { ...TWO, ...OFF, mu_max_per_h: 0, early_death_per_h: R, late_death_per_h: R };
/** The step at 2 d (U01 and U02 are inoculated at 0 s) and the moment 30 s after it, half way to the next step at 2 d + 60 s. */
const K = (2 * DAY) / STEP;
const T = 2 * DAY + 30;

const proc = (moments: ScriptedEvent[]): ProcessRun => {
  const cfg = configOf("default", { settings: DEATH_ONLY }).process;
  return runProcess({ ...cfg, scripted: [...cfg.scripted, ...moments] }, 1, createRng());
};
/** One Euler step of the death alone, by hand. */
const die = (x: number, f: number, dt: number): number => x * (1 - (f * R * dt) / 3600);

describe("P7a: a change of the multipliers between two steps applies at its own instant", () => {
  const run = proc([{ type: "multiplier", unit_id: "U01", at_s: T, kd: 3 }]);
  const r = run.byUnit.get("U01");
  const xk = r?.x[K] as number; // the stored step at 2 d, before the moment: the baseline's, the moment has not happened

  it("Given a death factor of 3 at 2 d + 30 s When the state is read at the moment's instant Then the first 30 s of the step ran at the old rate: x_k (1 - 0.002 x 30 / 3600)", () => {
    expect(stateAt(run, "U01", T).vcd).toBeCloseTo(die(xk, 1, 30), 12);
  });

  it("Given the same When the state is read 15 s after the moment, before the next step Then the 15 s ran at three times the rate: x_k (1 - 0.002 x 30 / 3600) (1 - 0.006 x 15 / 3600)", () => {
    expect(stateAt(run, "U01", T + 15).vcd).toBeCloseTo(die(die(xk, 1, 30), 3, 15), 12);
  });

  it("Given the same When the next step, 2 d + 60 s, is read Then it holds 30 s at the old rate and 30 s at the new one, stored and through stateAt alike", () => {
    const expected = die(die(xk, 1, 30), 3, 30);
    expect(r?.x[K + 1] as number).toBeCloseTo(expected, 12);
    expect(stateAt(run, "U01", 2 * DAY + STEP).vcd).toBeCloseTo(expected, 12);
  });

  it("Given the same When the other unit is read Then it has no moment: its next step is the old rate for the whole step", () => {
    expect(stateAt(run, "U02", 2 * DAY + STEP).vcd).toBeCloseTo(die(run.byUnit.get("U02")?.x[K] as number, 1, 60), 12);
  });
});

describe("P7a: a stop between two steps ends the unit at its own instant", () => {
  const run = proc([{ type: "stop", unit_id: "U01", at_s: T }]);
  const r = run.byUnit.get("U01");
  const xk = r?.x[K] as number;

  it("Given a stop at 2 d + 30 s When the state is read at the stop Then the unit died for 30 s: x_k (1 - 0.002 x 30 / 3600)", () => {
    expect(r?.harvested_s).toBe(T);
    expect(stateAt(run, "U01", T).vcd).toBeCloseTo(die(xk, 1, 30), 12);
  });

  it("Given the same When the state is read at the next step and a day later Then it is the state at the stop: nothing is integrated past it", () => {
    const atStop = stateAt(run, "U01", T);
    expect(stateAt(run, "U01", 2 * DAY + STEP)).toEqual(atStop);
    expect(stateAt(run, "U01", 3 * DAY)).toEqual(atStop);
  });

  it("Given the same When the stored steps are counted Then they stay on the grid and end at the step before the stop, 2 d", () => {
    expect(r?.n).toBe(K + 1);
  });
});

describe("P7a: a feed a scenario file places between two steps applies at its own instant", () => {
  // The Time contract keeps a fractional minute of a scenario file as a whole second (A200): a feed at 1981.5 min is at 118,890 s, 30 s after U01's step at 118,860 s (U01 is inoculated
  // at 480 min, 28,800 s). Growth, death and the uptakes off, so the glucose moves only by the dilution of the feed: (8 + 0.024 x 500) / 1.024 = 19.53125 g/L (A190, A192, A193).
  const STILL = { ...SMALL, mu_max_per_h: 0, ...NO_DEATH, glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0 };
  const AT = 1981.5 * 60;
  const run = runOf("default", { settings: STILL, fields: { scripted_events: [{ type: "feed", unit_id: "U01", at: { value: 1981.5, unit: "min", ref: "A228" } }] } });

  it("Given a feed at 1981.5 min When the state is read at the feed's instant and 15 s later Then both have it: 19.53125 g/L", () => {
    expect(run.events.some((e) => e.type === "process_event" && e.kind === "feed" && e.t === AT)).toBe(true);
    expect(stateAt(run.process, "U01", AT).glucose).toBeCloseTo(19.53125, 10);
    expect(stateAt(run.process, "U01", AT + 15).glucose).toBeCloseTo(19.53125, 10);
  });

  it("Given the same When the state is read 1 s before the feed Then it does not have it: 8 g/L", () => {
    expect(stateAt(run.process, "U01", AT - 1).glucose).toBeCloseTo(8, 10);
  });
});

// Written after the fix (green at once, as guards): the rule leaves a run whose moments sit on steps as it was, a factor of 1 still changes no byte (rule S13), and the break-out script's moment
// derived from a draw instant reaches the integrator at that instant.

describe("P7a: a run whose moments all sit on steps is unchanged", () => {
  it("Given the default scenario with a feed on a whole minute (1981 min) When the run is read Then no unit has a split and the stored step at the feed's instant holds the feed: 19.53125 g/L", () => {
    const STILL = { ...SMALL, mu_max_per_h: 0, ...NO_DEATH, glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0 };
    const run = runOf("default", { settings: STILL, fields: { scripted_events: [{ type: "feed", unit_id: "U01", at: { value: 1981, unit: "min", ref: "A228" } }] } });
    expect(run.process.reactors.map((r) => r.splits)).toEqual(run.process.reactors.map(() => []));
    const r = run.process.byUnit.get("U01");
    expect(r?.g[(1981 * 60 - (r?.inoculated_s as number)) / STEP] as number).toBeCloseTo(19.53125, 10);
  });
});

describe("P7a: a factor of 1 between two steps changes no byte (rule S13)", () => {
  it("Given factors of 1 at 2 d + 30 s on U01 When the run is compared with the run without the moment Then every stored step, the log and the true state at any instant are equal, and the step is not split", () => {
    const cfg = configOf("default", { settings: TWO }).process;
    const base = runProcess(cfg, 1, createRng());
    const ones = runProcess({ ...cfg, scripted: [...cfg.scripted, { type: "multiplier", unit_id: "U01", at_s: T, mu: 1, kd: 1 }] }, 1, createRng());
    const a = ones.byUnit.get("U01");
    const b = base.byUnit.get("U01");
    for (const key of ["x", "d", "g", "q", "l", "p"] as const) expect(Array.from(a?.[key] ?? [])).toEqual(Array.from(b?.[key] ?? []));
    expect(ones.events).toEqual(base.events);
    for (const t of [T, T + 15, 2 * DAY + STEP, 5 * DAY + 7]) expect(stateAt(ones, "U01", t)).toEqual(stateAt(base, "U01", t));
    expect([a?.factors.length, a?.splits]).toEqual([1, []]);
  });
});

describe("P7a: a break-out moment derived from a draw instant applies at that instant", () => {
  // FX12m with a sampling origin, U01-D02-1: the onset is the instant of that draw, which the seed decides, and the plateau is at the onset plus N2 = 2 d. The default seed draws U01-D02-1
  // at 218,928 s, so the plateau is at 391,728 s, 48 s after U01's step at 391,680 s (U01 is inoculated at 0 s); the fall, 3 d after the onset, comes after the stop and is never applied.
  // A horizon of 34 d holds the culture result 28 d after the latest stop the loader plans (the end of day 2, plus the lag of 48 h and d1 of 2 h: 122 h).
  it("Given that script When U01 is read Then its factors change at the plateau's own instant, between two steps, and the step is split there", () => {
    const run = runOfDoc(docOfM(set(fx12m({ plateau: 2, growth: 0.5 }), "origin", { kind: "sampling", sample_id: "U01-D02-1" }), { horizon_days: 34 }));
    const plateau = (run.breakout?.units[0]?.onset_s as number) + 2 * DAY;
    const r = run.process.byUnit.get("U01");
    expect([plateau, (plateau - (r?.inoculated_s as number)) % STEP]).toEqual([391728, 48]);
    expect(r?.factors).toEqual([{ t: plateau, mu: 0.5, kd: 1 }]);
    expect(r?.splits.map((x) => x.t)).toEqual([plateau]);
  });
});

import { describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import { runProcess, stateAt } from "../src/process.ts";
import type { ProcessRun } from "../src/process.ts";
import { createRng } from "../src/rng.ts";
import { sensorTickEvents } from "../src/sensors.ts";
import { configOf } from "./support/scenarios.ts";
import type { Json } from "./support/schemas.ts";

// L1 process (spec 2.1). Expected values are hand arithmetic from the ledger values quoted in each test, never engine output.
// Unit conversions used by hand: mM/d = pmol/cell/d x 1e6 cells/mL (so 2.5 x 1.0 = 2.5 mM/d); g/L = mM x molar mass / 1000.

const DAY = 86400;
const OFF = {
  mu_max_per_h: 0,
  death_per_h: 0,
  glucose_uptake_pmol_per_cell_d: 0,
  glutamine_uptake_pmol_per_cell_d: 0,
  lactate_production_pmol_per_cell_d: 0,
  productivity_pg_per_cell_d: 0,
};

const proc = (settings: Record<string, number> = {}, seed = 1, fields?: Json): ProcessRun => {
  const cfg = configOf("default", { settings, fields });
  return runProcess(cfg.process, seed, createRng());
};
const reactor = (run: ProcessRun, unit: string) => run.reactors.find((r) => r.unit_id === unit) as ProcessRun["reactors"][number];
type ProcessEv = Extract<Event, { type: "process_event" }>;
const processEvents = (run: ProcessRun, unit: string, kind: string): ProcessEv[] =>
  run.events.filter((e): e is ProcessEv => e.type === "process_event" && e.unit_id === unit && e.kind === kind);

describe("L1: staggered inoculation in cohorts (A188)", () => {
  const run = proc();
  it("Given the default scenario When the batches start Then 24 reactors U01..U24 are inoculated, six per cohort, one cohort per day, one reactor every 15 min from 08:00", () => {
    expect(run.reactors.map((r) => r.unit_id).slice(0, 2)).toEqual(["U01", "U02"]);
    expect(run.reactors).toHaveLength(24);
    const at = run.reactors.map((r) => r.inoculated_s);
    expect(at[0]).toBe(8 * 3600); // first of cohort 0: 08:00 day 0
    expect(at[5]).toBe(9 * 3600 + 15 * 60); // sixth of cohort 0: 09:15 (the note of A188)
    expect(at[6]).toBe(DAY + 8 * 3600); // cohort 1 starts on day 1 at 08:00
    expect(at[23]).toBe(3 * DAY + 9 * 3600 + 15 * 60); // last reactor: cohort 3, sixth: day 3 09:15
  });

  it("Then reactors 1..12 sit in bay 1 and 13..24 in bay 2, and each inoculation is one event with the inoculation density of A007", () => {
    expect(run.reactors.map((r) => r.bay)).toEqual([...Array(12).fill(1), ...Array(12).fill(2)]);
    const ev = run.events.filter((e) => e.type === "inoculation");
    expect(ev).toHaveLength(24);
    expect(ev[0]).toMatchObject({ t: 28800, unit_id: "U01", density_e6_per_ml: 1 });
  });
});

describe("L1: kinetics, checked against closed forms", () => {
  it("Given all rates are zero When three days pass Then the state stays at the initial values (A190, A191, A207..A211)", () => {
    const run = proc(OFF);
    const s = stateAt(run, "U01", 8 * 3600 + 3 * DAY);
    expect(s).toMatchObject({ vcd: 1, glucose: 8, glutamine: 4, lactate: 0, titer: 0, ph: 7 });
    expect(s.viability).toBeCloseTo(97, 10);
  });

  it("Given no growth and no death When one day passes Then uptake and production are linear: glucose 8 - 2.5 x 1.0 x 180.16/1000 = 7.5496 g/L, glutamine 4 - 1.2 = 2.8 mM, lactate 2.3 x 90.08/1000 = 0.207184 g/L, titer 35 x 1e-3 = 0.035 g/L", () => {
    const run = proc({ mu_max_per_h: 0, death_per_h: 0 });
    const s = stateAt(run, "U01", 8 * 3600 + DAY);
    expect(s.glucose).toBeCloseTo(8 - 0.4504, 9);
    expect(s.glutamine).toBeCloseTo(2.8, 9);
    expect(s.lactate).toBeCloseTo(0.207184, 9);
    expect(s.titer).toBeCloseTo(0.035, 9);
    expect(s.vcd).toBeCloseTo(1, 12);
  });

  it("Given death only When 24 h pass Then viable cells follow exp(-0.0042 x 24) and the dead cells make up the rest of the initial 3 percent plus the lost cells", () => {
    const run = proc({ mu_max_per_h: 0, glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0, lactate_production_pmol_per_cell_d: 0, productivity_pg_per_cell_d: 0 });
    const s = stateAt(run, "U01", 8 * 3600 + DAY);
    const x = Math.exp(-0.0042 * 24);
    expect(s.vcd / x).toBeCloseTo(1, 4);
    const dead = 1 * (0.03 / 0.97) + (1 - x); // initial dead cells (3 percent of the total, viability 97) plus the cells that died
    expect(s.viability).toBeCloseTo((100 * x) / (x + dead), 3);
  });

  it("Given glucose far above the Monod constant and no uptake When 24 h pass Then growth is the net rate (0.027 - 0.0042) per hour: exp(0.5472)", () => {
    const run = proc({ glucose_ks_g_per_l: 1e-9, glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0, lactate_production_pmol_per_cell_d: 0, productivity_pg_per_cell_d: 0 });
    const s = stateAt(run, "U01", 8 * 3600 + DAY);
    expect(s.vcd / Math.exp(0.5472)).toBeCloseTo(1, 3);
  });

  it("Given growth is limited by glucose only When glucose is half the Monod constant Then the growth rate is a third of the maximum (G / (Ks + G) with G = Ks/2)", () => {
    const run = proc({ initial_glucose_g_per_l: 0.465, glucose_uptake_pmol_per_cell_d: 0, death_per_h: 0, glutamine_uptake_pmol_per_cell_d: 0, lactate_production_pmol_per_cell_d: 0, productivity_pg_per_cell_d: 0, glucose_floor_g_per_l: 0.1 });
    const s = stateAt(run, "U01", 8 * 3600 + DAY);
    expect(Math.log(s.vcd)).toBeCloseTo((0.027 / 3) * 24, 3);
  });
});

describe("L1: scheduled events", () => {
  it("Given glucose is below the floor at the 10:00 decision When the rule runs Then one bolus is fed: glucose (0.5 + 0.024 x 500) / 1.024 = 12.20703125, cells diluted to 1/1.024, amount 0.024 x 2 L", () => {
    const run = proc({ ...OFF, initial_glucose_g_per_l: 0.5 });
    const feeds = processEvents(run, "U01", "feed");
    expect(feeds).toHaveLength(1); // glucose is 12.2 afterwards and nothing consumes it
    expect(feeds[0]).toMatchObject({ t: 10 * 3600, source: "rule", amount_unit: "L" });
    expect(feeds[0]?.amount).toBeCloseTo(0.048, 12);
    const s = stateAt(run, "U01", 10 * 3600);
    expect(s.glucose).toBeCloseTo(12.5 / 1.024, 9);
    expect(s.glutamine).toBeCloseTo(8.8 / 1.024, 9);
    expect(s.vcd).toBeCloseTo(1 / 1.024, 12);
  });

  it("Given glucose stays above the floor When the batch runs Then the rule never feeds (8 - 14 x 0.4504 = 1.69 g/L at harvest)", () => {
    const run = proc({ mu_max_per_h: 0, death_per_h: 0 });
    expect(processEvents(run, "U01", "feed")).toHaveLength(0);
  });

  it("Given the shift at 10:00 on culture day 4 (A195) When 24 h before and after are compared Then growth halves (A196): ln ratio after = 0.5 x ln ratio before", () => {
    const run = proc({ ...OFF, mu_max_per_h: 0.027, glucose_ks_g_per_l: 1e-9 });
    const shift = 4 * DAY + 10 * 3600; // U01 is inoculated on day 0
    const ev = processEvents(run, "U01", "temperature_shift");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ t: shift, amount: 33, amount_unit: "C", source: "scheduled" });
    const before = Math.log(stateAt(run, "U01", shift).vcd / stateAt(run, "U01", shift - DAY).vcd);
    const after = Math.log(stateAt(run, "U01", shift + DAY).vcd / stateAt(run, "U01", shift).vcd);
    expect(after / before).toBeCloseTo(0.5, 3);
  });

  it("Given no death When 14 days pass Then the batch is harvested on the scheduled day (A004) and the trajectory ends there", () => {
    const run = proc({ death_per_h: 0 });
    expect(reactor(run, "U01").harvested_s).toBe(8 * 3600 + 14 * DAY);
    expect(processEvents(run, "U01", "harvest")[0]).toMatchObject({ t: 8 * 3600 + 14 * DAY, source: "scheduled" });
  });

  it("Given viability starts below 80 percent (A013) When the first 10:00 decision after inoculation comes Then the batch is harvested by the rule", () => {
    const run = proc({ initial_viability_pct: 79 });
    expect(reactor(run, "U01").harvested_s).toBe(10 * 3600);
    expect(reactor(run, "U07").harvested_s).toBe(DAY + 10 * 3600); // cohort 1
    expect(processEvents(run, "U01", "harvest")[0]).toMatchObject({ source: "rule" });
  });

  it("Given a scenario adds a scripted feed and an alarm When the batch runs Then both appear at their minutes with source scripted", () => {
    const at = (value: number, ref: string) => ({ value, unit: "min", ref });
    const run = proc({}, 1, {
      scripted_events: [
        { type: "feed", unit_id: "U03", at: at(2 * 1440 + 540, "A102") },
        { type: "alarm", unit_id: "U03", at: at(2 * 1440 + 1000, "A197") },
      ],
    });
    expect(processEvents(run, "U03", "feed").filter((e) => e.source === "scripted")).toMatchObject([{ t: (2 * 1440 + 540) * 60 }]);
    expect(processEvents(run, "U03", "alarm")).toMatchObject([{ t: (2 * 1440 + 1000) * 60, source: "scripted" }]);
  });

  it("Given no scenario adds an alarm Then no alarm event exists (A197)", () => {
    expect(proc().events.filter((e) => e.type === "process_event" && e.kind === "alarm")).toHaveLength(0);
  });
});

describe("L1: online sensors (A198, A199, A100)", () => {
  const run = proc({ death_per_h: 0 });
  const series = (unit: string, signal: string) => run.sensors.find((s) => s.unit_id === unit && s.signal === signal) as ProcessRun["sensors"][number];

  it("Given a 14 d batch When the 60 s cadence runs Then each signal has a tick at inoculation and one every 60 s up to harvest: 14 x 1440 + 1 values", () => {
    for (const signal of ["pH", "DO", "temperature"]) {
      const s = series("U01", signal);
      expect(s.n).toBe(14 * 1440 + 1);
      expect(s.t0_s).toBe(28800);
      expect(s.cadence_s).toBe(60);
    }
  });

  it("Then the truth is the set point (pH 7.00, DO 30) and the temperature follows the shifted set point with the 20 min lag: 33 + 4 x exp(-m/20) m minutes after the shift", () => {
    const ph = series("U01", "pH");
    const ox = series("U01", "DO");
    expect([ph.truth[0], ph.truth[5000], ox.truth[777]]).toEqual([7, 7, 30]);
    const T = series("U01", "temperature");
    const first = (4 * DAY + 10 * 3600 - 28800) / 60; // tick of the shift
    expect(T.truth[0]).toBe(37);
    expect(T.truth[first]).toBe(37);
    expect(T.truth[first + 100]).toBeCloseTo(33 + 4 * Math.exp(-5), 9);
    expect(T.truth[first + 1]).toBeCloseTo(33 + 4 * Math.exp(-1 / 20), 9);
  });

  it("Then the process value is the truth plus independent normal noise with the sd of A199 (pH 0.005)", () => {
    const s = series("U01", "pH");
    const d = Array.from({ length: s.n }, (_, i) => (s.pv[i] as number) - (s.truth[i] as number));
    const m = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length - 1));
    expect(Math.abs(m)).toBeLessThan(5e-4);
    expect(sd / 0.005).toBeCloseTo(1, 1);
  });

  it("Then ticks serialise to sensor_tick events with the process value visible and the truth hidden", () => {
    const s = series("U01", "temperature");
    const ev = sensorTickEvents(s);
    expect(ev).toHaveLength(s.n);
    expect(ev[0]).toEqual({ type: "sensor_tick", t: 28800, unit_id: "U01", signal: "temperature", value: s.pv[0], true_value: s.truth[0] });
  });
});

describe("L1: the truth run does not depend on the seed except through sensor noise (no feedback, no per-reactor draw)", () => {
  it("Given two seeds Then the trajectories and events are identical and only the sensor noise differs", () => {
    const a = proc({}, 1);
    const b = proc({}, 2);
    expect(a.events).toEqual(b.events);
    expect(a.reactors[3]?.x).toEqual(b.reactors[3]?.x);
    expect(a.sensors[0]?.pv).not.toEqual(b.sensors[0]?.pv);
    expect(a.sensors[0]?.truth).toEqual(b.sensors[0]?.truth);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { runProcess, stateAt } from "../../src/process.ts";
import type { ProcessConfig, ProcessRun, ScriptedEvent } from "../../src/process.ts";
import { createRng } from "../../src/rng.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { canonicalJsonl } from "../../src/trace.ts";
import { runScenario } from "../../src/run.ts";
import { NO_DEATH, configOf as scenarioConfig } from "../support/scenarios.ts";
import { isValid, makeAjv } from "../support/schemas.ts";
import type { Json } from "../support/schemas.ts";
import { H, docOf, h, runOfDoc, set } from "./support.ts";
import { docOfM, fx12m, loadedWith } from "./support_m.ts";

// Spec 11.8.2 rule S13 and 11.8.5 row 5: the generic scripted multiplier moment of process.ts. At an instant the growth multiplier and the death multiplier of one unit are set to scenario values, on
// top of the temperature shift (A195, A196), which keeps its own. A factor of 1 changes no byte of the log; a growth factor of 0 stops the growth of the unit from that instant. The process-level tests
// give the moment directly (the mechanism is generic: the scenario file cannot name it, the break-out script does); the break-out tests read it through the mycoplasma profile (N2 to N5).
// Expected values are hand arithmetic from the shift test of process.test.ts: with the Monod limit off, a ceiling far above the density, and no death, ln x grows at mu_max x multiplier per hour.

const DAY = 86400;
const HOUR = 3600;
const TWO: Record<string, number> = { reactor_count: 2, bay_size: 2, cohort_size: 2, inoculation_start_min: 0, inoculation_step_min: 0, horizon_days: 12, production_days: 10 };
const OFF = { glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0, lactate_production_pmol_per_cell_d: 0, productivity_pg_per_cell_d: 0, glucose_ks_g_per_l: 1e-9, carrying_capacity_e6_per_ml: 1e12 };
const GROWTH_ONLY = { ...TWO, ...OFF, ...NO_DEATH, mu_max_per_h: 0.027 };
const DEATH_ONLY = { ...TWO, ...OFF, mu_max_per_h: 0, early_death_per_h: 0.002, late_death_per_h: 0.002 };

const moment = (unit_id: string, at_s: number, factors: { mu?: number; kd?: number }): ScriptedEvent => ({ type: "multiplier", unit_id, at_s, ...factors });
const proc = (settings: Record<string, number>, moments: ScriptedEvent[] = [], fields?: Json): { run: ProcessRun; cfg: ProcessConfig } => {
  const cfg = scenarioConfig("default", { settings, fields }).process;
  const withMoments = { ...cfg, scripted: [...cfg.scripted, ...moments] };
  return { run: runProcess(withMoments, 1, createRng()), cfg: withMoments };
};
const bytes = (a: Float64Array): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("hex");
const arraysOf = (run: ProcessRun, unit: string): string[] => {
  const r = run.byUnit.get(unit);
  if (!r) throw new Error(`no ${unit}`);
  return [r.x, r.d, r.g, r.q, r.l, r.p].map((a) => bytes(a.subarray(0, r.n)));
};
/** ln of the viable density over [t, t + 24 h] of a unit, from stateAt (a stored step advanced by the remaining seconds with the multipliers of that step). */
const growth = (run: ProcessRun, unit: string, t: number): number => Math.log(stateAt(run, unit, t + DAY).vcd / stateAt(run, unit, t).vcd);

describe("The multiplier moment of process.ts, composed with the temperature shift", () => {
  it("Given a growth factor of 0.5 at 48 h and the shift at 4 d 10 h (A195, growth x 0.5, A196) When 24 h windows are compared Then growth is 1 before, 0.5 after the moment, 0.25 after both", () => {
    const { run } = proc(GROWTH_ONLY, [moment("U01", 2 * DAY, { mu: 0.5 })]);
    const before = growth(run, "U01", DAY); // [24 h, 48 h]: the base rate
    const afterMoment = growth(run, "U01", 2 * DAY); // [48 h, 72 h]: 0.5
    const afterBoth = growth(run, "U01", 4 * DAY + 11 * HOUR); // [107 h, 131 h]: the shift 0.5 times the factor 0.5
    expect(afterMoment / before).toBeCloseTo(0.5, 3);
    expect(afterBoth / before).toBeCloseTo(0.25, 3);
  });

  it("Given a growth factor of 0.5 at 6 d, after the shift When 24 h windows are compared Then the factor multiplies the shift: 0.5 before the moment (shift only), 0.25 after", () => {
    const { run } = proc(GROWTH_ONLY, [moment("U01", 6 * DAY, { mu: 0.5 })]);
    const base = growth(run, "U01", DAY);
    expect(growth(run, "U01", 5 * DAY) / base).toBeCloseTo(0.5, 3);
    expect(growth(run, "U01", 6 * DAY + HOUR) / base).toBeCloseTo(0.25, 3);
  });

  it("Given a death factor of 3 at 48 h and no growth When 24 h windows are compared Then the decay of the viable density is 3 times as fast after the moment (death rate 0.002 per hour in both ends)", () => {
    const { run } = proc(DEATH_ONLY, [moment("U01", 2 * DAY, { kd: 3 })]);
    expect(growth(run, "U01", 2 * DAY) / growth(run, "U01", DAY)).toBeCloseTo(3, 3);
    // the other unit has no moment
    expect(growth(run, "U02", 2 * DAY) / growth(run, "U02", DAY)).toBeCloseTo(1, 6);
  });

  it("Given a factor not named in a moment (only kd) When a later moment names the other (only mu) Then each keeps what the earlier one set: the factors accumulate by name, they do not reset", () => {
    const { run } = proc(GROWTH_ONLY, [moment("U01", 2 * DAY, { kd: 2 }), moment("U01", 3 * DAY, { mu: 0.5 })]);
    expect(run.byUnit.get("U01")?.factors).toEqual([{ t: 2 * DAY, mu: 1, kd: 2 }, { t: 3 * DAY, mu: 0.5, kd: 2 }]);
  });
});

describe("A factor of 1 leaves the log byte-identical (rule S13)", () => {
  it("Given factors of 1 before and after the temperature shift When the run is compared with the run without the moments Then every array of every unit, the truth log and the true state at any instant are equal byte for byte", () => {
    const base = proc(TWO);
    const ones = proc(TWO, [moment("U01", 2 * DAY, { mu: 1, kd: 1 }), moment("U01", 5 * DAY, { mu: 1, kd: 1 }), moment("U02", 5 * DAY + 3 * HOUR, { mu: 1 })]);
    for (const unit of ["U01", "U02"]) expect(arraysOf(ones.run, unit)).toEqual(arraysOf(base.run, unit));
    expect(canonicalJsonl(ones.run.events)).toBe(canonicalJsonl(base.run.events));
    for (const t of [DAY + 17, 2 * DAY + 1, 4 * DAY + 10 * HOUR + 30, 5 * DAY + 61, 7 * DAY + 12345]) {
      expect(stateAt(ones.run, "U01", t)).toEqual(stateAt(base.run, "U01", t));
      expect(stateAt(ones.run, "U02", t)).toEqual(stateAt(base.run, "U02", t));
    }
    expect(ones.run.byUnit.get("U01")?.factors.length).toBe(2);
  });

  it("Given no moment When the run is read Then no unit has a factor step (the field is empty, the multipliers are those of the base and the shift)", () => {
    const { run } = proc(TWO);
    expect(run.reactors.map((r) => r.factors)).toEqual([[], []]);
  });

  it("Given a moment after the unit ended (a stop first, or past the harvest) When the run is read Then it is not applied and the log is the run without it", () => {
    const base = proc(TWO);
    const late = proc(TWO, [moment("U01", 30 * DAY, { mu: 0, kd: 9 })]);
    expect(arraysOf(late.run, "U01")).toEqual(arraysOf(base.run, "U01"));
    expect(late.run.byUnit.get("U01")?.factors).toEqual([]);
  });
});

describe("A growth factor of 0 stops the growth of the unit from the instant (structural, not a value)", () => {
  const T = 2 * DAY;
  let base: ProcessRun;
  let stopped: ProcessRun;
  beforeAll(() => {
    base = proc(TWO).run;
    stopped = proc(TWO, [moment("U01", T, { mu: 0 })]).run;
  });
  const steps = (run: ProcessRun, unit: string) => {
    const r = run.byUnit.get(unit);
    if (!r) throw new Error(`no ${unit}`);
    return { r, ks: Array.from({ length: r.n }, (_, k) => k).filter((k) => r.inoculated_s + k * r.step_s > T) };
  };

  it("Given the baseline When the viable density after the instant is read Then it does grow somewhere (the test has teeth)", () => {
    const { r, ks } = steps(base, "U01");
    expect(ks.some((k) => (r.x[k] as number) > (r.x[k - 1] as number))).toBe(true);
  });

  it("Given a growth factor of 0 at 48 h When every stored step after 48 h is read Then the viable density never rises (the step that ends at 48 h still grew, the first step after it does not; the density falls with the death and the dilution of the feeds)", () => {
    const { r, ks } = steps(stopped, "U01");
    for (const k of ks) expect(r.x[k] as number, `step ${k}`).toBeLessThanOrEqual(r.x[k - 1] as number);
    expect((r.x[r.n - 1] as number) < (r.x[ks[0] as number] as number)).toBe(true);
  });

  it("Given the same When the steps before 48 h and the other unit are read Then they equal the baseline byte for byte", () => {
    const a = stopped.byUnit.get("U01");
    const b = base.byUnit.get("U01");
    const before = ((T - (a?.inoculated_s as number)) / (a?.step_s as number)) | 0;
    expect(bytes((a?.x as Float64Array).subarray(0, before))).toBe(bytes((b?.x as Float64Array).subarray(0, before)));
    expect(arraysOf(stopped, "U02")).toEqual(arraysOf(base, "U02"));
  });

  it("Given no growth and no death and a factor of 0 on both When the true state is read between stored steps Then the density is constant from the instant on: stateAt uses the factor of its step", () => {
    const { run } = proc(GROWTH_ONLY, [moment("U01", T, { mu: 0, kd: 0 })]);
    const fixed = stateAt(run, "U01", T).vcd;
    for (const t of [T + 1, T + 59, T + HOUR + 17, 5 * DAY + 31, 9 * DAY]) expect(stateAt(run, "U01", t).vcd, `t = ${t}`).toBe(fixed);
    const free = proc(GROWTH_ONLY).run;
    expect(stateAt(free, "U01", 9 * DAY).vcd).toBeGreaterThan(fixed * 2);
  });
});

describe("The mycoplasma profile sets the moments (N2 to N5), at the onset of each affected unit plus its delay", () => {
  // lag 96 h, onset 5 h: plateau at 5 + 48 = 53 h (N2 = 2 d), viability fall at 5 + 72 = 77 h (N4 = 3 d), signal at 101 h, stop at 103 h; the culture result 28 d after 103 h needs a 33 d horizon
  const SLOW = (o: Parameters<typeof fx12m>[0] = {}): Json => set(fx12m(o), "lag", h(96, "A138"));
  const settings = { horizon_days: 33 };
  const baseline = (o: Parameters<typeof fx12m>[0]): ScenarioRun => runScenario(loadedWith(docOfM(SLOW(o), settings), (p) => void delete p.host_effects));
  const real = (o: Parameters<typeof fx12m>[0]): ScenarioRun => runOfDoc(docOfM(SLOW(o), settings));

  it("Given N2 = 2 d, N3 = 0.5, N4 = 3 d, N5 = 2 and an onset at 5 h When the run is read Then U01 has its two steps at 53 h and 77 h (the factors accumulate), U02 and U03 have none", () => {
    const run = real({ plateau: 2, growth: 0.5, fall: 3, death: 2 });
    expect(run.process.byUnit.get("U01")?.factors).toEqual([{ t: H(53), mu: 0.5, kd: 1 }, { t: H(77), mu: 0.5, kd: 2 }]);
    expect(run.process.byUnit.get("U02")?.factors).toEqual([]);
    expect(run.process.byUnit.get("U03")?.factors).toEqual([]);
  });

  it("Given the script of FX12m (lag 48 h, stop at 55 h) When the fall is 72 h after the onset Then it comes after the stop and is never applied; the plateau at 53 h is", () => {
    const run = runOfDoc(docOfM(fx12m({ plateau: 2, growth: 0.5, fall: 3, death: 2 })));
    expect(run.process.byUnit.get("U01")?.factors).toEqual([{ t: H(53), mu: 0.5, kd: 1 }]);
  });

  it("Given factors of 1 for both When the run is compared with the same scenario and a profile without the host effects Then the truth log, the series and every array of every unit are byte-identical", () => {
    const withOnes = real({ growth: 1, death: 1 });
    const without = baseline({ growth: 1, death: 1 });
    expect(canonicalJsonl(withOnes.events)).toBe(canonicalJsonl(without.events));
    for (const unit of ["U01", "U02", "U03"]) {
      expect(arraysOf(withOnes.process, unit)).toEqual(arraysOf(without.process, unit));
      for (const signal of ["DO", "pH"]) {
        const a = withOnes.sensors.find((s) => s.unit_id === unit && s.signal === signal);
        const b = without.sensors.find((s) => s.unit_id === unit && s.signal === signal);
        expect([bytes(a?.truth as Float64Array), bytes(a?.pv as Float64Array)]).toEqual([bytes(b?.truth as Float64Array), bytes(b?.pv as Float64Array)]);
      }
    }
    expect(withOnes.process.byUnit.get("U01")?.factors.length).toBe(2);
  });

  it("Given a growth factor of 0.5 When the run is compared with the same scenario without the host effects Then the log differs (the byte-identity above is not vacuous)", () => {
    expect(canonicalJsonl(real({ growth: 0.5, death: 1 }).events)).not.toBe(canonicalJsonl(baseline({ growth: 0.5, death: 1 }).events));
  });

  it("Given a growth factor of 0 from the plateau at 53 h When U01 is read Then its viable density never rises from 53 h to the stop, the baseline does, and the steps before 53 h are the baseline's", () => {
    const run = real({ plateau: 2, growth: 0, death: 1 });
    const free = baseline({ growth: 0, death: 1 });
    const r = run.process.byUnit.get("U01");
    const f = free.process.byUnit.get("U01");
    if (!r || !f) throw new Error("no U01");
    const ks = Array.from({ length: r.n }, (_, k) => k).filter((k) => k * r.step_s > H(53));
    expect(ks.length).toBeGreaterThan(100);
    for (const k of ks) expect(r.x[k] as number, `step ${k}`).toBeLessThanOrEqual(r.x[k - 1] as number);
    expect(ks.some((k) => (f.x[k] as number) > (f.x[k - 1] as number))).toBe(true);
    const before = H(53) / r.step_s;
    expect(bytes(r.x.subarray(0, before))).toBe(bytes(f.x.subarray(0, before)));
    expect(arraysOf(run.process, "U02")).toEqual(arraysOf(free.process, "U02"));
  });

  it("Given a death factor of 3 from the fall at 77 h When the viability of U01 is read Then it equals the baseline's before 77 h and is lower at the stop, 103 h", () => {
    const run = real({ growth: 1, fall: 3, death: 3 });
    const free = baseline({ growth: 1, death: 3 });
    expect(stateAt(run.process, "U01", H(77)).viability).toBe(stateAt(free.process, "U01", H(77)).viability);
    expect(stateAt(run.process, "U01", H(103)).viability).toBeLessThan(stateAt(free.process, "U01", H(103)).viability);
  });
});

describe("The scenario file cannot name the moment", () => {
  it("Given a scripted_events entry of type multiplier or stop When the scenario is validated Then it is invalid: the schema lists feed and alarm, and the break-out script adds the others", () => {
    const ajv = makeAjv();
    const at = { value: 60, unit: "min", ref: "A192" };
    expect(isValid(ajv, "scenario", docOf(undefined, {}, { scripted_events: [{ type: "feed", unit_id: "U01", at }] }))).toBe(true);
    for (const type of ["multiplier", "stop"]) expect(isValid(ajv, "scenario", docOf(undefined, {}, { scripted_events: [{ type, unit_id: "U01", at }] })), type).toBe(false);
  });
});

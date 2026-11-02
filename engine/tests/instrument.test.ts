import { describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import type { Profile } from "../src/generated/profile.schema";
import { routeConfig } from "../src/measure.ts";
import { DAY, mean } from "./support/metrics.ts";
import { SMALL, lookup, runOf } from "./support/scenarios.ts";

// L3 additions (spec 2.3): instrument state series, measurement noise, run-level QC failure (A088), over-range and dilution (A089, A090).
// Expected values are the ledger numbers quoted in the titles and hand arithmetic.

const of = <T extends Event["type"]>(events: readonly Event[], type: T) => events.filter((e) => e.type === type) as Extract<Event, { type: T }>[];
const RELATIVE = new Set(["vcd", "glucose", "lactate", "glutamine"]);

describe("Instrument state: calibration, drift and lot (A091, A092, A093)", () => {
  const run = runOf("default");
  const cal = of(run.events, "calibration_recorded");

  it("Given the 2 h recalibration interval When 21 days run Then each analyzer records a calibration at t = 0, 2 h, 4 h ... 21 d (253), all in lot LOT-1", () => {
    for (const a of ["AN-1", "AN-2"]) {
      const mine = cal.filter((e) => e.analyzer === a);
      expect(mine.map((e) => e.t)).toEqual(Array.from({ length: 253 }, (_, k) => k * 7200));
      expect(new Set(mine.map((e) => e.lot_id))).toEqual(new Set(["LOT-1"]));
    }
  });

  it("Then the drift random walk starts at zero and resets at each calibration: the drift reached just before a calibration has sd 1.0 percent (A092)", () => {
    expect(cal.filter((e) => e.t === 0).every((e) => e.drift_before_pct === 0)).toBe(true);
    const d = cal.filter((e) => e.t > 0).map((e) => e.drift_before_pct);
    expect(d).toHaveLength(504);
    const m = mean(d);
    const sd = Math.sqrt(mean(d.map((x) => (x - m) ** 2)));
    expect(Math.abs(m)).toBeLessThan(0.2);
    expect(Math.abs(sd - 1)).toBeLessThan(0.12);
  });

  it("Given a lot change on AN-2 at day 6 and no drift or bias When readings are compared Then AN-2 reads +2.0 percent (A093) after the change and everything else reads the truth", () => {
    const at = { value: 6 * 1440, unit: "min", ref: "A093" };
    const r = runOf("default", { settings: { drift_pct: 0, bias_pct: 0 }, fields: { lot_changes: [{ analyzer: "AN-2", at }] } });
    const started = new Map(of(r.events, "run_started").map((e) => [`${e.request_id}#${e.attempt}#${e.visit}`, e.t]));
    let after = 0;
    let before = 0;
    for (const e of of(r.events, "result_measured").filter((x) => RELATIVE.has(x.analyte) && x.true_value > 0.1)) {
      const factor = (e.value - e.noise) / e.true_value;
      const late = e.analyzer === "AN-2" && (started.get(`${e.request_id}#${e.attempt}#${e.visit}`) as number) >= 6 * DAY;
      expect(factor, `${e.request_id} ${e.analyzer}`).toBeCloseTo(late ? 1.02 : 1, 9);
      if (late) after++;
      else before++;
    }
    expect(after).toBeGreaterThan(5);
    expect(before).toBeGreaterThan(500);
    const lots = of(r.events, "calibration_recorded").filter((e) => e.analyzer === "AN-2");
    expect(lots.filter((e) => e.t < 6 * DAY).every((e) => e.lot_id === "LOT-1")).toBe(true);
    expect(lots.filter((e) => e.t >= 6 * DAY).every((e) => e.lot_id === "LOT-2")).toBe(true);
  });

  it("Given an inter-instrument bias of 2 percent (A032) Then each analyzer has a constant bias within +-2 percent and the two differ; at 0 both are exactly 0", () => {
    const r = runOf("default", { settings: { ...SMALL, drift_pct: 0, bias_pct: 2 } });
    const f = ["AN-1", "AN-2"].map((a) => (r.instruments as { factorAt(a: string, t: number): { factor_pct: number } }).factorAt(a, 1000).factor_pct);
    expect(f.every((x) => Math.abs(x) <= 2)).toBe(true);
    expect(f[0]).not.toBe(f[1]);
    expect((r.instruments as { factorAt(a: string, t: number): { factor_pct: number } }).factorAt("AN-1", 90000).factor_pct).toBe(f[0]);
    const z = runOf("default", { settings: { ...SMALL, drift_pct: 0, bias_pct: 0 } });
    expect(["AN-1", "AN-2"].map((a) => (z.instruments as { factorAt(a: string, t: number): { factor_pct: number } }).factorAt(a, 1000).factor_pct)).toEqual([0, 0]);
  });
});

describe("Run-level QC failure (A088)", () => {
  it("Given the default probability of 0.02 When twenty seeds run Then about 2 percent of the in-range runs are qc_failed, and each is repeated as attempt + 1", () => {
    let failed = 0;
    let inRange = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = runOf("default", { seed });
      inRange += r.runs.filter((x) => x.outcome !== "over_range").length;
      failed += r.runs.filter((x) => x.outcome === "qc_failed").length;
      expect(of(r.events, "rerun_requested").filter((e) => e.reason === "qc_failed")).toHaveLength(r.runs.filter((x) => x.outcome === "qc_failed").length);
    }
    expect(inRange).toBeGreaterThan(4000);
    expect(failed / inRange).toBeGreaterThan(0.012);
    expect(failed / inRange).toBeLessThan(0.03);
  }, 35_000); // explicit timeout (S2d rework R1): twenty default-scenario runs take about 3.4 s; the default 5 s timed out under load

  it("Given the probability is 0 Then no run fails QC", () => {
    expect(runOf("default", { settings: { ...SMALL, rerun_probability: 0 } }).runs.some((r) => r.outcome === "qc_failed")).toBe(false);
  });
});

describe("Over-range and dilution (A089, A090)", () => {
  const constantLactate = (lactate: number) => {
    const r = runOf("default", { settings: { ...SMALL, initial_lactate_g_per_l: lactate, lactate_production_pmol_per_cell_d: 0, rerun_probability: 0 } });
    const by = new Map<string, typeof r.runs>();
    for (const x of r.runs) by.set(x.request_id, [...(by.get(x.request_id) ?? []), x]);
    return { r, by };
  };

  it("Given lactate 8 g/L against the 6 g/L limit at dilution 1 When a sample is run Then attempt 1 is over_range and attempt 2 at dilution 2 (limit 12) passes", () => {
    const { r, by } = constantLactate(8);
    expect(by.size).toBeGreaterThan(20);
    for (const [id, runs] of by) expect(runs.map((x) => x.outcome), id).toEqual(["over_range", "qc_passed"]);
    expect(of(r.events, "dilution_applied").every((e) => e.attempt === 2 && e.dilution_factor === 2)).toBe(true);
    expect(of(r.events, "rerun_requested").every((e) => e.reason === "over_range")).toBe(true);
  });

  it("Given lactate 20 g/L Then the ladder 1, 2, 4 is climbed: over at 6 and at 12, accepted at 4 (limit 24)", () => {
    const { r, by } = constantLactate(20);
    for (const [id, runs] of by) expect(runs.map((x) => x.outcome), id).toEqual(["over_range", "over_range", "qc_passed"]);
    expect(of(r.events, "dilution_applied").filter((e) => e.request_id === [...by.keys()][0]).map((e) => e.dilution_factor)).toEqual([2, 4]);
  });

  // Audit A1, finding F3 (2026-11-02): this test used to require the third attempt to pass. The author's decision: a reading still above the range after the last dilution of
  // the ladder ends in the terminal state "over range, unresolved" (spec section 2.3), with no number and never promoted to qc_passed. By hand: 30 > 6 x 1, 30 > 6 x 2 = 12 and
  // 30 > 6 x 4 = 24, and the ladder 1, 2, 4 has no fourth rung, so every request ends over_range, over_range, over_range_unresolved.
  it("Given lactate 30 g/L, above even the last rung (24) Then no higher dilution exists and the third attempt ends over_range_unresolved, never qc_passed", () => {
    const { by } = constantLactate(30);
    for (const [id, runs] of by) expect(runs.map((x) => x.outcome), id).toEqual(["over_range", "over_range", "over_range_unresolved"]);
  });

  // The same finding as the audit reproduced it: growth, death and the uptakes off, so the lactate stays 30 g/L whatever the culture day; the last run of every request is not
  // qc_passed (by the decision it is over_range_unresolved, as above).
  it("Given lactate 30 g/L with growth, death and uptake off When the samples are run Then the last run of every request is over_range_unresolved, never qc_passed", () => {
    const r = runOf("default", { settings: { ...SMALL, mu_max_per_h: 0, early_death_per_h: 0, late_death_per_h: 0, glucose_uptake_pmol_per_cell_d: 0, glutamine_uptake_pmol_per_cell_d: 0, initial_lactate_g_per_l: 30, lactate_production_pmol_per_cell_d: 0, lactate_switch_on: 0, rerun_probability: 0 } });
    const last = new Map(r.runs.map((x) => [x.request_id, x.outcome]));
    expect(last.size).toBeGreaterThan(20);
    for (const [id, outcome] of last) expect(outcome, id).toBe("over_range_unresolved");
  });

  it("Given every analyte in range Then no sample is diluted", () => {
    const r = runOf("default", { settings: { ...SMALL, lactate_production_pmol_per_cell_d: 0, rerun_probability: 0 } });
    expect(of(r.events, "dilution_applied")).toHaveLength(0);
    expect(r.runs.every((x) => x.outcome === "qc_passed")).toBe(true);
  });
});

describe("Measurement noise from keyed streams (A077, A078, A079)", () => {
  it("Given the same seed with and without a maintenance window (so run times differ) Then every glucose reading has the same noise draw (keyed by sample, analyte, attempt, not by time or order)", () => {
    const base = { ...SMALL, drift_pct: 0 };
    const a = runOf("default", { settings: base });
    const b = runOf("default", { settings: base, fields: { maintenance: [{ analyzer: "AN-1", start: { value: 3 * 1440 + 510, unit: "min", ref: "A205" }, length: { value: 4, unit: "h", ref: "A096" } }] } });
    const key = (e: { request_id: string; analyte: string; attempt: number }) => `${e.request_id}#${e.analyte}#${e.attempt}`;
    const na = new Map(of(a.events, "result_measured").filter((e) => e.analyte === "glucose").map((e) => [key(e), e] as const));
    let same = 0;
    for (const e of of(b.events, "result_measured").filter((x) => x.analyte === "glucose")) {
      const o = na.get(key(e));
      if (!o) continue;
      expect(o.true_value, key(e)).toBe(e.true_value);
      expect(o.noise, key(e)).toBe(e.noise);
      same++;
    }
    expect(same).toBeGreaterThan(20);
    expect(a.runs.map((r) => r.start_s)).not.toEqual(b.runs.map((r) => r.start_s));
  });

  it("Then an unknown analyte in a route is rejected when the profile is read, not guessed", () => {
    const profile = lookup("analyzer", "allinone_atline") as Profile;
    const route: NonNullable<Profile["route"]> = [{ group: "G", analytes: [{ id: "no_such_analyte" }], service: "service_s", storage: "room_temperature" }];
    expect(() => routeConfig({ ...profile, route })).toThrow(/analyte/);
    expect(() => routeConfig(profile)).not.toThrow();
  });
});

describe("Stability effects in a run (A043 with the 30 min of A046, A040 at rate 0)", () => {
  it("Given the closed-container pH drift Then every pH result carries the drift of its hold, and extrapolated exactly when the hold passes 30 min; viability, at rate 0, carries none", () => {
    const r = runOf("default", { seed: 4 });
    const drawn = new Map(of(r.events, "sample_drawn").map((e) => [e.sample_id, e.t]));
    const started = new Map(of(r.events, "run_started").map((e) => [`${e.request_id}#${e.attempt}#${e.visit}`, e.t]));
    let inside = 0;
    let beyond = 0;
    for (const e of of(r.events, "result_measured")) {
      if (e.analyte === "viability") expect(e.stability_kind, e.request_id).toBeUndefined();
      if (e.analyte !== "ph") continue;
      const hold = (started.get(`${e.request_id}#${e.attempt}#${e.visit}`) as number) - (drawn.get(e.request_id) as number);
      expect(e.stability_kind).toBe("linear_rate");
      expect(e.stability_delta, e.request_id).toBeCloseTo((-0.025 * hold) / 3600, 12);
      expect(e.true_value, e.request_id).toBeCloseTo(7 + (-0.025 * hold) / 3600, 12);
      expect(e.extrapolated === true, `${e.request_id} hold ${hold}`).toBe(hold > 1800);
      if (hold > 1800) beyond++;
      else inside++;
    }
    expect(inside).toBeGreaterThan(5);
    expect(beyond).toBeGreaterThan(5);
  });
});

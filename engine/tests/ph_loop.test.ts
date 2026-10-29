import { describe, expect, it } from "vitest";
import type { Params } from "../src/profiles.ts";
import { controllerStep, phLoopConfig, probeDrift, probeReading, simulatePhLoop } from "../src/sensors.ts";
import type { PhLoopConfig } from "../src/sensors.ts";
import { configOf } from "./support/scenarios.ts";

// The feedback path of L1 (spec 6.2, experiment 2): the online pH probe reads true pH + offset + noise, the offset drifts (A094) and is reset by a readjustment,
// and the controller acts on the reading with a deadband (A095) around the set point (A198), so the true pH moves when the probe is off.
// Every value below is test-only arithmetic typed by hand: a cadence of 60 s, a set point of 7, a deadband of 0.02 and a drift of 0.012 pH per tick, which is
// 0.012 x 86400 / 60 = 17.28 pH per day (not a ledger value; the ledger default is A094 = 0.01 pH per day).

const CFG: PhLoopConfig = { drift_per_day: 17.28, deadband: 0.02, readjust_every_s: null, technique_p: 0 };
const run = (over: Partial<PhLoopConfig>, noise: number[], sign: 1 | -1 = 1, readjust = (): number | null => null) =>
  simulatePhLoop({ setpoint: 7, cfg: { ...CFG, ...over } }, 1000, 60, noise, sign, readjust);
const close = (got: ArrayLike<number>, want: number[]): void => {
  expect(got.length).toBe(want.length);
  want.forEach((w, i) => expect(got[i], `index ${i}`).toBeCloseTo(w, 10));
};

describe("L1 feedback: one probe and controller step (A094, A095, A198)", () => {
  it("Given a true pH, an offset and a noise draw When the probe is read Then the reading is their sum: 7 + 0.012 + 0.003 = 7.015", () => {
    expect(probeReading(7, 0.012, 0.003)).toBeCloseTo(7.015, 12);
  });

  it("Given a deadband of 0.25 around 1 Then the controller does nothing at the edge and acts only beyond it, back to the set point", () => {
    expect(controllerStep(1.25, 1, 0.25)).toBe(0);
    expect(controllerStep(0.75, 1, 0.25)).toBe(0);
    expect(controllerStep(1.5, 1, 0.25)).toBe(-0.5);
    expect(controllerStep(0.5, 1, 0.25)).toBe(0.5);
  });

  it("Given a drift of 17.28 pH per day in either direction Then 60 s move the offset by 0.012 and 3600 s of -86.4 per day by -3.6", () => {
    expect(probeDrift(1, 17.28, 60)).toBeCloseTo(0.012, 12);
    expect(probeDrift(-1, 86.4, 3600)).toBeCloseTo(-3.6, 12);
  });
});

describe("L1 feedback: the loop on a hand-computed case (no noise, no readjustment)", () => {
  // tick: offset 0, .012, .024, .036, .048, .060; the reading leaves the band (|reading - 7| > 0.02) at ticks 2 and 4, where the controller moves the true pH by -0.024
  const series = run({}, [0, 0, 0, 0, 0, 0]);

  it("Given a positive drift When six ticks pass Then the probe offset grows by 0.012 per tick", () => {
    close(series.offset, [0, 0.012, 0.024, 0.036, 0.048, 0.06]);
  });

  it("Then the reading is the true pH plus the offset: 7, 7.012, 7.024, 7.012, 7.024, 7.012", () => {
    close(series.pv, [7, 7.012, 7.024, 7.012, 7.024, 7.012]);
  });

  it("Then the true pH moves down by 0.024 at the ticks where the reading was outside the deadband: 7, 7, 7, 6.976, 6.976, 6.952", () => {
    close(series.truth, [7, 7, 7, 6.976, 6.976, 6.952]);
  });

  it("Then the series carries its start, its cadence and its length", () => {
    expect([series.t0_s, series.cadence_s, series.n]).toEqual([1000, 60, 6]);
  });

  it("Given a negative drift Then the loop mirrors: offsets -0.012 per tick, true pH 7, 7, 7, 7.024, 7.024, 7.048", () => {
    const m = run({}, [0, 0, 0, 0, 0, 0], -1);
    close(m.offset, [0, -0.012, -0.024, -0.036, -0.048, -0.06]);
    close(m.truth, [7, 7, 7, 7.024, 7.024, 7.048]);
  });

  it("Given a noise draw of 0.03 at the first tick (zero drift) Then the controller acts on the noisy reading, 7 -> 6.97, and acts back the next tick", () => {
    const n = run({ drift_per_day: 0 }, [0.03, 0, 0]);
    close(n.pv, [7.03, 6.97, 7]);
    close(n.truth, [7, 6.97, 7]);
  });
});

describe("L1 feedback: readjustment onto an offline value (A051, A108)", () => {
  it("Given a readjustment every 180 s that returns 6.99 at tick 3 Then the offset there is 6.99 - 6.976 = 0.014 and the reading is 6.99", () => {
    const calls: { j: number; t: number; truthBefore: number[] }[] = [];
    const r = simulatePhLoop({ setpoint: 7, cfg: { ...CFG, readjust_every_s: 180 } }, 1000, 60, [0, 0, 0, 0, 0, 0], 1, (j, t, past) => {
      calls.push({ j, t, truthBefore: Array.from(past.truth.slice(0, j)) });
      return 6.99;
    });
    close(r.offset, [0, 0.012, 0.024, 0.014, 0.026, 0.038]);
    close(r.pv, [7, 7.012, 7.024, 6.99, 7.002, 7.014]);
    close(r.truth, [7, 7, 7, 6.976, 6.976, 6.976]);
    expect(calls.map((c) => [c.j, c.t])).toEqual([[3, 1180]]);
    expect(calls[0]?.truthBefore).toEqual([7, 7, 7]);
  });

  it("Given a readjustment that returns null Then nothing changes against the run without readjustment", () => {
    const a = run({ readjust_every_s: 180 }, [0, 0, 0, 0, 0, 0], 1, () => null);
    const b = run({}, [0, 0, 0, 0, 0, 0]);
    expect(Array.from(a.offset)).toEqual(Array.from(b.offset));
    expect(Array.from(a.truth)).toEqual(Array.from(b.truth));
  });

  it("Given readjustment off (A051) Then the readjustment function is never called", () => {
    let calls = 0;
    run({ readjust_every_s: null }, [0, 0, 0, 0, 0, 0], 1, () => (calls++, 7));
    expect(calls).toBe(0);
  });

  it("Given an interval of 120 s over eleven ticks Then it is called at ticks 2, 4, 6, 8 and 10 and never at tick 0", () => {
    const at: number[] = [];
    simulatePhLoop({ setpoint: 7, cfg: { ...CFG, drift_per_day: 0, readjust_every_s: 120 } }, 0, 60, new Array(11).fill(0), 1, (j) => (at.push(j), null));
    expect(at).toEqual([2, 4, 6, 8, 10]);
  });

  it("Given an interval that is not a whole number of ticks Then the loop refuses it", () => {
    expect(() => run({ readjust_every_s: 90 }, [0, 0, 0])).toThrow(/multiple of the sensor cadence/);
  });
});

const PARAMS: Params = {
  ph_probe_drift_per_d: { value: 0.01, unit: "pH/d", ref: "A094" },
  ph_controller_deadband: { value: 0.02, unit: "pH", ref: "A095" },
  ph_probe_readjust_on: { value: 1, unit: "flag", ref: "A051" },
  ph_probe_readjust_interval_h: { value: 24, unit: "h", ref: "A108" },
  technique_error_probability: { value: 0.02, unit: "probability", ref: "A064" },
};

describe("L1 feedback: the settings (default off)", () => {
  it("Given the default scenario Then it has no feedback settings and the process config carries none", () => {
    expect("phLoop" in configOf("default").process).toBe(false);
  });

  it("Given the five settings with their ledger values Then the config is the drift, the deadband, 24 h in seconds and the technique probability", () => {
    expect(phLoopConfig(PARAMS, 60)).toEqual({ drift_per_day: 0.01, deadband: 0.02, readjust_every_s: 86400, technique_p: 0.02 });
  });

  it("Given A051 off (flag 0) Then there is no readjustment interval", () => {
    expect(phLoopConfig({ ...PARAMS, ph_probe_readjust_on: { value: 0, unit: "flag", ref: "A051" } }, 60)?.readjust_every_s).toBeNull();
  });

  it("Given none of the settings Then the config is undefined; given only some of them Then it names the missing one", () => {
    expect(phLoopConfig({}, 60)).toBeUndefined();
    const rest = Object.fromEntries(Object.entries(PARAMS).filter(([name]) => name !== "ph_controller_deadband"));
    expect(() => phLoopConfig(rest, 60)).toThrow(/ph_controller_deadband is missing/);
  });

  it("Given an interval that is not a multiple of the cadence, a negative drift or a probability above 1 Then the config refuses it", () => {
    expect(() => phLoopConfig({ ...PARAMS, ph_probe_readjust_interval_h: { value: 0.0125, unit: "h", ref: "A108" } }, 60)).toThrow(/multiple of the sensor cadence/);
    expect(() => phLoopConfig({ ...PARAMS, ph_probe_drift_per_d: { value: -0.01, unit: "pH/d", ref: "A094" } }, 60)).toThrow(/drift/);
    expect(() => phLoopConfig({ ...PARAMS, technique_error_probability: { value: 1.5, unit: "probability", ref: "A064" } }, 60)).toThrow(/probability/);
  });
});

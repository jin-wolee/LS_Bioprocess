import { beforeAll, describe, expect, it } from "vitest";
import type { ScenarioRun } from "../../src/run.ts";
import { H, docOf, fx12a, runOfDoc } from "./support.ts";

// Spec 11.8.2 rule S1: "The noise of the series is the existing keyed draw and does not change." The overlay moves the true value and the process value by the same amount (a linear
// ramp that ends at signal_at), so the process value minus the true value is the series' own noise, and everything before the ramp and every unaffected series is byte-identical.

const series = (run: ScenarioRun, unit: string, signal: string) => {
  const s = run.sensors.find((x) => x.unit_id === unit && x.signal === signal);
  if (!s) throw new Error(`no ${signal} series for ${unit}`);
  return s;
};

describe("The signal overlay keeps the keyed noise of the series", () => {
  let base: ScenarioRun;
  let run: ScenarioRun;
  beforeAll(() => {
    base = runOfDoc(docOf());
    run = runOfDoc(docOf(fx12a()));
  });

  it("Given FX12a When the DO and pH of U01 are compared with the run without the event Then process value minus true value is the same noise at every tick up to the stop", () => {
    for (const signal of ["DO", "pH"]) {
      const a = series(run, "U01", signal);
      const b = series(base, "U01", signal);
      expect(a.n).toBe(H(19) / 60 + 1);
      for (let j = 0; j < a.n; j++) expect((a.pv[j] as number) - (a.truth[j] as number)).toBeCloseTo((b.pv[j] as number) - (b.truth[j] as number), 10);
    }
  });

  it("Given the ramp starts at 11 h When the ticks before it are compared Then the process values and the true values are identical, bit for bit, to the run without the event", () => {
    for (const signal of ["DO", "pH"]) {
      const a = series(run, "U01", signal);
      const b = series(base, "U01", signal);
      const k = H(11) / 60; // the ramp starts at the tick of 11 h: the value there is the set point plus nothing
      expect(Array.from(a.pv.subarray(0, k + 1))).toEqual(Array.from(b.pv.subarray(0, k + 1)));
      expect(Array.from(a.truth.subarray(0, k + 1))).toEqual(Array.from(b.truth.subarray(0, k + 1)));
    }
  });

  it("Given the signature of a bacterial event is DO and pH only When the other series are compared Then temperature of U01 and every series of U02 and U03 are bit-identical to the run without the event", () => {
    const t = series(run, "U01", "temperature");
    const tb = series(base, "U01", "temperature");
    expect(Array.from(t.pv)).toEqual(Array.from(tb.pv.subarray(0, t.n)));
    for (const unit of ["U02", "U03"]) {
      for (const signal of ["DO", "pH", "temperature"]) {
        expect(Array.from(series(run, unit, signal).pv)).toEqual(Array.from(series(base, unit, signal).pv));
        expect(Array.from(series(run, unit, signal).truth)).toEqual(Array.from(series(base, unit, signal).truth));
      }
    }
  });

  it("Given the observable series are what a recorder sees When they are read Then they carry the overlay on the process value (the historian shows the fall)", () => {
    const pv = run.observableSensors.find((s) => s.unit_id === "U01" && s.signal === "DO")?.pv;
    expect(pv?.[H(17) / 60]).toBeLessThan(25); // the low alarm 20 plus noise of sd 0.2 (A199): far below the set point 30
    expect(pv?.[H(10) / 60]).toBeGreaterThan(28);
  });
});

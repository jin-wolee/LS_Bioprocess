import { describe, expect, it } from "vitest";
import { applyStability, stabilityConfig } from "../src/stability.ts";

// Stability effects between sampled_at and run_started_at (spec 2.2). The values are the test-only inputs written here;
// the expected results are hand arithmetic. An effect applied beyond the range its source covers carries extrapolated: true.

const p = (value: number, unit: string, ref: string) => ({ value, unit, ref });
const effects = stabilityConfig([
  { effect: "linear_rate", analyte: "viability", container: "open", rate: p(-3.0, "pct_points/h", "A040"), valid_to: p(55, "min", "A039") },
  { effect: "linear_rate", analyte: "ph", container: "closed", rate: p(-0.025, "pH/h", "A043"), valid_to: p(30, "min", "A046") },
  { effect: "first_order_offset", analyte: "ph", container: "open", offset: p(0.04, "pH", "A041"), tau: p(2.5, "h", "A042") },
  { effect: "linear_rate", analyte: "glucose", container: "open", rate: p(0, "g/L/h", "A045") },
]);
const MIN = 60;

describe("Stability: linear rate per hour of hold", () => {
  it("Given viability -3.0 points/h and a 30 min hold When applied Then 97 becomes 95.5 and the effect is inside the 55 min of its source", () => {
    const r = applyStability(effects, "viability", "open", 97, 30 * MIN);
    expect(r.value).toBeCloseTo(95.5, 12);
    expect(r).toMatchObject({ kind: "linear_rate" });
    expect(r.delta).toBeCloseTo(-1.5, 12);
    expect(r.extrapolated).toBeFalsy();
  });

  it("Given a 90 min hold (beyond A039) When applied Then the value is 97 - 4.5 = 92.5 and extrapolated is true", () => {
    const r = applyStability(effects, "viability", "open", 97, 90 * MIN);
    expect(r.value).toBeCloseTo(92.5, 12);
    expect(r.extrapolated).toBe(true);
  });

  it("Given a hold of exactly the validity limit Then it is still covered (valid to 55 min), and one second more is not", () => {
    expect(applyStability(effects, "viability", "open", 97, 55 * MIN).extrapolated).toBeFalsy();
    expect(applyStability(effects, "viability", "open", 97, 55 * MIN + 1).extrapolated).toBe(true);
  });

  it("Given the closed-container pH drift of -0.025 per hour and a 20 min hold Then pH 7.00 becomes 7.00 - 0.025/3, covered by the 30 min of A046; at 45 min it is extrapolated", () => {
    const a = applyStability(effects, "ph", "closed", 7, 20 * MIN);
    expect(a.value).toBeCloseTo(7 - 0.025 / 3, 12);
    expect(a.extrapolated).toBeFalsy();
    const b = applyStability(effects, "ph", "closed", 7, 45 * MIN);
    expect(b.value).toBeCloseTo(7 - 0.025 * 0.75, 12);
    expect(b.extrapolated).toBe(true);
  });
});

describe("Stability: first-order offset", () => {
  it("Given the open-container pH offset 0.04 with tau 2.5 h and a 1 h hold Then the offset is 0.04 x (1 - exp(-0.4)) = 0.0131872 and no range is known, so extrapolated is not set", () => {
    const r = applyStability(effects, "ph", "open", 7, 3600);
    expect(r.delta).toBeCloseTo(0.04 * (1 - Math.exp(-0.4)), 12);
    expect(r.value).toBeCloseTo(7 + 0.04 * (1 - Math.exp(-0.4)), 12);
    expect(r.kind).toBe("first_order_offset");
    expect(r.extrapolated).toBeUndefined();
  });
});

describe("Stability: which effect applies", () => {
  it("Given the container decides Then the same analyte uses the drift in a closed container and the offset in an open one", () => {
    expect(applyStability(effects, "ph", "closed", 7, 3600).kind).toBe("linear_rate");
    expect(applyStability(effects, "ph", "open", 7, 3600).kind).toBe("first_order_offset");
  });

  it("Given a zero rate (A040 default 0, A045 off) Then the value is unchanged and the result carries no stability fields", () => {
    for (const analyte of ["glucose"]) {
      expect(applyStability(effects, analyte, "open", 5, 7200)).toEqual({ value: 5 });
    }
    expect(applyStability(stabilityConfig([{ effect: "linear_rate", analyte: "viability", container: "open", rate: p(0, "pct_points/h", "A040"), valid_to: p(55, "min", "A039") }]), "viability", "open", 97, 9000)).toEqual({ value: 97 });
  });

  it("Given an analyte without an effect, or a hold of zero Then the value is unchanged", () => {
    expect(applyStability(effects, "titer", "open", 1.2, 5000)).toEqual({ value: 1.2 });
    expect(applyStability(effects, "viability", "open", 97, 0)).toEqual({ value: 97 });
  });
});

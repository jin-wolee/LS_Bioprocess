import { describe, expect, it } from "vitest";
import { observeSensors } from "../src/observe.ts";
import type { SensorSeries } from "../src/sensors.ts";
import { SMALL, runOf } from "./support/scenarios.ts";

// S2a Task 1 (adversary note F11 of the S1b pass): `ScenarioRun.sensors` carries the process value and the truth side by side.
// Recorders get `observableSensors`: the process value only, produced on the observe side.

const hand = (): SensorSeries[] => [
  // test-only values: the truth differs from the process value on purpose, and 999.5 appears nowhere else
  { unit_id: "U1", signal: "pH", t0_s: 600, cadence_s: 300, n: 3, pv: Float64Array.from([7.0, 7.1, 6.9]), truth: Float64Array.from([7.05, 999.5, 6.95]) },
  { unit_id: "U1", signal: "temperature", t0_s: 600, cadence_s: 300, n: 2, pv: Float64Array.from([37.0, 36.9]), truth: Float64Array.from([36.95, 36.95]) },
];

describe("observeSensors: the observable view of the online sensor series", () => {
  it("Given a series with a hidden truth array When observed Then exactly the identity, the cadence and the process value remain", () => {
    const [ph] = observeSensors(hand());
    expect(Object.keys(ph ?? {}).sort()).toEqual(["cadence_s", "n", "pv", "signal", "t0_s", "unit_id"]);
    expect(ph).toMatchObject({ unit_id: "U1", signal: "pH", t0_s: 600, cadence_s: 300, n: 3 });
    expect(Array.from(ph?.pv ?? [])).toEqual([7.0, 7.1, 6.9]);
  });

  it("Given the same input When observed Then no value of the truth array is reachable from the result", () => {
    const view = observeSensors(hand());
    const flat = JSON.stringify(view, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v));
    expect(flat.includes("999.5")).toBe(false);
    expect(flat.includes("truth")).toBe(false);
    for (const s of view) expect(s.pv.length).toBe(s.n);
  });

  it("Given a series When observed Then the engine's own arrays are not copied and the view does not share the truth buffer", () => {
    const input = hand();
    const view = observeSensors(input);
    expect(view[0]?.pv).toBe(input[0]?.pv);
    expect(view[0]?.pv).not.toBe(input[0]?.truth);
  });

  it("Given an empty input When observed Then the result is empty", () => {
    expect(observeSensors([])).toEqual([]);
  });
});

describe("ScenarioRun.observableSensors", () => {
  it("Given a small scenario run Then there is one observable series per sensor series with the same process values and nothing else", () => {
    const r = runOf("default", { settings: SMALL, seed: 3 });
    expect(r.sensors.length).toBeGreaterThan(0);
    expect(r.observableSensors.length).toBe(r.sensors.length);
    r.sensors.forEach((s, i) => {
      const o = r.observableSensors[i];
      expect(Object.keys(o ?? {}).sort()).toEqual(["cadence_s", "n", "pv", "signal", "t0_s", "unit_id"]);
      expect(o).toMatchObject({ unit_id: s.unit_id, signal: s.signal, t0_s: s.t0_s, cadence_s: s.cadence_s, n: s.n });
      expect(o?.pv).toBe(s.pv);
      expect(Object.values(o ?? {})).not.toContain(s.truth);
    });
  }, 60_000);
});

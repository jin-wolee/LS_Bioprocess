import { describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import { runScenario } from "../src/run.ts";
import { configOf, SMALL } from "./support/scenarios.ts";

// A profile per bay (spec section 4.5.2): the reactors of a bay take its bioreactor profile in the three places where the profile is read: the working volume (the litres
// of a feed), the sample volume with its cap per reactor (A057, A207) and the container of each analyte (A037). Six reactors in two bays of three: U01 to U03 are bay 1,
// U04 to U06 bay 2. Bay 1 is the bench vessel (2 L, 0.014 percent per draw, pH in a closed container), bay 2 the micro-scale vessel (12.5 mL, 4.8 percent per draw, pH in an
// open cup). Expected numbers are hand arithmetic from the profile files: 0.014 / 100 x 2 L = 280 uL; 4.8 / 100 x 12.5 mL = 600 uL; cap 33 percent (A207) of 12.5 mL = 4125 uL,
// so six draws of 600 uL fit (3600) and a seventh (4200) does not; a scripted feed is 2.4 percent (A192) of the working volume: 0.024 x 2 L = 0.048 L, 0.024 x 0.0125 L = 0.0003 L.

const feedAt = (unit: string) => ({ type: "feed", unit_id: unit, at: { value: 3600, unit: "min", ref: "A102" } });
const run = runScenario(configOf("default", {
  settings: { ...SMALL, bay_size: 3, rerun_probability: 0 },
  fields: { bay_profiles: ["bench_manual", "micro_mini_parallel"], scripted_events: [feedAt("U01"), feedAt("U04")] } as never,
}));
const ofType = <T extends Event["type"]>(type: T) => run.events.filter((e): e is Extract<Event, { type: T }> => e.type === type);
const unitOf = (sample_id: string): string => sample_id.slice(0, 3);
const bayOf = (unit: string): number => (["U01", "U02", "U03"].includes(unit) ? 1 : 2);

describe("bay_profiles: a bench bay beside a micro-scale bay", () => {
  it("Given the two bays Then a draw is 280 uL in bay 1 and 600 uL in bay 2", () => {
    const drawn = ofType("sample_drawn");
    expect(drawn.some((e) => bayOf(e.unit_id) === 1)).toBe(true);
    expect(drawn.some((e) => bayOf(e.unit_id) === 2)).toBe(true);
    for (const e of drawn) expect(e.volume_ul, e.sample_id).toBe(bayOf(e.unit_id) === 1 ? 280 : 600);
  });

  it("Given the cap of 4125 uL in bay 2 Then no micro-scale reactor has more than six draws, the next is refused at a cumulative 3600 uL, and bay 1 refuses none", () => {
    const perUnit = new Map<string, number>();
    for (const e of ofType("sample_drawn")) perUnit.set(e.unit_id, (perUnit.get(e.unit_id) ?? 0) + 1);
    for (const [unit, n] of perUnit) if (bayOf(unit) === 2) expect(n, unit).toBeLessThanOrEqual(6);
    const skipped = ofType("draw_skipped_volume_budget");
    expect(skipped.length).toBeGreaterThan(0);
    for (const e of skipped) {
      expect(bayOf(e.unit_id), e.sample_id).toBe(2);
      expect([e.volume_ul, e.cumulative_ul], e.sample_id).toEqual([600, 3600]);
    }
  });

  it("Given the pH results Then a micro-scale sample is read from an open cup (first-order offset, A041) and a bench sample is not", () => {
    const ph = ofType("result_measured").filter((e) => e.analyte === "ph");
    expect(ph.filter((e) => bayOf(unitOf(e.request_id)) === 2).length).toBeGreaterThan(0);
    for (const e of ph) expect(e.stability_kind === "first_order_offset", e.request_id).toBe(bayOf(unitOf(e.request_id)) === 2);
  });

  it("Given a scripted feed on U01 (2 L) and on U04 (12.5 mL) Then the volumes added are 0.048 L and 0.0003 L", () => {
    const feeds = ofType("process_event").filter((e) => e.kind === "feed" && e.source === "scripted");
    const amount = (unit: string): number => (feeds.find((e) => e.unit_id === unit) as { amount: number }).amount;
    expect(amount("U01")).toBeCloseTo(0.048, 12);
    expect(amount("U04")).toBeCloseTo(0.0003, 12);
  });
});

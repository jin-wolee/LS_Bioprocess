import { describe, expect, it } from "vitest";
import { docOf, eventsOf, fx12a, h, runOfDoc, set } from "./support.ts";

// Spec 11.8.2 rule S3: one confirming sample per confirmed unit, one aliquot per test, a draw above the cumulative volume cap (A207, per-sample budget A057) is skipped and logged as
// draw_skipped_volume_budget, its tests do not run, and it stays in every denominator. The micro-scale profile (A110: 12.5 mL, A057: 4.8 percent a draw, A207: 33 percent cap) cannot give a
// 42 mL confirming sample; the bench profile (2 L) can.

describe("Confirming draws and the volume budget", () => {
  it("Given the bench vessel (2 L, cap 660 mL) When the 42 mL confirming sample is drawn Then it is drawn and no draw is skipped", () => {
    const run = runOfDoc(docOf(fx12a()));
    expect(eventsOf(run, "confirm_sample_drawn").length).toBe(2);
    expect(eventsOf(run, "draw_skipped_volume_budget")).toEqual([]);
  });

  it("Given the micro-scale vessel (cap 33 percent of 12.5 mL = 4125 uL) When the confirming draw of 42 000 uL falls due Then it is skipped, logged, and none of its tests runs", () => {
    const run = runOfDoc(docOf(fx12a(), {}, { profiles: { bioreactor: "micro_mini_parallel", analyzer: "allinone_atline", staff: "experienced" } }));
    // the micro vessel also refuses routine draws once its cap is spent; the confirming ones are those of the "-CONF" samples
    expect(eventsOf(run, "draw_skipped_volume_budget").filter((e) => e.sample_id.endsWith("-CONF"))).toEqual([
      { type: "draw_skipped_volume_budget", t: 68_400, sample_id: "U01-CONF", unit_id: "U01", batch_id: "B-U01", volume_ul: 42_000, cumulative_ul: 0 },
      { type: "draw_skipped_volume_budget", t: 68_400, sample_id: "U02-CONF", unit_id: "U02", batch_id: "B-U02", volume_ul: 42_000, cumulative_ul: 0 },
    ]);
    expect(eventsOf(run, "confirm_sample_drawn")).toEqual([]);
    expect(eventsOf(run, "confirm_result")).toEqual([]);
  });

  it("Given routine draws of 600 uL (4.8 percent of 12.5 mL) before the decision When the confirming draw is skipped Then cumulative_ul is the routine volume already drawn from that unit", () => {
    // U01 contaminated through ML-2 taken at 36 h: the decision falls at 50 h, after the routine draws of the first day
    const consumption = (fx12a().topology as { consumption: object[] }).consumption.map((c, i) => (i === 6 ? { unit_id: "U01", lot_id: "ML-2", at: h(36) } : c));
    const block = set(fx12a(), "topology.consumption", consumption);
    const run = runOfDoc(docOf(block, {}, { profiles: { bioreactor: "micro_mini_parallel", analyzer: "allinone_atline", staff: "experienced" } }));
    const drawn = eventsOf(run, "sample_drawn").filter((e) => e.unit_id === "U01" && e.t <= 180_000);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((e) => e.volume_ul === 600)).toBe(true);
    const skipped = eventsOf(run, "draw_skipped_volume_budget").filter((e) => e.sample_id === "U01-CONF");
    expect(skipped.map((e) => [e.t, e.cumulative_ul])).toEqual([[180_000, 600 * drawn.length]]);
  });

  it("Given the operator of a confirming draw When it is read Then it is one of the four operators of the roster", () => {
    const run = runOfDoc(docOf(fx12a()));
    const ids = new Set(run.operators.map((o) => o.operator_id));
    for (const e of eventsOf(run, "confirm_sample_drawn")) expect(ids.has(e.operator_id)).toBe(true);
  });
});

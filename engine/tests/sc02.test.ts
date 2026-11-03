import { describe, expect, it } from "vitest";
import { DAY, dayOf, isWeekend } from "./support/metrics.ts";
import { runOf } from "./support/scenarios.ts";

// SC2 Shift-start burst (spec 7): why wait when mean utilisation is low?
// Metrics are reported, not gated (spec section 8; docs/prompts/00 section 2 item 8). These tests gate structural facts only: where each plan
// puts the planned times, and what the plan leaves alone. The metric question (the p90 hold_time of the burst arm against the staggered
// arm) is reported in docs/progress.md over 20 seeds with its spread, whatever its sign, and is never asserted here.
// The burst arm is data/scenarios/default.json, the staggered arm is data/scenarios/sc02_shift_burst.json.

const BAY_WIDTH_MIN = 45; // A203: written out here for the independent check
const BAY_START_MIN = [480, 525]; // bay 1 from 08:00, bay 2 from 08:45
const BAY_SIZE = 12;

const firstSamples = (run: ReturnType<typeof runOf>) => run.samples.filter((s) => s.sample_id.endsWith("-1"));
const secondSamples = (run: ReturnType<typeof runOf>) => run.samples.filter((s) => s.sample_id.endsWith("-2"));
const plans = (samples: { sample_id: string; planned_s: number }[]) => new Map(samples.map((s) => [s.sample_id, s.planned_s] as const));

describe("SC2 shift-start burst", () => {
  const burst = runOf("default", { seed: 1 });
  const staggered = runOf("sc02_shift_burst", { seed: 1 });

  it("Given the staggered arm When first samples are planned Then every one sits at its slot of its bay window: reactor j of a bay at start + (j + 0.5) x 45/12 min, bay 1 from 08:00 and bay 2 from 08:45 (A203)", () => {
    const first = firstSamples(staggered);
    expect(first.length).toBeGreaterThan(100);
    for (const s of first) {
      const i = Number(s.unit_id.slice(1)) - 1;
      const bay = Math.floor(i / BAY_SIZE);
      const slot = i % BAY_SIZE;
      const start = (BAY_START_MIN[bay] as number) * 60;
      const expected = Math.floor(start + ((slot + 0.5) * BAY_WIDTH_MIN * 60) / BAY_SIZE + 0.5);
      expect(s.planned_s - dayOf(s.planned_s) * DAY, s.sample_id).toBe(expected);
      expect(expected, s.sample_id).toBeGreaterThanOrEqual(start);
      expect(expected, s.sample_id).toBeLessThanOrEqual(start + BAY_WIDTH_MIN * 60);
    }
  });

  it("Then the staggered plan uses no randomness (planned times are the same for seeds 1 and 2) while the burst plan does", () => {
    const a = plans(firstSamples(staggered));
    const b = plans(firstSamples(runOf("sc02_shift_burst", { seed: 2 })));
    let common = 0;
    for (const [id, t] of a) {
      if (!b.has(id)) continue;
      common++;
      expect(b.get(id), id).toBe(t);
    }
    expect(common).toBeGreaterThan(100);
    const x = plans(firstSamples(burst));
    const y = plans(firstSamples(runOf("default", { seed: 2 })));
    expect([...x].filter(([id, t]) => y.has(id) && y.get(id) !== t).length).toBeGreaterThan(50);
  });

  it("Given both arms Then the second samples are the same samples at the same planned times, inside the feed window and never on a weekend (A015, A194); the plan changes first samples only", () => {
    const a = secondSamples(burst);
    const b = plans(secondSamples(staggered));
    expect(a.length).toBeGreaterThan(50);
    let common = 0;
    for (const s of a) {
      expect(isWeekend(dayOf(s.planned_s)), s.sample_id).toBe(false);
      expect(s.planned_s % DAY, s.sample_id).toBeGreaterThanOrEqual(540 * 60);
      expect(s.planned_s % DAY, s.sample_id).toBeLessThanOrEqual(660 * 60);
      if (!b.has(s.sample_id)) continue;
      common++;
      expect(b.get(s.sample_id), s.sample_id).toBe(s.planned_s);
    }
    expect(common).toBeGreaterThan(40);
  });

  it("Then in both arms every draw lies inside the staffed window of its day, 08:00 to 18:00 on weekdays and to 14:00 on weekends (A201)", () => {
    for (const run of [burst, staggered]) {
      for (const s of run.samples.filter((x) => x.state !== "skipped")) {
        const end = isWeekend(dayOf(s.drawn_s)) ? 840 : 1080;
        expect(s.drawn_s % DAY, s.sample_id).toBeGreaterThanOrEqual(480 * 60);
        expect(s.drawn_s % DAY, s.sample_id).toBeLessThanOrEqual(end * 60);
      }
    }
  });
});

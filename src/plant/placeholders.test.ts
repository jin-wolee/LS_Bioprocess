import { describe, expect, it } from "vitest";
import { handPlan, indexOf } from "./fixture.ts";
import { RAIL, railsAt, tagBox } from "./placeholders.ts";

// P5b (docs/design/plant_ui.md section 3.3, "As built in P5b"): where the placeholders of the truth overlay stand. A tag stands on the rail on top of a hall's wall, in order of the instant the plant
// produced the row (the plan's `drawn_s` of the sample), then by sample; the rail is laid out for the placeholders the hall has in the whole run, so a tag never moves when another appears. Every
// expected value is hand arithmetic on the metres of RAIL and on the hand plan of fixture.ts (draws at U01-D00-1 2000, U02-D00-1 2100, U01-D00-2 2200, U01-D00-3 3000, U02-D00-2 5000 (skipped),
// U01-D00-4 8000, U02-D00-3 11000, U02-D00-4 14000).

const plan = handPlan();
const hall = { x: 10, z: 3, w: 5, d: 1.2, h: 2.4 };
const at = (id: string) => indexOf(plan, id);
const halls = [
  {
    architecture: "a_manual",
    // listed in the order of the plan's samples, as the Worker lists them; the rail orders them by instant
    placeholders: [{ sample: at("U01-D00-2"), why: "not_recorded" as const }, { sample: at("U01-D00-4"), why: "not_recorded" as const }, { sample: at("U02-D00-2"), why: "skipped" as const }],
  },
  { architecture: "b_lims_lite", placeholders: [{ sample: at("U02-D00-2"), why: "skipped" as const }] },
];

describe("the metres of a tag", () => {
  it("Given a hall 5 m wide and 2.4 m tall at (10, 3) with three tags Then the pitch is 0.18 m, a tag is 0.14 m wide and 0.25 m tall on the wall's upper edge, in the plane of the cards", () => {
    // pitch min(0.18, (5 - 2 * 0.2) / 3) = 0.18; width min(0.14, 0.8 * 0.18 = 0.144) = 0.14; z = 3 + 1.2 - 0.12 = 4.08; foot = 2.4 + 0.05
    const b = [0, 1, 2].map((k) => tagBox(hall, 3, k));
    expect(b.map((x) => x.x)).toEqual([10.29, 10.47, 10.65].map((x) => expect.closeTo(x, 9)));
    for (const x of b) {
      expect(x.w).toBeCloseTo(0.14, 9);
      expect(x.h).toBe(RAIL.height);
      expect(x.y).toBeCloseTo(2.45, 9);
      expect(x.z).toBeCloseTo(4.08, 9);
    }
    expect(RAIL.height).toBe(0.25);
  });

  it("Given a hundred tags Then they shrink to fit the 4.6 m between the margins: a pitch of 0.046 m and a width of 0.8 of it", () => {
    const first = tagBox(hall, 100, 0);
    const last = tagBox(hall, 100, 99);
    expect(first.w).toBeCloseTo(0.0368, 9);
    expect(first.x).toBeCloseTo(10.2 + 0.023, 9);
    expect(last.x).toBeCloseTo(10.2 + 99.5 * 0.046, 9);
    expect(last.x + last.w / 2).toBeLessThan(hall.x + hall.w - RAIL.margin);
  });

  it("Given one tag Then it stands 0.09 m from the margin (half a pitch of 0.18 m)", () => {
    expect(tagBox(hall, 1, 0).x).toBeCloseTo(10.29, 9);
  });
});

describe("railsAt: the tags on the rails at an instant", () => {
  const shown = (t: number, k = 0) => railsAt(plan, halls, t)[k]?.shown.map((s) => [s.place, plan.samples[s.sample]?.id, s.why]);

  it("Given A with three placeholders (draws at 2200, 5000 and 8000) Then the places are the order of the instants and the rail is laid out for three", () => {
    const r = railsAt(plan, halls, 1e9)[0];
    expect(r?.architecture).toBe("a_manual");
    expect(r?.total).toBe(3);
    expect(shown(1e9)).toEqual([[0, "U01-D00-2", "not_recorded"], [1, "U02-D00-2", "skipped"], [2, "U01-D00-4", "not_recorded"]]);
  });

  it("Given the instants Then a tag appears at the second of its draw, its place is the same in every second that follows, and none stands before the first", () => {
    expect(shown(2199)).toEqual([]);
    expect(shown(2200)).toEqual([[0, "U01-D00-2", "not_recorded"]]);
    expect(shown(4999)).toEqual([[0, "U01-D00-2", "not_recorded"]]);
    expect(shown(5000)).toEqual([[0, "U01-D00-2", "not_recorded"], [1, "U02-D00-2", "skipped"]]);
    expect(shown(7999)?.length).toBe(2);
    expect(shown(8000)?.length).toBe(3);
  });

  it("Given two placeholders drawn at the same second Then the lower sample comes first", () => {
    const tied = railsAt({ ...plan, samples: plan.samples.map((s, i) => (i === at("U01-D00-4") ? { ...s, drawn_s: 2200 } : s)) }, halls, 2200)[0];
    expect(tied?.shown.map((s) => plan.samples[s.sample]?.id)).toEqual(["U01-D00-2", "U01-D00-4"]);
  });

  it("Given B with one placeholder, a skipped draw Then its rail holds one tag from 5000 s, and a hall with none holds an empty rail", () => {
    expect(shown(5000, 1)).toEqual([[0, "U02-D00-2", "skipped"]]);
    expect(railsAt(plan, [{ architecture: "c_context", placeholders: [] }], 1e9)).toEqual([{ architecture: "c_context", total: 0, shown: [] }]);
  });

  it("Given the same instant asked in a shuffled order Then the answers are those of the ordered list (a pure function of the plan and the instant)", () => {
    const ts = [8000, 2199, 5000, 1e9, 2200, 7999];
    const ordered = new Map([...ts].sort((a, b) => a - b).map((t) => [t, JSON.stringify(railsAt(plan, halls, t))]));
    for (const t of ts) expect(JSON.stringify(railsAt(plan, halls, t))).toBe(ordered.get(t));
  });
});

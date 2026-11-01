import { describe, expect, it } from "vitest";
import type { ScenePlan } from "../protocol.ts";
import { layoutOf } from "./layout.ts";
import type { Layout, Point, Rect } from "./layout.ts";

// docs/design/plant_ui.md section 3.1: the layout is a pure function of the shape of the run. Every expected number is hand arithmetic on the metres of the layout: a vessel pitch of 2, a bay
// margin of 1, an aisle of 3, a wall margin of 2, a bench 1.2 deep with 2.4 per analyzer and 1.2 at each end, record halls 5 long on a pitch of 6 (the constants are in layout.ts, METRES).
// Worked once for the default scenario: a bay of 12 is 6 by 2 vessels, 14 wide and 6 deep; two bays in one row are 14 + 3 + 14 = 31 wide, which is the working width, so the floor is 31 + 2 x
// (2 + 3) = 41 wide. The bands from the north start at 5 (wall margin and aisle): the halls (1.2 deep) to 6.2, the bays (6 deep) from 9.2 to 15.2, the bench (1.2) from 18.2 to 19.4; the
// floor ends 3 + 2 below the bench, at 24.4.

type Spec = ScenePlan["layout"];
const spec = (reactors: number, baySize = 12, analyzers = 2, halls = ["a_manual", "b_lims_lite", "c_context"]): Spec => ({
  bays: Array.from({ length: Math.ceil(reactors / baySize) }, (_, k) => ({ size: Math.min(baySize, reactors - k * baySize), profile: "bench_manual" })),
  analyzers: Array.from({ length: analyzers }, () => ({ profile: "allinone_atline", group: "AIO" })),
  architectures: halls,
});
const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 9);
const at = (p: Point, x: number, z: number): void => {
  near(p.x, x);
  near(p.z, z);
};

describe("the default scenario: 24 reactors in two bays of 12, two analyzers, three halls", () => {
  const l = layoutOf(spec(24));

  it("Given the shape Then the floor is 41 by 24.4 metres", () => {
    near(l.width, 41);
    near(l.depth, 24.4);
  });

  it("Given two bays of 12 Then each plinth is 14 by 6 at z 9.2, the first at x 5 and the second a bay and an aisle (3) further, at 22", () => {
    expect(l.bays.map((b) => b.footprint)).toEqual([
      { x: 5, z: 9.2, w: 14, d: 6, h: 2.2 },
      { x: 22, z: 9.2, w: 14, d: 6, h: 2.2 },
    ]);
  });

  it("Given 24 vessels in rows of six Then the first of bay 1 is at (7, 11.2), the last of it at (17, 13.2), the first of bay 2 is unit 12 at (24, 11.2)", () => {
    expect(l.vessels).toHaveLength(24);
    at(l.vessels[0] as Point, 7, 11.2);
    at(l.vessels[11] as Point, 17, 13.2);
    expect(l.vessels[12]).toMatchObject({ unit: 12, bay: 1, slot: 0 });
    at(l.vessels[12] as Point, 24, 11.2);
    expect(l.vessels.map((v) => v.unit)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it("Given the bench Then it is 7.2 long (two analyzers of 2.4 and 1.2 at each end), centred at x 20.5, at z 18.2", () => {
    const b = l.bench;
    near(b.x, 16.9);
    near(b.z, 18.2);
    near(b.w, 7.2);
    near(b.d, 1.2);
    expect(l.analyzers.map((a) => a.index)).toEqual([0, 1]);
    at(l.analyzers[0] as Point, 19.3, 18.8);
    at(l.analyzers[1] as Point, 21.7, 18.8);
    at((l.analyzers[0] as { intake: Point }).intake, 19.3, 20.9);
  });

  it("Given two analyzers of one group Then they share one intake lane, in the middle of the two, in front of the bench", () => {
    expect(l.lanes).toHaveLength(1);
    expect(l.lanes[0]?.group).toBe("AIO");
    expect(l.lanes[0]?.analyzers).toEqual([0, 1]);
    at(l.lanes[0] as Point, 20.5, 20.9);
  });

  it("Given three halls Then they stand in one row on a pitch of 6, centred on the floor, with their access in the aisle south of them", () => {
    expect(l.halls.map((h) => h.architecture)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(l.halls.map((h) => h.footprint.x)).toEqual([12, 18, 24]);
    expect(new Set(l.halls.map((h) => h.footprint.z))).toEqual(new Set([5]));
    at((l.halls[0] as { access: Point }).access, 14.5, 7.7);
  });

  it("Given the aisles Then the walk graph has 10 nodes and 13 edges, and the entrance is in front of the bench in the middle of the floor", () => {
    expect(l.walk.nodes).toHaveLength(10);
    expect(l.walk.edges).toHaveLength(13);
    at(l.entrance, 20.5, 20.9);
  });
});

describe("other shapes, by hand", () => {
  it("Given 100 reactors in bays of 12 Then there are nine bays, three to a row, the last of four vessels, and the floor is 58 by 42.4 metres: inside 100 on both axes", () => {
    const l = layoutOf(spec(100));
    expect(l.bays).toHaveLength(9);
    expect(l.bays.map((b) => b.footprint.w)).toEqual([14, 14, 14, 14, 14, 14, 14, 14, 10]);
    expect(l.vessels).toHaveLength(100);
    near(l.width, 58); // 3 x 14 + 2 x 3 = 48, plus 2 x (2 + 3)
    near(l.depth, 42.4); // bands at 5, 9.2, 18.2, 27.2 (bays of 6), 36.2 (bench of 1.2), then 3 + 2
    expect(l.bays.map((b) => b.footprint.z)).toEqual([9.2, 9.2, 9.2, 18.2, 18.2, 18.2, 27.2, 27.2, 27.2]);
  });

  it("Given 5 reactors in one bay Then the bay is 12 by 4, the working width is the minimum of 18 (three halls in a row), and the floor is 28 by 22.4", () => {
    const l = layoutOf(spec(5));
    expect(l.bays[0]?.footprint).toEqual({ x: 8, z: 9.2, w: 12, d: 4, h: 2.2 });
    near(l.width, 28);
    near(l.depth, 22.4);
  });

  it("Given the 11 halls of A, B, C and the eight ablations Then they wrap into rows (five to a row at 31 metres) with an aisle in front of each row", () => {
    const l = layoutOf(spec(24, 12, 2, Array.from({ length: 11 }, (_, i) => `h${i}`)));
    expect(l.halls).toHaveLength(11);
    const rows = (z: number) => l.halls.filter((h) => Math.abs(h.footprint.z - z) < 1e-9).length;
    expect([rows(5), rows(9.2), rows(13.4)]).toEqual([5, 5, 1]); // three rows, each 1.2 deep and an aisle (3) below the one before
    near((l.bays[0] as { footprint: Rect }).footprint.z, 17.6);
  });

  it("Given six analyzers of two groups Then the bench is 6 x 2.4 + 2.4 = 16.8 long and each group has its own lane", () => {
    const s = spec(24, 12, 6);
    s.analyzers = s.analyzers.map((a, i) => ({ ...a, group: i < 3 ? "CC" : "MET" }));
    const l = layoutOf(s);
    near(l.bench.w, 16.8);
    expect(l.lanes.map((x) => [x.group, x.analyzers])).toEqual([["CC", [0, 1, 2]], ["MET", [3, 4, 5]]]);
  });

  it("Given the same shape twice Then the layout is the same (a pure function)", () => {
    expect(layoutOf(spec(37, 10, 3))).toEqual(layoutOf(spec(37, 10, 3)));
  });
});

// ---- the properties of section 3.1, over N from 5 to 100 and M from 1 to 6 -------------------------------------------------

const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const inside = (p: Point, r: Rect, pad = 0): boolean => p.x > r.x - pad && p.x < r.x + r.w + pad && p.z > r.z - pad && p.z < r.z + r.d + pad;
const onSegment = (p: Point, a: Point, b: Point): boolean => {
  // the graph is made of horizontal and vertical lines, so a point is on one when it is between the ends and level with them
  const dx = Math.abs(a.x - b.x);
  const eps = 1e-9;
  return dx < eps ? Math.abs(p.x - a.x) < eps && p.z >= Math.min(a.z, b.z) - eps && p.z <= Math.max(a.z, b.z) + eps : Math.abs(p.z - a.z) < eps && p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps;
};
const onGraph = (l: Layout, p: Point): boolean => l.walk.edges.some(([i, j]) => onSegment(p, l.walk.nodes[i] as Point, l.walk.nodes[j] as Point));
/** An axis-parallel segment crosses a rectangle when it passes through its inside. */
const crosses = (a: Point, b: Point, r: Rect): boolean => {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  return x1 > r.x && x0 < r.x + r.w && z1 > r.z && z0 < r.z + r.d;
};
const components = (l: Layout): number => {
  const parent = l.walk.nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  for (const [i, j] of l.walk.edges) parent[find(i)] = find(j);
  return new Set(l.walk.nodes.map((_, i) => find(i))).size;
};

const SHAPES: [reactors: number, baySize: number, analyzers: number][] = [];
for (const baySize of [12, 6, 25]) for (const reactors of [5, 6, 7, 12, 13, 24, 25, 36, 37, 50, 73, 99, 100]) for (const analyzers of [1, 2, 3, 4, 5, 6]) SHAPES.push([reactors, baySize, analyzers]);

describe("the properties of the layout over N from 5 to 100 and M from 1 to 6, in bays of 6, 12 and 25", () => {
  it.each(SHAPES)("%i reactors, bays of %i, %i analyzers: nothing overlaps, everything is inside the floor and within 100 metres", (reactors, baySize, analyzers) => {
    const l = layoutOf(spec(reactors, baySize, analyzers));
    expect(l.width).toBeLessThanOrEqual(100);
    expect(l.depth).toBeLessThanOrEqual(100);
    expect(l.vessels).toHaveLength(reactors);
    for (const [i, a] of l.obstacles.entries()) {
      expect(a.x >= 0 && a.z >= 0 && a.x + a.w <= l.width && a.z + a.d <= l.depth, `obstacle ${i} inside the floor`).toBe(true);
      for (const b of l.obstacles.slice(i + 1)) expect(overlap(a, b), "two obstacles overlap").toBe(false);
    }
    // two reactors never overlap: a vessel is at least a pitch (2 m) from every other and stands inside its own plinth
    for (const [i, v] of l.vessels.entries()) {
      expect(inside(v, (l.bays[v.bay] as { footprint: Rect }).footprint), `vessel ${i} inside its bay`).toBe(true);
      for (const w of l.vessels.slice(i + 1)) expect(Math.hypot(v.x - w.x, v.z - w.z), `vessels ${i} and ${w.unit}`).toBeGreaterThanOrEqual(2 - 1e-9);
    }
  });

  it.each(SHAPES)("%i reactors, bays of %i, %i analyzers: the walk graph is connected, crosses no obstacle, and every vessel, analyzer, intake and hall has an access point on it", (reactors, baySize, analyzers) => {
    const l = layoutOf(spec(reactors, baySize, analyzers));
    expect(components(l)).toBe(1);
    for (const [i, j] of l.walk.edges) for (const o of l.obstacles) expect(crosses(l.walk.nodes[i] as Point, l.walk.nodes[j] as Point, o), "an aisle crosses an obstacle").toBe(false);
    expect(onGraph(l, l.entrance)).toBe(true);
    for (const v of l.vessels) {
      expect(onGraph(l, v.access), `access of vessel ${v.unit}`).toBe(true);
      expect(Math.abs(v.access.x - v.x), "the access is in front of the vessel").toBeLessThan(1e-9);
    }
    for (const a of l.analyzers) expect(onGraph(l, a.intake), `intake of analyzer ${a.index}`).toBe(true);
    for (const h of l.halls) expect(onGraph(l, h.access), `access of hall ${h.architecture}`).toBe(true);
    for (const o of l.obstacles) for (const p of [l.entrance, ...l.vessels.map((v) => v.access), ...l.halls.map((h) => h.access), ...l.analyzers.map((a) => a.intake)]) expect(inside(p, o), "an access point inside an obstacle").toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { ScenePlan } from "../protocol.ts";
import { layoutOf } from "./layout.ts";
import type { Layout, Point, Rect } from "./layout.ts";
import { slotCount, storeWidth } from "./layout_store.ts";

// P7c (docs/design/plant_ui.md section 3.1, "As built in P7c"): the store band of a break-out case, where the lot rack, the confirmation shelf and the equipment stations stand. Every expected number is
// hand arithmetic on the metres of layout_store.ts (STORE) and layout.ts (METRES), worked once for the medium-lot case: one bay of six, two analyzers, five halls, nine lots, no equipment.
//   Working width: the bays are 14 wide (6 vessels of 2 m and 1 m at each end), the bench 7.2, the store band 8.5 (9 crates of 0.9 and 0.2 at each end) + 1 + 2.8 (6 slots of 0.4 and 0.2 at each end) =
//   12.3, so the minimum of 18 holds and the floor is 18 + 2 x (2 + 3) = 28 wide. Five halls make two rows (three fit in 18: floor((18 + 1) / 6)).
//   Bands from the north (top, depth): halls 5 and 9.2 (1.2 each), bays 13.4 (4), store 20.4 (1.2), bench 24.6 (1.2); each top is the one before plus its depth plus an aisle of 3. The floor ends at 24.6 + 1.2
//   + 3 + 2 = 30.8. The store pieces are centred as a group: 5 + (18 - 12.3) / 2 = 7.85 is the west edge of the rack.

type Spec = ScenePlan["layout"];
const HALLS = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"];
const spec = (items?: Spec["items"], halls = HALLS): Spec => ({
  bays: [{ size: 6, profile: "bench_manual" }],
  analyzers: [{ profile: "allinone_atline", group: "AIO" }, { profile: "allinone_atline", group: "AIO" }],
  architectures: halls,
  ...(items && { items }),
});
const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 9);
const at = (p: Point, x: number, z: number): void => {
  near(p.x, x);
  near(p.z, z);
};
const rect = (r: Rect | undefined, x: number, z: number, w: number, d: number, h: number): void => {
  expect(r, "the piece is there").toBeDefined();
  for (const [got, want] of [[(r as Rect).x, x], [(r as Rect).z, z], [(r as Rect).w, w], [(r as Rect).d, d], [(r as Rect).h, h]] as const) near(got, want);
};
const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);
const MEDIUM: NonNullable<Spec["items"]> = { lots: ["ML-1", "ML-2", "ML-3", ...ids("SL", 6)], equipment: [] };

describe("the medium-lot case: nine lots, no equipment", () => {
  const l = layoutOf(spec(MEDIUM));

  it("Given the shape Then the floor is 28 by 30.8 metres and the bench is 4.2 metres further south than in a run with no items", () => {
    near(l.width, 28);
    near(l.depth, 30.8);
    near(l.bench.z, 24.6);
    near(layoutOf(spec()).bench.z, 20.4);
    near(layoutOf(spec()).depth, 26.6);
  });

  it("Given the bands Then the bay is at z 13.4, the first vessel at (9, 15.4) with its access on the aisle below the bay at z 18.9, and the entrance is in front of the bench at z 27.3", () => {
    rect(l.bays[0]?.footprint, 7, 13.4, 14, 4, 2.2);
    at(l.vessels[0] as Point, 9, 15.4);
    at((l.vessels[0] as { access: Point }).access, 9, 18.9);
    at(l.entrance, 14, 27.3);
  });

  it("Given nine lots Then the rack is 8.5 wide from x 7.85, 1 deep and 1 high, and the crates stand on a pitch of 0.9 at the middle of the band (z 21), the first at x 8.5", () => {
    rect(l.rack?.footprint, 7.85, 20.5, 8.5, 1, 1);
    expect(l.rack?.crates).toHaveLength(9);
    at(l.rack?.crates[0] as Point, 8.5, 21);
    at(l.rack?.crates[8] as Point, 15.7, 21);
    expect(l.rack?.crates.map((c) => [c.index, c.tier])).toEqual(Array.from({ length: 9 }, (_, i) => [i, 0]));
  });

  it("Given six vessels Then the shelf has twelve slots, 2.8 wide from x 17.35, in two boards of six on a pitch of 0.4, the first at x 17.75 and the seventh above it", () => {
    expect(slotCount(6)).toBe(12);
    rect(l.shelf?.footprint, 17.35, 20.6, 2.8, 0.8, 1.7);
    expect(l.shelf?.slots).toHaveLength(12);
    at(l.shelf?.slots[0] as Point, 17.75, 21);
    at(l.shelf?.slots[5] as Point, 19.75, 21);
    at(l.shelf?.slots[6] as Point, 17.75, 21);
    expect(l.shelf?.slots.map((s) => s.board)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  });

  it("Given no equipment Then there is no station, and the pieces are obstacles: one bay, the bench, five halls, the rack and the shelf", () => {
    expect(l.stations).toEqual([]);
    expect(l.obstacles).toHaveLength(9);
    expect(l.obstacles).toContainEqual(l.rack?.footprint);
    expect(l.obstacles).toContainEqual(l.shelf?.footprint);
  });
});

describe("the equipment case: eight lots and two stations", () => {
  // the rack is 8 x 0.9 + 0.4 = 7.6, the shelf 2.8, the stations 2 x 1.8 - 0.4 = 3.2: 13.6 and two gaps of 1 make 15.6, so the group starts at 5 + (18 - 15.6) / 2 = 6.2, the shelf at 6.2 + 7.6 + 1 = 14.8
  // and the stations at 14.8 + 2.8 + 1 = 18.6
  const l = layoutOf(spec({ lots: ["ML-1", "ML-2", ...ids("SL", 6)], equipment: ["TL-1", "TL-2"] }));

  it("Given the pieces Then the rack starts at x 6.2, the shelf at 14.8 and the stations at 18.6 and 20.4, each 1.4 by 1, 1.5 high, in the middle of the band", () => {
    near(l.rack?.footprint.x as number, 6.2);
    near(l.shelf?.footprint.x as number, 14.8);
    expect(l.stations.map((s) => s.index)).toEqual([0, 1]);
    rect(l.stations[0], 18.6, 20.5, 1.4, 1, 1.5);
    rect(l.stations[1], 20.4, 20.5, 1.4, 1, 1.5);
    at(l.rack?.crates[0] as Point, 6.85, 21);
  });
});

describe("a store wider than the working width", () => {
  // 14 lots: twelve in a row and two on a second tier (0.5 up); the rack is 12 x 0.9 + 0.4 = 11.2 and 1.5 high; four stations 4 x 1.8 - 0.4 = 6.8; with the shelf 2.8 and two gaps the band is 22.8 wide
  const l = layoutOf(spec({ lots: ids("ML", 14), equipment: ids("TL", 4) }));

  it("Given 14 lots and 4 stations Then the working width grows to 22.8, the floor is 32.8 wide, and the thirteenth and fourteenth crates stand on the second tier at the west of the rack", () => {
    near(storeWidth({ lots: ids("ML", 14), equipment: ids("TL", 4) }), 22.8);
    near(l.width, 32.8);
    near(l.rack?.footprint.h as number, 1.5);
    expect(l.rack?.crates.map((c) => c.tier)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    near((l.rack?.crates[12] as Point).x, (l.rack?.crates[0] as Point).x);
    near((l.rack?.crates[13] as Point).x, (l.rack?.crates[1] as Point).x);
  });
});

describe("the layout with and without items", () => {
  it("Given a run with no items Then there is no rack, no shelf and no station, and the layout is the one of every other run", () => {
    const l = layoutOf(spec());
    expect([l.rack, l.shelf, l.stations]).toEqual([null, null, []]);
    expect(l.obstacles).toHaveLength(7);
  });

  it("Given items Then everything else of the layout is the same but for the bench side, the lanes and the floor depth (4.2 metres further south)", () => {
    const a = layoutOf(spec());
    const b = layoutOf(spec(MEDIUM));
    expect(b.bays).toEqual(a.bays);
    expect(b.halls).toEqual(a.halls);
    expect(b.vessels).toEqual(a.vessels);
    near(b.bench.z - a.bench.z, 4.2);
    near(b.depth - a.depth, 4.2);
    near(b.entrance.z - a.entrance.z, 4.2);
  });

  it("Given the ids of the lots in another hand Then the places are the same: they depend on how many, not on which", () => {
    const a = layoutOf(spec({ lots: ["a", "b", "c"], equipment: ["x"] }));
    const b = layoutOf(spec({ lots: ["SL-A", "SL-B", "ML-9"], equipment: ["TL-7"] }));
    expect(b).toEqual(a);
  });
});

// ---- the properties of the walk graph, over the five cases' shapes and wider ones --------------------------------------

const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const crosses = (a: Point, b: Point, r: Rect): boolean => Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w && Math.max(a.z, b.z) > r.z && Math.min(a.z, b.z) < r.z + r.d;
const components = (l: Layout): number => {
  const parent = l.walk.nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  for (const [i, j] of l.walk.edges) parent[find(i)] = find(j);
  return new Set(l.walk.nodes.map((_, i) => find(i))).size;
};

describe.each([[0, 0], [9, 0], [8, 2], [9, 1], [14, 4], [1, 6]] as const)("%i lots and %i stations", (lots, stations) => {
  const l = layoutOf(spec({ lots: ids("ML", lots), equipment: ids("TL", stations) }));

  it("Given the shape Then nothing overlaps, everything is inside the floor, the walk graph is connected and crosses no obstacle", () => {
    for (const [i, a] of l.obstacles.entries()) {
      expect(a.x >= 0 && a.z >= 0 && a.x + a.w <= l.width && a.z + a.d <= l.depth, `obstacle ${i} inside the floor`).toBe(true);
      for (const b of l.obstacles.slice(i + 1)) expect(overlap(a, b), "two obstacles overlap").toBe(false);
    }
    expect(components(l)).toBe(1);
    for (const [i, j] of l.walk.edges) for (const o of l.obstacles) expect(crosses(l.walk.nodes[i] as Point, l.walk.nodes[j] as Point, o), "an aisle crosses an obstacle").toBe(false);
  });

  it("Given the crates and the slots Then each is inside its piece", () => {
    for (const c of l.rack?.crates ?? []) expect(c.x > (l.rack as { footprint: Rect }).footprint.x && c.x < (l.rack as { footprint: Rect }).footprint.x + (l.rack as { footprint: Rect }).footprint.w).toBe(true);
    for (const s of l.shelf?.slots ?? []) expect(s.x > (l.shelf as { footprint: Rect }).footprint.x && s.x < (l.shelf as { footprint: Rect }).footprint.x + (l.shelf as { footprint: Rect }).footprint.w).toBe(true);
    expect(l.rack === null).toBe(lots === 0);
    expect(l.stations).toHaveLength(stations);
  });
});

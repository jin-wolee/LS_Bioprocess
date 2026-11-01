import { describe, expect, it } from "vitest";
import type { ScenePlan } from "../protocol.ts";
import { layoutOf } from "./layout.ts";
import type { Point } from "./layout.ts";
import { RADIUS, advance, blockedAt, lengthOf, nearestOnGraph, pathOf, stepTo } from "./walk.ts";

// docs/design/plant_ui.md section 3.4: click-to-walk follows the walk graph (no walking through a vessel); keyboard walking slides along what blocks it. Pure functions of the layout, so no WebGL.
// The default floor, by hand (see layout.test.ts): outer aisles at x 3.5 and 37.5, an aisle between the two bays at x 20.5, aisle lines at z 3.5, 7.7, 16.7 and 20.9; bay 1 is x 5 to 19 and
// z 9.2 to 15.2, bay 2 is x 22 to 36; the bench is x 16.9 to 24.1, z 18.2 to 19.4; the entrance is (20.5, 20.9); the halls' access points are (14.5, 7.7), (20.5, 7.7) and (26.5, 7.7).

const spec: ScenePlan["layout"] = {
  bays: [{ size: 12, profile: "bench_manual" }, { size: 12, profile: "bench_manual" }],
  analyzers: [{ profile: "allinone_atline", group: "AIO" }, { profile: "allinone_atline", group: "AIO" }],
  architectures: ["a_manual", "b_lims_lite", "c_context"],
};
const l = layoutOf(spec);
const same = (a: Point, b: Point): void => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
};

describe("nearestOnGraph", () => {
  it("Given a point in the bay (10, 12) Then the nearest aisle point is on the line z 7.7 (4.3 away, against 4.7 to z 16.7 and 6.5 to x 3.5)", () => {
    same(nearestOnGraph(l.walk, { x: 10, z: 12 }).point, { x: 10, z: 7.7 });
  });
  it("Given a point on an aisle Then it is its own nearest point", () => {
    same(nearestOnGraph(l.walk, { x: 20.5, z: 12 }).point, { x: 20.5, z: 12 });
  });
  it("Given a point beyond the end of an aisle Then the nearest point is the end node", () => {
    same(nearestOnGraph(l.walk, { x: 0, z: 0 }).point, { x: 3.5, z: 3.5 });
  });
});

describe("pathOf: along the aisles", () => {
  it("Given the entrance and the first hall Then the path goes west along the front of the bench, north along the outer aisle, then east to the hall: 17 + 13.2 + 11 = 41.2 m", () => {
    const hall = (l.halls[0] as { access: Point }).access;
    const path = pathOf(l, l.entrance, hall);
    expect(path).toHaveLength(4);
    same(path[0] as Point, l.entrance);
    same(path[1] as Point, { x: 3.5, z: 20.9 });
    same(path[2] as Point, { x: 3.5, z: 7.7 });
    same(path[3] as Point, hall);
    expect(lengthOf(path)).toBeCloseTo(41.2, 9);
  });

  it("Given a hall in the east Then the shorter way round is taken: from the entrance to (26.5, 7.7) it is east, north, west: 17 + 13.2 + 11 = 41.2 m, the same as to the first hall by the west", () => {
    const path = pathOf(l, l.entrance, (l.halls[2] as { access: Point }).access);
    same(path[1] as Point, { x: 37.5, z: 20.9 });
    expect(lengthOf(path)).toBeCloseTo(41.2, 9);
  });

  it("Given a click inside a bay (a vessel) Then the walk ends at the aisle point nearest to it, never inside the bay", () => {
    const path = pathOf(l, l.entrance, { x: 10, z: 12 });
    same(path[path.length - 1] as Point, { x: 10, z: 7.7 });
    for (const p of path) expect(blockedAt(l, p)).toBe(false);
  });

  it("Given a click in the open aisle beside the point it snaps to Then the walk ends at the click itself", () => {
    const click = { x: 21.5, z: 12 };
    const path = pathOf(l, l.entrance, click);
    same(path[path.length - 1] as Point, click);
  });

  it("Given a start that is not on an aisle Then the path begins at the start and goes first to the aisle", () => {
    const from = { x: 21.5, z: 12 }; // in the aisle between the bays (x 19 to 22), off its middle line
    const path = pathOf(l, from, (l.halls[0] as { access: Point }).access);
    same(path[0] as Point, from);
    same(path[1] as Point, { x: 20.5, z: 12 });
  });

  it("Given two points on one aisle Then the path is the straight line between them", () => {
    const path = pathOf(l, { x: 20.5, z: 9 }, { x: 20.5, z: 14 });
    expect(path).toHaveLength(2);
    expect(lengthOf(path)).toBeCloseTo(5, 9);
  });

  it("Given every vessel's access point from the entrance, and a grid of clicks over the whole floor Then every point of every path is outside the obstacles", () => {
    for (const v of l.vessels) for (const p of pathOf(l, l.entrance, v.access)) expect(blockedAt(l, p), `to unit ${v.unit}`).toBe(false);
    for (let x = 0.5; x < l.width; x += 4) {
      for (let z = 0.5; z < l.depth; z += 3) {
        const path = pathOf(l, l.entrance, { x, z });
        for (const p of path) expect(blockedAt(l, p), `click (${x}, ${z})`).toBe(false);
      }
    }
  });
});

describe("blockedAt and stepTo: the keyboard", () => {
  it("Given a point inside a bay, within a radius of one, or outside the floor Then it is blocked; an aisle point is free", () => {
    expect(RADIUS).toBe(0.35);
    expect(blockedAt(l, { x: 10, z: 12 })).toBe(true);
    expect(blockedAt(l, { x: 4.8, z: 12 })).toBe(true); // 0.2 from the plinth at x 5: less than the radius of 0.35
    expect(blockedAt(l, { x: 4.5, z: 12 })).toBe(false);
    expect(blockedAt(l, { x: -1, z: 5 })).toBe(true);
    expect(blockedAt(l, { x: 0.2, z: 5 })).toBe(true); // closer to the wall than the radius
    expect(blockedAt(l, { x: 20.5, z: 12 })).toBe(false);
  });

  it("Given a step into the bay while moving along it Then the walker slides: the part of the step along the plinth is kept", () => {
    same(stepTo(l, { x: 4.5, z: 12 }, 1, 0.5), { x: 4.5, z: 12.5 });
  });

  it("Given a step straight into an obstacle Then the walker stays where it is", () => {
    same(stepTo(l, { x: 4.5, z: 12 }, 1, 0), { x: 4.5, z: 12 });
  });

  it("Given a free step Then the walker takes all of it", () => {
    same(stepTo(l, { x: 20.5, z: 12 }, 0, -2), { x: 20.5, z: 10 });
  });

  it("Given a step toward the wall Then the walker stays inside the floor", () => {
    same(stepTo(l, { x: 0.5, z: 0.5 }, -1, -1), { x: 0.5, z: 0.5 });
  });
});

describe("advance: walking along a path", () => {
  const path: Point[] = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }];
  it("Given a path of 7 m Then 5 m along it is 1 m up the second leg, and 2 m remain", () => {
    const a = advance(path, 5);
    same(a.position, { x: 4, z: 1 });
    expect(a.done).toBe(false);
    expect(lengthOf(a.rest)).toBeCloseTo(2, 9);
    same(a.rest[0] as Point, { x: 4, z: 1 });
  });
  it("Given more distance than the path has Then the walker is at its end and done", () => {
    const a = advance(path, 100);
    same(a.position, { x: 4, z: 3 });
    expect(a.done).toBe(true);
    expect(a.rest).toHaveLength(1);
  });
  it("Given no distance Then nothing moves", () => {
    same(advance(path, 0).position, { x: 0, z: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { handPlan, indexOf } from "./fixture.ts";
import { layoutOf } from "./layout.ts";
import { pickNearest, rayBox, targetsAt } from "./pick.ts";
import type { Box, Ray } from "./pick.ts";
import { sceneAt } from "./scene_at.ts";

// P5b (docs/design/plant_ui.md section 3.2, "Picking"): a click picks the nearest object along the ray. `rayBox` and `pickNearest` are plain geometry; `targetsAt` makes the boxes of the things on the
// floor at an instant from the plan and the layout (the sizes of dims.ts). Expected values are hand arithmetic on the hand plan of fixture.ts: one bay of two bench vessels, two analyzers, OP-01 on
// duty from 0 to 20000 s and OP-02 from 10000 s. Layout (scene_at.test.ts): U01 at (13, 11.2), U02 at (15, 11.2); the bench is x 10.4 to 17.6 and z 16.2 to 17.4, AN-1 at (12.8, 16.8).

const ray = (origin: [number, number, number], dir: [number, number, number]): Ray => ({ origin, dir });
const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max });

describe("rayBox: the distance along a ray to a box", () => {
  const unit = box([-1, 0, -1], [1, 2, 1]);

  it("Given a ray along -z from (0, 1, 10) at a box 2 wide Then it enters the box at the near face, 9 away", () => {
    expect(rayBox(ray([0, 1, 10], [0, 0, -1]), unit)).toBe(9);
  });

  it("Given a ray that passes beside the box, above it, or points away Then there is no hit", () => {
    expect(rayBox(ray([1.5, 1, 10], [0, 0, -1]), unit)).toBeNull();
    expect(rayBox(ray([0, 2.5, 10], [0, 0, -1]), unit)).toBeNull();
    expect(rayBox(ray([0, 1, 10], [0, 0, 1]), unit)).toBeNull();
  });

  it("Given a ray that starts inside the box Then the distance is 0", () => {
    expect(rayBox(ray([0, 1, 0], [0, 0, -1]), unit)).toBe(0);
  });

  it("Given a slanted ray from above, a descent of one metre for each metre ahead Then it enters through the top face", () => {
    // from (0, 4, 6) along (0, -1, -1) (not normalised: the distance is in units of the direction): the top face y = 2 at 2, where z = 4, outside the box; z = 1 at 5, where y = -1: it misses
    expect(rayBox(ray([0, 4, 6], [0, -1, -1]), unit)).toBeNull();
    // from (0, 4, 3) the top face is reached at 2 (z = 1, on the edge of the box) and the box is entered
    expect(rayBox(ray([0, 4, 3], [0, -1, -1]), unit)).toBe(2);
  });
});

describe("pickNearest: the nearest object along the ray", () => {
  it("Given one box behind another on the same ray Then the nearer is picked, whichever is listed first", () => {
    const near = { what: "near", box: box([-1, 0, 4], [1, 2, 5]) };
    const far = { what: "far", box: box([-1, 0, 0], [1, 2, 1]) };
    const r = ray([0, 1, 10], [0, 0, -1]);
    expect(pickNearest(r, [far, near])).toEqual({ what: "near", t: 5 });
    expect(pickNearest(r, [near, far])).toEqual({ what: "near", t: 5 });
  });

  it("Given a ray that passes the near box and meets only the far one Then the far one is picked", () => {
    const near = { what: "near", box: box([3, 0, 4], [5, 2, 5]) };
    const far = { what: "far", box: box([-1, 0, 0], [1, 2, 1]) };
    expect(pickNearest(ray([0, 1, 10], [0, 0, -1]), [near, far])).toEqual({ what: "far", t: 9 });
  });

  it("Given a hit of another kind that is nearer (a card, from the arithmetic of the shelves) Then it wins, and when it is farther the box wins", () => {
    const b = { what: "box", box: box([-1, 0, 4], [1, 2, 5]) };
    const r = ray([0, 1, 10], [0, 0, -1]);
    expect(pickNearest(r, [b], [{ what: "card", t: 3 }])).toEqual({ what: "card", t: 3 });
    expect(pickNearest(r, [b], [{ what: "card", t: 8 }])).toEqual({ what: "box", t: 5 });
  });

  it("Given no box on the ray and no other hit Then nothing is picked", () => {
    expect(pickNearest(ray([0, 1, 10], [0, 0, -1]), [{ what: "x", box: box([5, 0, 0], [6, 1, 1]) }])).toBeNull();
    expect(pickNearest(ray([0, 1, 10], [0, 0, -1]), [])).toBeNull();
  });
});

describe("targetsAt: the things on the floor at an instant", () => {
  const plan = handPlan();
  const layout = layoutOf(plan.layout);
  const targets = (t: number) => targetsAt(plan, layout, sceneAt(plan, t));
  const of = (t: number, kind: string, index: number) => targets(t).find((x) => x.what.kind === kind && x.what.index === index);
  const close = (b: Box | undefined, min: number[], max: number[]): void => {
    expect(b).toBeDefined();
    for (let k = 0; k < 3; k++) {
      expect(b?.min[k]).toBeCloseTo(min[k] as number, 6);
      expect(b?.max[k]).toBeCloseTo(max[k] as number, 6);
    }
  };

  it("Given the bench vessel U01 at (13, 11.2), a radius of 0.42 m and a height of 1 m on the plinth of 0.2 m Then its box is x 12.58 to 13.42, y 0 to 1.2, z 10.78 to 11.62", () => {
    close(of(0, "reactor", 0)?.box, [12.58, 0, 10.78], [13.42, 1.2, 11.62]);
    close(of(0, "reactor", 1)?.box, [14.58, 0, 10.78], [15.42, 1.2, 11.62]);
  });

  it("Given AN-1 at (12.8, 16.8), a body of 1.5 by 0.85 by 0.75 m on the bench top at 1.2 m Then its box is x 12.05 to 13.55, y 1.2 to 2.05, z 16.425 to 17.175", () => {
    close(of(0, "analyzer", 0)?.box, [12.05, 1.2, 16.425], [13.55, 2.05, 17.175]);
  });

  it("Given 5000 s, when OP-01 is on duty and OP-02 is not Then only OP-01 can be picked; at 12000 s both can", () => {
    expect(targets(5000).filter((x) => x.what.kind === "staff").map((x) => x.what.index)).toEqual([0]);
    expect(targets(12000).filter((x) => x.what.kind === "staff").map((x) => x.what.index)).toEqual([0, 1]);
  });

  it("Given OP-01 resting at home (15.6, 18.9) at 5000 s Then the box is 0.6 m square and 1.5 m tall about the figure", () => {
    close(of(5000, "staff", 0)?.box, [15.3, 0, 18.6], [15.9, 1.5, 19.2]);
  });

  it("Given the tube of U01-D00-1 in the hand at 2030 s, at the access of U01 (13, 14.7) held 0.32 m toward the vessel Then its box is 0.6 m square from 0.05 m under its base to 0.8 m over it", () => {
    const tube = targets(2030).find((x) => x.what.kind === "sample" && x.what.index === indexOf(plan, "U01-D00-1"));
    close(tube?.box, [12.7, 1.0, 14.08], [13.3, 1.85, 14.68]);
  });

  it("Given a sample that has no tube on the floor yet or any more Then it cannot be picked", () => {
    expect(of(1000, "sample", indexOf(plan, "U01-D00-1"))).toBeUndefined();
    expect(of(39000, "sample", indexOf(plan, "U01-D00-1"))).toBeUndefined();
    expect(of(5000, "sample", indexOf(plan, "U02-D00-2"))).toBeUndefined(); // a skipped draw has no tube
  });

  it("Given a ray along -z at the height of a vessel over the tube of an operator behind it Then the vessel is picked and the figure behind it is not (an object behind another is not picked)", () => {
    // U01's box is z 10.78 to 11.62; OP-01 at home is at z 18.9, in front (south) of it; from the north (z = 5) the ray along +z meets the vessel first and then the bench, never the figure
    const r = ray([13, 0.6, 5], [0, 0, 1]);
    expect(pickNearest(r, targets(5000))?.what).toEqual({ kind: "reactor", index: 0 });
    // from the south the figure at home is x 15.3 to 15.9: a ray at x 15.6 along -z meets the figure (z 19.2) before the analyzer AN-2 (x 14.45 to 15.95, z 16.425 to 17.175, at 1.2 to 2.05 m)
    const south = ray([15.6, 1.4, 25], [0, 0, -1]);
    expect(pickNearest(south, targets(5000))?.what).toEqual({ kind: "staff", index: 0 });
    // the same ray at a height of 1.6 m passes over the 1.5 m figure and meets the analyzer
    expect(pickNearest(ray([15.6, 1.6, 25], [0, 0, -1]), targets(5000))?.what).toEqual({ kind: "analyzer", index: 1 });
  });
});

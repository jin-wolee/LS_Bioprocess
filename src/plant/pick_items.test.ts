import { describe, expect, it } from "vitest";
import { casePlan } from "./fixture_case.ts";
import { layoutOf } from "./layout.ts";
import { pickNearest, targetsAt } from "./pick.ts";
import { itemTargets } from "./pick_items.ts";
import { sceneAt } from "./scene_at.ts";

// P7c (docs/design/plant_ui.md section 3.2, "As built in P7c"): what a click can reach in the store of a case: a crate, a station and a confirming tube on the shelf. Pure geometry, no three.js.
// Worked once for fixture_case.ts: one bay of two, two analyzers, two halls, three lots and one station. The working width is the minimum of 18; the bands from the north (top, depth) are halls 5 (1.2), the
// bay 9.2 (4), the store 16.2 (1.2) and the bench 20.4. The store is 3.1 (three crates: 3 x 0.9 + 0.4) + 1 + 2.8 + 1 + 1.4 = 9.3 wide, centred: it starts at 5 + (18 - 9.3) / 2 = 9.35. The crates stand at
// x 10, 10.9 and 11.8 (9.35 + 0.2 + 0.45 and every 0.9), z 16.8, on a board 0.5 high, and are 0.7 square and 0.45 tall; the shelf starts at 9.35 + 3.1 + 1 = 13.45 and its first slot is at x 13.85; the
// station starts at 13.45 + 2.8 + 1 = 17.25, is 1.4 by 1 and 1.5 high, from z 16.3.

const plan = casePlan();
const layout = layoutOf(plan.layout);
const near = (a: number | undefined, b: number): void => expect(a).toBeCloseTo(b, 9);

describe("the targets of the store", () => {
  it("Given the start of the run Then the crates and the station are there and no tube", () => {
    expect(itemTargets(plan, layout, 0).map((t) => t.what)).toEqual([{ kind: "lot", index: 0 }, { kind: "lot", index: 1 }, { kind: "lot", index: 2 }, { kind: "equipment", index: 0 }]);
  });

  it("Given 12000 s Then the three confirming tubes on the shelf are targets too (the sample indices 8, 9 and 11; the skipped draw has none)", () => {
    expect(itemTargets(plan, layout, 12000).map((t) => t.what).slice(4)).toEqual([{ kind: "confirm", index: 8 }, { kind: "confirm", index: 9 }, { kind: "confirm", index: 11 }]);
    expect(itemTargets(plan, layout, 9000).map((t) => t.what).slice(4)).toEqual([{ kind: "confirm", index: 8 }, { kind: "confirm", index: 9 }]);
  });

  it("Given the first crate Then its box is 0.7 square about (10, 16.8), from the board at 0.5 to 0.95", () => {
    const box = itemTargets(plan, layout, 0)[0]?.box;
    [9.65, 0.5, 16.45].forEach((v, k) => near(box?.min[k], v));
    [10.35, 0.95, 17.15].forEach((v, k) => near(box?.max[k], v));
  });

  it("Given the station Then its box is the footprint from the floor to 1.5", () => {
    const box = itemTargets(plan, layout, 0)[3]?.box;
    [17.25, 0, 16.3].forEach((v, k) => near(box?.min[k], v));
    [18.65, 1.5, 17.3].forEach((v, k) => near(box?.max[k], v));
  });

  it("Given the first tube on the shelf Then its box is 0.4 square about (13.85, 16.8), from just under the board at 0.8 to 0.8 above it", () => {
    const box = itemTargets(plan, layout, 9000).find((t) => "index" in t.what && t.what.index === 8)?.box;
    [13.65, 0.75, 16.6].forEach((v, k) => near(box?.min[k], v));
    [14.05, 1.6, 17].forEach((v, k) => near(box?.max[k], v));
  });

  it("Given a thirteenth lot Then its crate stands on the second tier, 0.5 higher", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `L-${String(i + 1).padStart(2, "0")}`);
    const many = { ...plan, layout: { ...plan.layout, items: { lots: ids, equipment: ["TL-1"] } }, lots: ids.map((id) => ({ id, kind: "medium" as const, uses: [] })) };
    const box = itemTargets(many, layoutOf(many.layout), 0)[12]?.box;
    near(box?.min[1], 1);
    near(box?.max[1], 1.45);
  });
});

describe("a click on the store, with the rest of the floor", () => {
  const ray = (x: number, z: number) => ({ origin: [x, 5, z] as [number, number, number], dir: [0, -1, 0] as [number, number, number] });
  const pick = (x: number, z: number, t: number) => pickNearest(ray(x, z), targetsAt(plan, layout, sceneAt(plan, t)))?.what;

  it("Given a ray straight down on the second crate, the station and a tube Then each is the pick", () => {
    expect(pick(10.9, 16.8, 0)).toEqual({ kind: "lot", index: 1 });
    expect(pick(18, 16.8, 0)).toEqual({ kind: "equipment", index: 0 });
    expect(pick(13.85, 16.8, 9000)).toEqual({ kind: "confirm", index: 8 });
  });

  it("Given a ray down on the floor beside them Then nothing is picked", () => {
    expect(pick(20, 16.8, 9000)).toBeUndefined();
    expect(pick(13.85, 16.8, 0)).toBeUndefined(); // the slot is empty before the draw
  });
});

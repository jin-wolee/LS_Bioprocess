import { describe, expect, it } from "vitest";
import { focusOf } from "./focus.ts";
import { handPlan } from "./fixture.ts";
import { layoutOf } from "./layout.ts";

// P6a (docs/design/plant_ui.md section 3.2, "As built in P6a"): the camera is brought to a sampling board from the objects list. The expected point is hand arithmetic on the metres of the layout: the hand
// plan has one bay of two vessels (6 m by 4 m), so the inner width is 18 m (the least), the walls and aisles put the first band of halls at z = 5 m, the bay band at z = 5 + 1.2 + 3 = 9.2 m, and the bay at
// x = 5 + (18 - 6) / 2 = 11 m. The board stands 1.1 m from the west end of the bay and 0.12 m inside its north edge.

describe("where the camera goes for a board", () => {
  const plan = handPlan();
  const layout = layoutOf(plan.layout);

  it("Given the key of the board of the first bay Then the camera comes to the post at the west end of its north edge", () => {
    const target = focusOf(plan, layout, "board:B1", () => null);
    expect(target?.at.x).toBeCloseTo(12.1, 9);
    expect(target?.at.z).toBeCloseTo(9.32, 9);
    expect(target?.radius).toBe(1.2);
  });

  it("Given the key of a board the plan has no bay for Then there is nowhere to go", () => {
    expect(focusOf(plan, layout, "board:B2", () => null)).toBeNull();
    expect(focusOf(plan, layout, "board:B0", () => null)).toBeNull();
  });
});

// P8b (docs/design/plant_ui.md section 3.5): the first two steps of the tour look at a reactor and at the aisle in front of it, where the operator stands for the draw: the hand plan has U01 at (13, 11.2) and
// its access point at (13, 14.7), so the middle between them is (13, 12.95), and the camera comes to 8 m, a radius of 1.6 m.
describe("where the camera goes for a reactor and the operator at it", () => {
  const plan = handPlan();
  const layout = layoutOf(plan.layout);

  it("Given the key station:U01 Then the camera looks at the middle between the vessel and its access point", () => {
    const target = focusOf(plan, layout, "station:U01", () => null);
    expect(target?.at.x).toBeCloseTo(13, 9);
    expect(target?.at.z).toBeCloseTo(12.95, 9);
    expect(target?.radius).toBeCloseTo(1.6, 9);
  });

  it("Given a reactor the plan does not have Then there is nowhere to go", () => {
    expect(focusOf(plan, layout, "station:U09", () => null)).toBeNull();
  });
});

// The fourth step of the tour looks at the three record halls side by side, level with the shelves. Hand arithmetic on the metres of the layout (the default plant, two bays of twelve and three halls): the
// floor is 41 m wide and the halls (5 m long on a 6 m pitch) are centred in it, at x 12, 18 and 24, 5 m from the north edge and 1.2 m deep, so their middle is x = 41 / 2 = 20.5 and z = 5 + 1.2 / 2 = 5.6.
// Three halls span 17 m, which the camera takes in from the furthest it goes in (18 m): a radius of 3.6 m. The box of the tour covers the left third of the view, so the camera looks 2.6 m west of that
// middle and the row of halls stands to the right of the centre of the picture, clear of the box: x = 20.5 - 2.6 = 17.9.
describe("where the camera goes for the row of halls", () => {
  const wide = { ...handPlan(), layout: { bays: [{ size: 12, profile: "bench_manual" }, { size: 12, profile: "bench_manual" }], analyzers: [{ profile: "allinone_atline", group: "AIO" }, { profile: "allinone_atline", group: "AIO" }], architectures: ["a_manual", "b_lims_lite", "c_context"] } };

  it("Given the key halls:all Then the camera looks at the middle of the row of halls, level with the shelves, from as far as it goes", () => {
    const target = focusOf(wide, layoutOf(wide.layout), "halls:all", () => null);
    expect(target?.at.x).toBeCloseTo(17.9, 9);
    expect(target?.at.z).toBeCloseTo(5.6, 9);
    expect(target?.radius).toBeCloseTo(3.6, 9);
    expect(target?.pitch).toBe(0.2);
  });

  it("Given a layout with one hall Then the camera looks 2.6 m west of that hall's middle", () => {
    const one = { ...wide, layout: { ...wide.layout, architectures: ["a_manual"] } };
    const l = layoutOf(one.layout);
    const h = l.halls[0]?.footprint as { x: number; z: number; w: number; d: number };
    const target = focusOf(one, l, "halls:all", () => null);
    expect(target?.at.x).toBeCloseTo(h.x + h.w / 2 - 2.6, 9);
    expect(target?.at.z).toBeCloseTo(h.z + h.d / 2, 9);
  });
});

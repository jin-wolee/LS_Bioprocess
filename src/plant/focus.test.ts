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

import { describe, expect, it } from "vitest";
import { focusOf } from "./focus.ts";
import { casePlan } from "./fixture_case.ts";
import { layoutOf } from "./layout.ts";

// P7c (docs/design/plant_ui.md section 3.4 and 9): the camera is brought to a lot, an equipment item or a confirming tube by its key. The places are those worked out in pick_items.test.ts for the case of
// fixture_case.ts: crates at x 10, 10.9 and 11.8, the first shelf slot at x 13.85, the station from x 17.25 (1.4 wide) and z 16.3 (1 deep), the middle of the band at z 16.8.

const plan = casePlan();
const layout = layoutOf(plan.layout);
const none = () => null;
const near = (a: number | undefined, b: number): void => expect(a).toBeCloseTo(b, 9);

describe("focusOf in a case", () => {
  it("Given a lot Then the camera looks at its crate", () => {
    const f = focusOf(plan, layout, "lot:ML-2", none);
    near(f?.at.x, 10.9);
    near(f?.at.z, 16.8);
  });

  it("Given an equipment item Then the camera looks at the middle of its station", () => {
    const f = focusOf(plan, layout, "equipment:TL-1", none);
    near(f?.at.x, 17.95);
    near(f?.at.z, 16.8);
  });

  it("Given a confirming tube Then the camera looks at its slot, whatever the instant (the slot is the sample's own)", () => {
    const f = focusOf(plan, layout, "confirm:U01-CONF", none);
    near(f?.at.x, 13.85);
    near(f?.at.z, 16.8);
    near(focusOf(plan, layout, "confirm:U02-CONF", none)?.at.x, 14.25);
  });

  it("Given a key the plan does not hold Then there is nowhere to look", () => {
    for (const key of ["lot:nonesuch", "equipment:TL-9", "confirm:U02-SIG-CONF", "confirm:U01-D00-1"]) expect(focusOf(plan, layout, key, none), key).toBeNull();
  });
});

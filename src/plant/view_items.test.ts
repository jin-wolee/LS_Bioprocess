import { describe, expect, it } from "vitest";
import { casePlan } from "./fixture_case.ts";
import { handPlan } from "./fixture.ts";
import { countsOf, keyOf, objectsOf, pickedOfKey } from "./view.ts";

// P7c (docs/design/plant_ui.md sections 3.2 and 9, "As built in P7c"): the objects of a break-out case. The lots, the equipment items and the confirming tubes join the objects list and the picks; a
// plan that is not a case has none of them, and its objects and counts are what they were. Expected values are typed by hand from the case of fixture_case.ts.

describe("the objects of a case", () => {
  const plan = casePlan();

  it("Given the case Then the lots, the equipment items and the confirming tubes follow the flags board, in the order of the plan, and a draw skipped for the volume budget has no tube", () => {
    const objects = objectsOf(plan);
    expect(objects.slice(-7).map((o) => [o.kind, o.key, o.id])).toEqual([
      ["lot", "lot:ML-1", "ML-1"], ["lot", "lot:ML-2", "ML-2"], ["lot", "lot:SL-A", "SL-A"], ["equipment", "equipment:TL-1", "TL-1"],
      ["confirm", "confirm:U01-CONF", "U01-CONF"], ["confirm", "confirm:U02-CONF", "U02-CONF"], ["confirm", "confirm:U01-SIG-CONF", "U01-SIG-CONF"],
    ]);
    expect(objects.find((o) => o.key === "confirm:U02-SIG-CONF")).toBeUndefined();
    expect(objects.filter((o) => o.kind === "confirm").map((o) => o.index)).toEqual([8, 9, 11]);
  });

  it("Given the case Then the counts have the three more kinds: 3 lots, 1 equipment item and 3 confirming tubes", () => {
    expect(countsOf(objectsOf(plan))).toEqual({ reactor: 2, analyzer: 2, staff: 2, hall: 2, board: 1, flags: 1, lot: 3, equipment: 1, confirm: 3 });
  });

  it("Given a plan that is not a case Then the objects and the counts are what they were, six kinds", () => {
    expect(countsOf(objectsOf(handPlan()))).toEqual({ reactor: 2, analyzer: 2, staff: 2, hall: 1, board: 1, flags: 1 });
    expect(objectsOf(handPlan()).some((o) => o.kind === "lot" || o.kind === "equipment" || o.kind === "confirm")).toBe(false);
  });
});

describe("the picks of a case", () => {
  const plan = casePlan();

  it("Given a lot, an equipment item and a confirming sample Then each has its key", () => {
    expect(keyOf(plan, { kind: "lot", index: 2 })).toBe("lot:SL-A");
    expect(keyOf(plan, { kind: "equipment", index: 0 })).toBe("equipment:TL-1");
    expect(keyOf(plan, { kind: "confirm", index: 11 })).toBe("confirm:U01-SIG-CONF");
    expect(keyOf(plan, { kind: "sample", index: 0 })).toBe("sample:U01-D00-1");
  });

  it("Given a key Then it names the pick, and a confirming sample is a confirm pick whether it is named as a sample or as a confirm (it is never a tube)", () => {
    expect(pickedOfKey(plan, "lot:ML-2")).toEqual({ kind: "lot", index: 1 });
    expect(pickedOfKey(plan, "equipment:TL-1")).toEqual({ kind: "equipment", index: 0 });
    expect(pickedOfKey(plan, "confirm:U01-SIG-CONF")).toEqual({ kind: "confirm", index: 11 });
    expect(pickedOfKey(plan, "sample:U01-CONF")).toEqual({ kind: "confirm", index: 8 });
    expect(pickedOfKey(plan, "sample:U01-D00-1")).toEqual({ kind: "sample", index: 0 });
    expect(pickedOfKey(plan, "reactor:U02")).toEqual({ kind: "reactor", index: 1 });
  });

  it("Given a key the plan does not hold, or a kind it has no list for Then there is no pick", () => {
    for (const key of ["lot:nonesuch", "equipment:TL-9", "confirm:U01-D00-1", "lot:", "hall:a_manual"]) expect(pickedOfKey(plan, key), key).toBeNull();
    expect(pickedOfKey(handPlan(), "lot:ML-1")).toBeNull();
    expect(pickedOfKey(handPlan(), "equipment:TL-1")).toBeNull();
  });
});

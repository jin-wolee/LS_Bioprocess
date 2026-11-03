import { describe, expect, it } from "vitest";
import { casePlan } from "./fixture_case.ts";
import { handPlan } from "./fixture.ts";
import { panelOf } from "./panels.ts";
import { confirmOf, equipmentOf, lotOf, reactorItemsOf } from "./panels_items.ts";

// P7c (docs/design/plant_ui.md section 3.2 and 7, "As built in P7c"): the panels of a lot, an equipment item and a confirming sample, and what the panel of a reactor adds in a case. A panel is a pure
// function of the plan, the instant and the hall the lens reads; a count is a count of the plan's rows with an instant not later than `t`, a result that has not been reported is null (the panel never
// shows an outcome before its instant), and the tape is the lens hall's own. Expected values are typed by hand from the case of fixture_case.ts.

const plan = casePlan();
const C = "c_context";

describe("the panel of a lot", () => {
  it("Given ML-1 at 10000 s Then it is a medium lot used twice, at 3000 s on U01 and on U02, and its tape in c_context is quarantined (placed at 7500 s, quarantined at 10000 s)", () => {
    expect(lotOf(plan, 0, 10000, C)).toEqual({ kind: "lot", id: "ML-1", lot_kind: "medium", used: 2, uses: [{ unit: "U01", t: 3000 }, { unit: "U02", t: 3000 }], tape: "quarantined" });
  });

  it("Given SL-A at 0, 1500 and 2500 s Then it is a seed lot used none, once and twice, the newest first", () => {
    expect(lotOf(plan, 2, 0, C)).toMatchObject({ lot_kind: "seed", used: 0, uses: [] });
    expect(lotOf(plan, 2, 1500, C)).toMatchObject({ used: 1, uses: [{ unit: "U01", t: 1000 }] });
    expect(lotOf(plan, 2, 2500, C)).toMatchObject({ used: 2, uses: [{ unit: "U02", t: 2000 }, { unit: "U01", t: 1000 }] });
  });

  it("Given the other hall as the lens Then the tape is that hall's own: a_manual holds no lot", () => {
    expect(lotOf(plan, 0, 10000, "a_manual").tape).toBeNull();
    expect(lotOf(plan, 0, 7500, C).tape).toBe("held");
    expect(lotOf(plan, 0, 25000, C).tape).toBeNull();
  });

  it("Given panelOf Then the pick of a lot gives the same panel", () => {
    expect(panelOf(plan, { kind: "lot", index: 0 }, 10000, C)).toEqual(lotOf(plan, 0, 10000, C));
  });
});

describe("the panel of an equipment item", () => {
  it("Given TL-1 at 10000 s Then it was used on U01 at 4000 s and on U02 at 8000 s, newest first, and it is held", () => {
    expect(equipmentOf(plan, 0, 10000, C)).toEqual({ kind: "equipment", id: "TL-1", used: 2, uses: [{ unit: "U02", t: 8000 }, { unit: "U01", t: 4000 }], tape: "held" });
    expect(equipmentOf(plan, 0, 5000, C)).toMatchObject({ used: 1, uses: [{ unit: "U01", t: 4000 }], tape: null });
    expect(panelOf(plan, { kind: "equipment", index: 0 }, 10000, C)).toEqual(equipmentOf(plan, 0, 10000, C));
  });
});

describe("the panel of a confirming sample", () => {
  it("Given U01-CONF before its draw Then nothing is ordered yet: no draw, no tests", () => {
    expect(confirmOf(plan, 8, 8999)).toEqual({ kind: "confirm", id: "U01-CONF", unit: "U01", operator: "OP-01", drawn_s: null, tests: [] });
  });

  it("Given U01-CONF at 10000 s Then it was drawn at 9000 s and two tests wait, with no outcome", () => {
    expect(confirmOf(plan, 8, 10000)).toEqual({
      kind: "confirm", id: "U01-CONF", unit: "U01", operator: "OP-01", drawn_s: 9000,
      tests: [{ test: "bioburden", result_s: null, outcome: null }, { test: "sterility", result_s: null, outcome: null }],
    });
  });

  it("Given U01-CONF at 20000 s Then the bioburden result is reported (detected) and the sterility test is not; at 30000 s both are", () => {
    expect(confirmOf(plan, 8, 20000).tests).toEqual([{ test: "bioburden", result_s: 20000, outcome: "detected" }, { test: "sterility", result_s: null, outcome: null }]);
    expect(confirmOf(plan, 8, 30000).tests).toEqual([{ test: "bioburden", result_s: 20000, outcome: "detected" }, { test: "sterility", result_s: 30000, outcome: "detected" }]);
  });

  it("Given U02-CONF at 20000 s Then it reads not detected; and panelOf gives the same panel", () => {
    expect(confirmOf(plan, 9, 20000).tests).toEqual([{ test: "bioburden", result_s: 20000, outcome: "not_detected" }]);
    expect(panelOf(plan, { kind: "confirm", index: 9 }, 20000, C)).toEqual(confirmOf(plan, 9, 20000));
  });
});

describe("what the panel of a reactor adds in a case", () => {
  it("Given U02 at 10000 s Then its signal and its deviation with their items, and its tape (quarantined)", () => {
    expect(reactorItemsOf(plan, 1, 10000, C)).toEqual({ marks: [{ kind: "signal", item: "DO", t: 7000 }, { kind: "deviation", item: "DEV-1", t: 7500 }], tape: "quarantined" });
  });

  it("Given U02 at 12000 s Then it is also listed as stopped; given U01 Then nothing was signalled on it and it is not taped", () => {
    expect(reactorItemsOf(plan, 1, 12000, C)?.marks.map((m) => m.kind)).toEqual(["signal", "deviation", "stopped"]);
    expect(reactorItemsOf(plan, 0, 12000, C)).toEqual({ marks: [], tape: null });
  });

  it("Given U02 before its signal Then the list is empty: a beacon that has not lit is not listed", () => {
    expect(reactorItemsOf(plan, 1, 6999, C)?.marks).toEqual([]);
  });

  it("Given a plan that is not a case Then there is nothing to add", () => {
    expect(reactorItemsOf(handPlan(), 0, 10000, C)).toBeNull();
  });
});

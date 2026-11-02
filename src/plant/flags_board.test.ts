import { describe, expect, it, vi } from "vitest";
import type { ScenePlan } from "../protocol.ts";
import { flagOnFor, initialFields } from "./act_form.ts";
import { FlagCells, FlagsTable } from "./FlagList.tsx";
import { FLAGS_BOARD, cellAt, cellCentre, flagMatrix, flagsFocus, flagsGeometry, hallOf } from "./flags_board.ts";
import { handPlan } from "./fixture.ts";
import { focusOf } from "./focus.ts";
import { layoutOf } from "./layout.ts";
import { countsOf, objectsOf } from "./view.ts";

// P6b (docs/design/plant_ui.md section 3.2, "As built in P6b"): the flags board. The matrix is a pure function of the plan: a row for each flag, a column for each hall of the layout, each cell the flags
// the hall's own record has. The geometry of the panel and the cell a ray meets are hand arithmetic on the constants of FLAGS_BOARD (0.5 m a cell wide, 0.22 m high, a 2.6 m column of names, a 0.32 m head,
// 0.12 m of margin, the top at 2.95 m): with a floor 24 m wide, 8 flags and 3 halls the panel is 0.12 + 2.6 + 1.5 + 0.12 = 4.34 m wide and 0.12 + 0.32 + 8 x 0.22 + 0.12 = 2.32 m high.

const FLAGS = ["system_issued_id", "two_clocks", "available_at", "audit_trail"];

/** A plan with the given halls (the layout's ids) and records (only some may have arrived yet). */
const planOf = (halls: string[], records: { architecture: string; flags_on: string[] }[]): ScenePlan => {
  const plan = handPlan();
  plan.layout = { ...plan.layout, architectures: halls };
  plan.records = records.map((r) => ({ ...r, cards: [] }));
  return plan;
};

describe("flagMatrix: a row for each flag, a column for each hall, each cell what the hall's own record has", () => {
  it("Given three halls whose records have arrived Then every cell is on or off as the record says, the rows in the order of ready.flags and the columns in the order of the layout", () => {
    const plan = planOf(["a_manual", "b_lims_lite", "c_context"], [
      { architecture: "a_manual", flags_on: [] },
      { architecture: "b_lims_lite", flags_on: ["system_issued_id", "audit_trail"] },
      { architecture: "c_context", flags_on: FLAGS },
    ]);
    const m = flagMatrix(plan, FLAGS);
    expect(m.flags).toEqual(FLAGS);
    expect(m.halls).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(m.cells).toEqual([
      [false, true, true],
      [false, false, true],
      [false, false, true],
      [false, true, true],
    ]);
  });

  it("Given a hall whose record has not arrived Then its cells are neither on nor off (null), and the others are as they are", () => {
    const plan = planOf(["a_manual", "c_context"], [{ architecture: "a_manual", flags_on: ["two_clocks"] }]);
    expect(flagMatrix(plan, FLAGS).cells).toEqual([[false, null], [true, null], [false, null], [false, null]]);
  });

  it("Given a hall derived by a set_flag Then it shows its own flags, not those of the record it was made from (here C minus audit_trail has everything but that flag, and the board says so)", () => {
    const plan = planOf(["a_manual", "c_context_minus_audit_trail"], [
      { architecture: "a_manual", flags_on: [] },
      { architecture: "c_context_minus_audit_trail", flags_on: ["system_issued_id", "two_clocks", "available_at"] },
    ]);
    const m = flagMatrix(plan, FLAGS);
    expect(m.halls).toEqual(["a_manual", "c_context_minus_audit_trail"]);
    expect(m.cells.map((row) => row[1])).toEqual([true, true, true, false]);
  });

  it("Given a flag that no record knows Then it is off in every hall that has arrived", () => {
    const plan = planOf(["a_manual"], [{ architecture: "a_manual", flags_on: ["audit_trail"] }]);
    expect(flagMatrix(plan, ["material_lot_links"]).cells).toEqual([[false]]);
  });
});

describe("the target of a cell: the record the run began with, shown by the id the plan gives the hall", () => {
  // the run asked for A and C; a first set_flag made C into c_context_minus_audit_trail, so the plan names the second hall by the derived id
  const base = ["a_manual", "c_context"];
  const plan = planOf(["a_manual", "c_context_minus_audit_trail"], [
    { architecture: "a_manual", flags_on: [] },
    { architecture: "c_context_minus_audit_trail", flags_on: ["system_issued_id", "two_clocks", "available_at"] },
  ]);

  it("Given a base id Then the hall the plan shows for it is the one at the same place", () => {
    expect(hallOf(plan, base, "c_context")).toBe("c_context_minus_audit_trail");
    expect(hallOf(plan, base, "a_manual")).toBe("a_manual");
    expect(hallOf(plan, base, "nonesuch")).toBe("nonesuch");
  });

  it("Given the derived hall Then the form offers the opposite of that hall's own flag: audit_trail is off in it, so on; two_clocks is on, so off", () => {
    expect(flagOnFor(plan, base, "c_context", "audit_trail")).toBe("true");
    expect(flagOnFor(plan, base, "c_context", "two_clocks")).toBe("false");
    expect(flagOnFor(plan, base, "a_manual", "audit_trail")).toBe("true");
  });

  it("Given a flag form on a run with a derived hall Then it starts on the first base id, never on a derived id the Worker would not find", () => {
    const fields = initialFields("set_flag", { plan, flags: FLAGS, halls: base, picked: null, at: 291600 });
    expect(fields).toEqual({ architecture: "a_manual", flag: "system_issued_id", on: "true" });
  });
});

describe("the geometry of the panel and the cell a ray meets", () => {
  const g = flagsGeometry(24, 8, 3);

  it("Given a floor 24 m wide, 8 flags and 3 halls Then the panel is centred on the floor, 4.34 m wide and 2.32 m high, with its top at 2.95 m", () => {
    expect(g.x1 - g.x0).toBeCloseTo(4.34, 9);
    expect((g.x0 + g.x1) / 2).toBeCloseTo(12, 9);
    expect(g.y1).toBeCloseTo(2.95, 9);
    expect(g.y1 - g.y0).toBeCloseTo(2.32, 9);
    expect(g.z).toBe(FLAGS_BOARD.z);
  });

  it("Given the first and the last cell Then their centres are where the arithmetic puts them: the first row 0.12 + 0.32 + 0.11 m under the top, the first column 2.6 m + 0.12 m in from the left edge, plus half a cell", () => {
    const first = cellCentre(g, 0, 0);
    expect([first.x, first.y]).toEqual([expect.closeTo(9.83 + 0.12 + 2.6 + 0.25, 9), expect.closeTo(2.95 - 0.12 - 0.32 - 0.11, 9)]);
    const last = cellCentre(g, 7, 2);
    expect([last.x, last.y]).toEqual([expect.closeTo(9.83 + 0.12 + 2.6 + 2.5 * 0.5, 9), expect.closeTo(2.95 - 0.12 - 0.32 - 7.5 * 0.22, 9)]);
  });

  it("Given a point on a cell Then that cell; given the names, the head, the margin or outside the panel Then none", () => {
    expect(cellAt(g, 12.8, 2.4)).toEqual({ row: 0, col: 0 });
    expect(cellAt(g, 13.8, 0.86)).toEqual({ row: 7, col: 2 });
    expect(cellAt(g, 13.3, 1.74)).toEqual({ row: 3, col: 1 });
    // the height of the head, 1.3 m, is 5.5 rows under the first: the middle of the sixth row, which is where the camera brought to the panel looks
    expect(cellAt(g, 13.3, 1.3)).toEqual({ row: 5, col: 1 });
    for (const [x, y] of [[11.0, 2.4], [12.8, 2.65], [12.8, 0.6], [14.3, 2.4], [8, 1], [12.8, 3.5]] as const) expect(cellAt(g, x, y), `${x} ${y}`).toBeNull();
  });

  it("Given the panel for other sizes Then it stays centred and below the top of the wall", () => {
    const wide = flagsGeometry(40, 9, 6);
    expect((wide.x0 + wide.x1) / 2).toBeCloseTo(20, 9);
    expect(wide.y1).toBeLessThanOrEqual(3.2);
    expect(wide.y0).toBeGreaterThan(0.4);
  });
});

describe("the board among the objects", () => {
  const plan = planOf(["a_manual", "b_lims_lite", "c_context"], []);

  it("Given a plan Then the objects list has one flags board after the sampling boards, and counts it once", () => {
    const objects = objectsOf(plan);
    expect(objects.filter((o) => o.kind === "flags")).toEqual([{ kind: "flags", key: "flags:board", id: "flags", index: 0 }]);
    expect(objects.at(-1)?.kind).toBe("flags");
    expect(countsOf(objects).flags).toBe(1);
  });

  it("Given the key of the board Then the camera is brought to the middle of the columns of cells at the wall, at a high pitch (the halls hide the lower part of the panel from a low camera)", () => {
    const layout = layoutOf(plan.layout);
    const target = focusOf(plan, layout, "flags:board", () => null);
    expect(target).toEqual({ at: flagsFocus(layout.width, 3), radius: 1.8, pitch: 0.65 });
    // for a floor w wide and 3 halls the cells begin w/2 - 2.17 + 0.12 + 2.6 m from the west wall and are 1.5 m wide: their middle is 0.75 m on (hand arithmetic)
    expect(target?.at.x).toBeCloseTo(layout.width / 2 - 2.17 + 0.12 + 2.6 + 0.75, 9);
    expect(target?.at.z).toBe(FLAGS_BOARD.z);
  });
});

describe("the cells as DOM: buttons in the objects list, words in the text alternative", () => {
  interface VNode {
    type: unknown;
    props: Record<string, unknown>;
  }
  const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
  const walk = (node: unknown, found: VNode[] = []): VNode[] => {
    if (Array.isArray(node)) node.forEach((n) => walk(n, found));
    else if (isVNode(node)) {
      found.push(node);
      walk(node.props.children, found);
    }
    return found;
  };
  const plan = planOf(["a_manual", "c_context"], [{ architecture: "a_manual", flags_on: ["audit_trail"] }]);
  const matrix = flagMatrix(plan, ["two_clocks", "audit_trail"]);

  it("Given the matrix Then a button for each cell, marked with its hall and flag and its state (on, off, pending), and pressing it names the column and the flag", () => {
    const onCell = vi.fn();
    const buttons = walk(FlagCells({ matrix, onCell, lang: "en" })).filter((n) => "data-flag-cell" in n.props);
    expect(buttons.map((b) => [b.props["data-flag-cell"], b.props["data-flag-state"]])).toEqual([
      ["a_manual:two_clocks", "off"], ["c_context:two_clocks", "pending"], ["a_manual:audit_trail", "on"], ["c_context:audit_trail", "pending"],
    ]);
    (buttons[3]?.props.onClick as () => void)();
    expect(onCell).toHaveBeenCalledWith(1, "audit_trail");
  });

  it("Given the matrix Then the text alternative has the same cells as words, in a table marked flags, with the state of each", () => {
    const nodes = walk(FlagsTable({ matrix }));
    expect(nodes.find((n) => n.type === "table")?.props["data-plant-table"]).toBe("flags");
    expect(nodes.filter((n) => "data-flag-state" in n.props).map((n) => n.props["data-flag-state"])).toEqual(["off", "pending", "on", "pending"]);
  });
});

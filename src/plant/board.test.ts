import { describe, expect, it } from "vitest";
import type { ScenePlan } from "../protocol.ts";
import { boardsAt } from "./board.ts";
import { handPlan } from "./fixture.ts";

// P6a (docs/design/plant_ui.md section 3.2, "As built in P6a"): the sampling board of each bay at an instant. The hand plan (fixture.ts) has one bay with U01 and U02 and eight samples whose planned
// instants are 10 s before their draws; the expected rows are typed by hand from its list: U01-D00-3 is drawn at 3000 (planned 2990), U01-D00-4 at 8000 (7990), U02-D00-2 at 5000 and skipped (4990),
// U02-D00-3 at 11000 (10990), U02-D00-4 at 14000 (13990); the three others are drawn at 2000, 2200 and 2100.

const rowsOf = (plan: ScenePlan, t: number, bay = 0): [string, number][] => (boardsAt(plan, t)[bay]?.rows ?? []).map((r) => [r.id, r.planned_s]);

describe("what is on a sampling board at an instant", () => {
  const plan = handPlan();

  it("Given the clock at 2500 Then the board lists the samples not drawn yet, by planned instant and then sample, a skipped draw included", () => {
    expect(rowsOf(plan, 2500)).toEqual([["U01-D00-3", 2990], ["U02-D00-2", 4990], ["U01-D00-4", 7990], ["U02-D00-3", 10990], ["U02-D00-4", 13990]]);
  });

  it("Given the clock at the very second of a draw Then the sample has left the board (it is drawn at that second)", () => {
    expect(rowsOf(plan, 2999).map((r) => r[0])).toContain("U01-D00-3");
    expect(rowsOf(plan, 3000).map((r) => r[0])).not.toContain("U01-D00-3");
  });

  it("Given a sample whose planned instant has passed and which is not drawn yet Then it stays on the board until its draw (a late sample)", () => {
    // U02-D00-2 is planned at 4990 and drawn at 5000
    expect(rowsOf(plan, 4995)[0]).toEqual(["U02-D00-2", 4990]);
    expect(rowsOf(plan, 5000).map((r) => r[0])).not.toContain("U02-D00-2");
  });

  it("Given a sample that is never drawn Then it stays on the board for the rest of its day", () => {
    const never = handPlan();
    never.samples[6] = { ...(never.samples[6] as (typeof never.samples)[number]), drawn_s: null };
    expect(rowsOf(never, 39000).map((r) => r[0])).toEqual(["U02-D00-3"]);
  });

  it("Given a sample planned on another day Then it is on the board of its own day only", () => {
    const next = handPlan();
    // U02-D00-4 moves to day 1: planned 86400 + 3600, drawn 86400 + 3700
    next.samples[7] = { ...(next.samples[7] as (typeof next.samples)[number]), planned_s: 90000, drawn_s: 90100 };
    expect(rowsOf(next, 2500).map((r) => r[0])).not.toContain("U02-D00-4");
    expect(rowsOf(next, 86400 + 100)).toEqual([["U02-D00-4", 90000]]);
    expect(rowsOf(next, 90100)).toEqual([]);
  });

  it("Given a row Then it names its unit (not its index) and points at its sample in the plan", () => {
    const row = boardsAt(plan, 2500)[0]?.rows[0];
    expect(row).toEqual({ sample: 2, id: "U01-D00-3", unit: "U01", planned_s: 2990 });
  });
});

describe("one board for each bay", () => {
  it("Given a plan of two bays Then there are two boards, B1 and B2, and each lists the samples of its own units", () => {
    const two = handPlan();
    two.layout = { ...two.layout, bays: [{ size: 1, profile: "bench_manual" }, { size: 1, profile: "bench_manual" }] };
    two.units = [{ ...(two.units[0] as (typeof two.units)[number]) }, { ...(two.units[1] as (typeof two.units)[number]), bay: 2, slot: 0 }];
    const boards = boardsAt(two, 2500);
    expect(boards.map((b) => [b.id, b.bay])).toEqual([["B1", 0], ["B2", 1]]);
    expect(boards[0]?.rows.map((r) => r.id)).toEqual(["U01-D00-3", "U01-D00-4"]);
    expect(boards[1]?.rows.map((r) => r.id)).toEqual(["U02-D00-2", "U02-D00-3", "U02-D00-4"]);
  });

  it("Given a bay with nothing left to draw Then its board is there and has no rows", () => {
    expect(boardsAt(handPlan(), 39000)[0]).toEqual({ id: "B1", bay: 0, rows: [] });
  });
});

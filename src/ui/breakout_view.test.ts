import { describe, expect, it } from "vitest";
import type { BreakoutRow } from "../protocol.ts";
import { BREAKOUT_READY } from "./breakout_fixture.ts";
import { KINDS, cellOf, countsByKind, defaultBreakoutForm, groupMetrics, hoursText, breakoutRequest, selectedArchitectures } from "./breakout_view.ts";

// The pure parts of the Break-out screen (lab_ui.md sections 3 and 20; spec section 8 and 11.6): how a metric row is read, how the 20 rows of an architecture are grouped, and what the form asks.
// Nothing here orders the architectures or combines the metrics into a score. Rows are typed by hand in the shape of the report (engine/src/experiments/assembly/lab/breakout.ts).

const row = (metric: string, over: Partial<BreakoutRow> = {}): BreakoutRow => ({ metric, status: "reported", value: 0.5, num: 1, den: 2, denominator: "items of T", reason: null, ...over });
const PATHS = [
  ...KINDS.flatMap((k) => [`containment.${k}.contained`, `containment.${k}.median_s`, `containment.${k}.p90_s`]),
  ...[1, 3].flatMap((d) => ["recall", "precision", "false_alarm"].map((m) => `identification.direction_${d}.${m}`)),
  "released_before_containment",
  "retro_flag_completeness",
];
const ROWS = PATHS.map((p) => row(p));

describe("cellOf: how one row is read", () => {
  it("Given a row that is not reachable Then it is not reachable whatever its value or count says: never recall 0", () => {
    expect(cellOf(row("identification.direction_3.recall", { status: "not_reachable", value: 0, num: 0, den: 2 }))).toEqual({ kind: "not_reachable" });
    expect(cellOf(row("identification.direction_3.recall", { status: "not_reachable", value: null, num: null, den: null }))).toEqual({ kind: "not_reachable" });
  });

  it("Given a share with a value Then the cell is the count over its denominator and the value", () => {
    expect(cellOf(row("identification.direction_1.recall", { value: 1, num: 7, den: 7 }))).toEqual({ kind: "share", num: 7, den: 7, value: 1 });
  });

  it("Given a zero denominator Then the cell is undefined, with its counts: never 0 and never 1", () => {
    expect(cellOf(row("identification.direction_3.precision", { status: "none_occurred", value: null, num: 0, den: 0 }))).toEqual({ kind: "undefined", num: 0, den: 0 });
  });

  it("Given a time in seconds Then the cell is a time and carries no count", () => {
    expect(cellOf(row("containment.batch.median_s", { value: 7200, num: null, den: null }))).toEqual({ kind: "time", seconds: 7200 });
  });

  it("Given a time with no held item Then the cell is undefined (nothing was held, so there is no time)", () => {
    expect(cellOf(row("containment.equipment.p90_s", { status: "none_occurred", value: null, num: null, den: null }))).toEqual({ kind: "undefined", num: null, den: null });
  });
});

describe("groupMetrics: the 20 rows in the groups the screen shows", () => {
  it("Given the 20 rows Then there are four containment kinds, two directions of identification, released and retro-flag", () => {
    const g = groupMetrics(ROWS);
    expect(g.containment.map((c) => c.kind)).toEqual(["batch", "material_lot", "equipment", "result"]);
    expect(g.identification.map((i) => i.direction)).toEqual([1, 3]);
    expect(g.released?.metric).toBe("released_before_containment");
    expect(g.retro?.metric).toBe("retro_flag_completeness");
  });

  it("Given a direction Then recall, precision and the false-alarm rate are in the same group, in this order (spec section 8, rule 3)", () => {
    for (const i of groupMetrics(ROWS).identification) expect([i.recall.metric, i.precision.metric, i.false_alarm.metric]).toEqual(["recall", "precision", "false_alarm"].map((m) => `identification.direction_${i.direction}.${m}`));
  });

  it("Given a kind Then its contained share, median and ninetieth percentile are together", () => {
    const batch = groupMetrics(ROWS).containment[0];
    expect([batch?.contained.metric, batch?.median.metric, batch?.p90.metric]).toEqual(["containment.batch.contained", "containment.batch.median_s", "containment.batch.p90_s"]);
  });

  it("Given rows with the three direction 3 rows not reachable Then the group keeps them as not reachable rows, never drops them", () => {
    const rows = ROWS.map((r) => (r.metric.startsWith("identification.direction_3.") ? { ...r, status: "not_reachable" as const, value: null, num: null, den: null } : r));
    const d3 = groupMetrics(rows).identification[1];
    expect([d3?.recall, d3?.precision, d3?.false_alarm].map((r) => r?.status)).toEqual(["not_reachable", "not_reachable", "not_reachable"]);
  });

  it("Given a row missing from the report Then the grouping refuses it with the metric named (a screen that shows recall alone is a defect)", () => {
    expect(() => groupMetrics(ROWS.filter((r) => r.metric !== "identification.direction_1.precision"))).toThrow(/identification\.direction_1\.precision/);
  });
});

describe("the small helpers", () => {
  it("Given seconds Then the text is hours with at most two decimals", () => {
    expect(hoursText(7200)).toBe("2");
    expect(hoursText(3600 * 64.5)).toBe("64.5");
    expect(hoursText(4000)).toBe("1.11");
    expect(hoursText(0)).toBe("0");
  });

  it("Given the items of a walk-back Then the counts are by kind in the order batch, material lot, equipment, result, and a kind with none is absent", () => {
    const item = (kind: string, id: string) => ({ kind, id, path: "p" });
    expect(countsByKind([item("result", "r1"), item("batch", "B-U01"), item("result", "r2"), item("material_lot", "ML-3")])).toEqual([
      { kind: "batch", count: 1 }, { kind: "material_lot", count: 1 }, { kind: "result", count: 2 },
    ]);
    expect(countsByKind([])).toEqual([]);
  });
});

describe("the form", () => {
  it("Given the ready payload Then the default is the first case, the first seed of the list, A, B and C and the ablations of the two link flags", () => {
    const f = defaultBreakoutForm(BREAKOUT_READY);
    expect(f.case).toBe("sc12_medium_lot");
    expect(f.seed).toBe("9013");
    expect(f.archs).toEqual(["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"]);
  });

  it("Given a form Then the request carries the case, the architectures in the order of ready (not the order they were ticked) and the seed", () => {
    const f = { ...defaultBreakoutForm(BREAKOUT_READY), archs: ["c_context_minus_equipment_links", "a_manual"] };
    expect(selectedArchitectures(f, BREAKOUT_READY)).toEqual(["a_manual", "c_context_minus_equipment_links"]);
    expect(breakoutRequest(f, BREAKOUT_READY, 7)).toEqual({ type: "breakout", id: 7, case: "sc12_medium_lot", architectures: ["a_manual", "c_context_minus_equipment_links"], seed: 9013 });
  });

  it("Given no architecture, a seed that is not a whole number or a build with no break-out data Then there is no request", () => {
    const f = defaultBreakoutForm(BREAKOUT_READY);
    expect(breakoutRequest({ ...f, archs: [] }, BREAKOUT_READY, 1)).toBeNull();
    expect(breakoutRequest({ ...f, seed: "x1" }, BREAKOUT_READY, 1)).toBeNull();
    expect(breakoutRequest(f, { ...BREAKOUT_READY, breakout: null }, 1)).toBeNull();
  });
});

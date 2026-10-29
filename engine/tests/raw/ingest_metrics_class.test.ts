import { describe, expect, it } from "vitest";
import { NONE_OCCURRED, rawMetrics } from "../../src/evaluate/raw_metrics.ts";
import type { DeviceClass, RowObservation } from "../../src/evaluate/raw_metrics.ts";
import type { RawRecordState } from "../../src/ingest/canonical.ts";
import type { KeyRow } from "../../src/raw/key.ts";

// S2e2 rework W1: the raw-layer metrics of spec section 2.4.7 are reported as before (the total, with the denominators of the spec) and beside it per device class, each class over the
// rows of that class only. The controller rows are about 99 percent of the raw data rows, so a total clean-row guard alone would let a harsh analyzer adapter look good ("so that
// quarantining everything cannot look good"). All values are test-only and typed by hand.

const key = (line: number, more: Partial<KeyRow> = {}): KeyRow => ({ line, sample_id: `S${line}`, intended_s: 1000 * line, resolution_s: 1, ambiguous: false, repeat: false, quirks: [], unreadable: false, ...more });
const obs = (device: DeviceClass, k: KeyRow, state: RawRecordState | "file_rejected", parsed_s: number | null = null): RowObservation => ({ key: k, state, parsed_s, device });
const controllerRows = (n: number, state: RawRecordState = "loaded", from = 1000): RowObservation[] => Array.from({ length: n }, (_, i) => obs("controller", key(from + i), state));

/** Five analyzer rows (three clean and loaded, one unreadable and rejected, one clean and quarantined) among 95 clean controller rows. */
const MIXED = [
  obs("analyzer", key(1), "loaded", 1000), obs("analyzer", key(2), "loaded", 2000), obs("analyzer", key(3), "loaded", 3000),
  obs("analyzer", key(4, { unreadable: true }), "rejected"), obs("analyzer", key(5), "quarantined"),
  ...controllerRows(95),
];

describe("Raw-layer metrics per device class (spec 2.4.7): a few analyzer rows among 95 clean controller rows", () => {
  const m = rawMetrics(MIXED);
  const analyzer = m.by_class.analyzer;
  const controller = m.by_class.controller;
  it("Given 100 rows Then the total keeps the denominators of the spec: parse failure 1 of 100, 1 quarantined and 0 held of 100, and 99 clean rows of which 1 was quarantined", () => {
    expect([m.rows, m.parse_failure, m.stage, m.clean]).toEqual([100, { status: "reported", num: 1, den: 100 }, { quarantined: 1, held: 0, den: 100 }, { status: "reported", den: 99, held_or_quarantined: 1 }]);
  });
  it("Given the same rows Then the analyzer class is over its 5 rows: parse failure 1 of 5, 1 quarantined of 5, and 4 clean rows of which 1 was quarantined", () => {
    expect(analyzer).toMatchObject({ status: "reported", rows: 5, parse_failure: { status: "reported", num: 1, den: 5 }, stage: { quarantined: 1, held: 0, den: 5 }, clean: { status: "reported", den: 4, held_or_quarantined: 1 } });
  });
  it("Given the same rows Then the controller class is over its 95 rows: parse failure 0 of 95, none quarantined or held, and 95 clean rows of which none was quarantined", () => {
    expect(controller).toMatchObject({ status: "reported", rows: 95, parse_failure: { status: "reported", num: 0, den: 95 }, stage: { quarantined: 0, held: 0, den: 95 }, clean: { status: "reported", den: 95, held_or_quarantined: 0 } });
  });
  it("Given a class with no repeat and no ambiguous stamp Then it prints 'none occurred' for both, by the existing rule, never 100 percent", () => {
    expect([analyzer, controller].map((c) => (c.status === "reported" ? [c.duplicates, c.ambiguous] : null))).toEqual([[NONE_OCCURRED, NONE_OCCURRED], [NONE_OCCURRED, NONE_OCCURRED]]);
  });
  it("Given the two classes Then they partition the rows: no row is counted in both, and the counts of the classes add up to the total", () => {
    if (analyzer.status !== "reported" || controller.status !== "reported") throw new Error("both classes have rows");
    expect(analyzer.rows + controller.rows).toBe(m.rows);
    expect(analyzer.stage.quarantined + controller.stage.quarantined).toBe(m.stage.quarantined);
    expect(analyzer.stage.held + controller.stage.held).toBe(m.stage.held);
    expect((analyzer.clean.status === "reported" ? analyzer.clean.den : 0) + (controller.clean.status === "reported" ? controller.clean.den : 0)).toBe(m.clean.status === "reported" ? m.clean.den : -1);
  });
  it("Given a rejected controller file Then every row of it counts as unreadable in the controller class and not in the analyzer class", () => {
    const rejected = rawMetrics([...MIXED.slice(0, 3), ...Array.from({ length: 4 }, (_, i): RowObservation => obs("controller", key(500 + i), "file_rejected"))]);
    expect(rejected.by_class.analyzer).toMatchObject({ parse_failure: { num: 0, den: 3 } });
    expect(rejected.by_class.controller).toMatchObject({ parse_failure: { num: 4, den: 4 } });
    expect(rejected.parse_failure).toEqual({ status: "reported", num: 4, den: 7 });
  });
  it("Given a repeated analyzer row that was a no-op and a held controller row Then the duplicates belong to the analyzer class and the hold to the controller class", () => {
    const r = rawMetrics([obs("analyzer", key(1, { repeat: true, quirks: ["RQ4"] }), "no_op"), obs("controller", key(2), "held"), ...controllerRows(2, "loaded", 10)]);
    expect(r.by_class.analyzer).toMatchObject({ duplicates: { status: "reported", den: 1, suppressed: 1 }, stage: { held: 0 } });
    expect(r.by_class.controller).toMatchObject({ duplicates: NONE_OCCURRED, stage: { held: 1, den: 3 }, clean: { status: "reported", den: 3, held_or_quarantined: 1 } });
    expect(r.stage).toEqual({ quarantined: 0, held: 1, den: 4 });
  });
  it("Given observations of one class only Then the other class reads not applicable: no row of it was written", () => {
    const r = rawMetrics(controllerRows(3));
    expect(r.by_class.analyzer).toEqual({ status: "not_applicable", reason: "no raw data row of this device class was written" });
    expect(r.by_class.controller).toMatchObject({ status: "reported", rows: 3 });
  });
});

describe("Given quarantining every analyzer row (the guard against a good-looking number from a harsh adapter)", () => {
  // four clean analyzer rows, all quarantined, among 96 clean controller rows, all loaded
  const harsh = rawMetrics([...[1, 2, 3, 4].map((n) => obs("analyzer", key(n), "quarantined")), ...controllerRows(96)]);
  it("When the analyzer class is read Then 4 of its 4 clean rows were quarantined: 1.0", () => {
    expect(harsh.by_class.analyzer).toMatchObject({ clean: { status: "reported", den: 4, held_or_quarantined: 4 } });
  });
  it("When the total is read Then the same 4 are 4 of 100 clean rows: 0.04, diluted by the controller rows", () => {
    expect(harsh.clean).toEqual({ status: "reported", den: 100, held_or_quarantined: 4 });
  });
  it("When the controller class is read Then none of its clean rows was quarantined: 0 of 96", () => {
    expect(harsh.by_class.controller).toMatchObject({ clean: { status: "reported", den: 96, held_or_quarantined: 0 } });
  });
});

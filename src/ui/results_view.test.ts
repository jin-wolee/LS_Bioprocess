import { describe, expect, it } from "vitest";
import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import { axisMax, barPositions, fmt, groupRows, showsLabelErrorNote } from "./results_view.ts";

// The pure parts of the Results screen (docs/design/lab_ui.md sections 3 and 10; spec section 8). Expected values are hand arithmetic.

type Row = ExperimentReport["architectures"][number]["rows"][number];
const row = (metric: string, over: Partial<Row> = {}): Row => ({ metric, status: "reported", n_seeds: 20, n_defined: 20, median: 1, lo: 0, hi: 2, denominator: null, den: null, reason: null, ...over });
const share = (metric: string, over: Partial<Row> = {}): Row => row(metric, { median: 0.5, lo: 0.25, hi: 0.75, den: { min: 90, median: 100, max: 110 }, denominator: "all analysis requests", ...over });

describe("fmt: a figure for the eye, three significant digits, whole numbers as they are", () => {
  it.each([
    [0, "0"], [1, "1"], [30, "30"], [398, "398"], [1097, "1097"], [1097.6, "1098"], [12.3456, "12.3"], [0.9698492462, "0.97"], [0.012437810945, "0.0124"], [0.0725, "0.0725"], [0.07321428, "0.0732"], [0.5, "0.5"],
  ])("Given %d Then %s", (value, shown) => {
    expect(fmt(value)).toBe(shown);
  });
});

describe("showsLabelErrorNote: the flags, not the id (lab_ui.md section 10)", () => {
  const flags = (over: Record<string, boolean>) => ({ system_issued_id: true, ingest_idempotency: true, two_clocks: true, ...over });

  it("Given system_issued_id off and ingest_idempotency on Then the sentence is shown", () => {
    expect(showsLabelErrorNote(flags({ system_issued_id: false }))).toBe(true);
  });

  it("Given system_issued_id on Then it is not shown, whatever else is on or off", () => {
    expect(showsLabelErrorNote(flags({}))).toBe(false);
    expect(showsLabelErrorNote(flags({ ingest_idempotency: false }))).toBe(false);
  });

  it("Given both off (preset A) Then it is not shown: without the idempotency check no conflict of VR-008b arises", () => {
    expect(showsLabelErrorNote(flags({ system_issued_id: false, ingest_idempotency: false }))).toBe(false);
  });

  it("Given a flag that is missing from the data Then it counts as off", () => {
    expect(showsLabelErrorNote({ ingest_idempotency: true })).toBe(true);
    expect(showsLabelErrorNote({})).toBe(false);
  });
});

describe("axisMax: one axis per metric across the architectures shown", () => {
  const block = (rows: Row[]) => ({ rows });

  it("Given a share (it has a denominator) Then the axis is zero to one", () => {
    expect(axisMax([block([share("availability.available")])], "availability.available")).toBe(1);
  });

  it("Given a figure in seconds Then the axis ends at the largest upper end of the spread over the architectures", () => {
    const blocks = [block([row("turnaround.median_s", { hi: 1403 })]), block([row("turnaround.median_s", { hi: 2000 })])];
    expect(axisMax(blocks, "turnaround.median_s")).toBe(2000);
  });

  it("Given no figure in any architecture Then the axis is one (nothing is drawn on it)", () => {
    expect(axisMax([block([row("turnaround.median_s", { status: "none_occurred", median: null, lo: null, hi: null })])], "turnaround.median_s")).toBe(1);
  });
});

describe("barPositions: the range bar on a 100-wide axis", () => {
  it("Given median 0.5 and range 0.25 to 0.75 on an axis of 1 Then 50, 25 and 75", () => {
    expect(barPositions({ median: 0.5, lo: 0.25, hi: 0.75 }, 1, 100)).toEqual({ median: 50, lo: 25, hi: 75 });
  });

  it("Given a figure above the axis or below zero Then it is held to the ends", () => {
    expect(barPositions({ median: 3, lo: -1, hi: 5 }, 2, 100)).toEqual({ median: 100, lo: 0, hi: 100 });
  });
});

describe("groupRows: the rows of one architecture as the screen shows them", () => {
  const rows = [
    share("holding_time.started"), row("holding_time.median_s"), row("turnaround.median_s"), row("utilisation.per_24h.with_setup", { median: 0.03 }), share("availability.available"), share("exact_reconstruction"), row("phantom_effect", { status: "not_applicable" }),
    row("detection.by_type.label_error.realised"), share("detection.by_type.label_error.recall"), share("detection.by_type.label_error.precision"), share("detection.by_type.label_error.false_alarm"),
    row("detection.by_type.label_error.by_detector.VR-009"),
    row("detection.by_type.feed_in_gap.realised"), share("detection.by_type.feed_in_gap.recall"), share("detection.by_type.feed_in_gap.precision"), share("detection.by_type.feed_in_gap.false_alarm"),
  ];
  const grouped = groupRows(rows);

  it("Given the rows Then timing, the record and detection are separate, in the order of the report", () => {
    expect(grouped.timing.map((r) => r.metric)).toEqual(["holding_time.started", "holding_time.median_s", "turnaround.median_s"]);
    expect(grouped.record.map((r) => r.metric)).toEqual(["availability.available", "exact_reconstruction", "phantom_effect"]);
  });

  it("Given the utilisation rows Then they are in neither group (the screen shows utilisation once, from the shared truth run)", () => {
    expect([...grouped.timing, ...grouped.record].some((r) => r.metric.startsWith("utilisation"))).toBe(false);
    expect(grouped.utilisation.map((r) => r.metric)).toEqual(["utilisation.per_24h.with_setup"]);
  });

  it("Given the rows of the hold-time rule's share (spec section 8) Then they are a group of their own, in neither the record nor utilisation", () => {
    const g = groupRows([share("exact_reconstruction"), share("hold_limit.rejected"), share("hold_limit.exact_reconstruction_limit_lifted"), share("hold_limit.availability_limit_lifted")]);
    expect(g.hold_limit.map((r) => r.metric)).toEqual(["hold_limit.rejected", "hold_limit.exact_reconstruction_limit_lifted", "hold_limit.availability_limit_lifted"]);
    expect(g.record.map((r) => r.metric)).toEqual(["exact_reconstruction"]);
    expect(g.utilisation).toEqual([]);
  });

  it("Given the detection rows Then each error type has recall, precision and the false-alarm rate together, and the per-detector counts are left out", () => {
    expect(grouped.detection.map((d) => d.type)).toEqual(["label_error", "feed_in_gap"]);
    for (const d of grouped.detection) {
      expect(d.recall?.metric).toBe(`detection.by_type.${d.type}.recall`);
      expect(d.precision?.metric).toBe(`detection.by_type.${d.type}.precision`);
      expect(d.false_alarm?.metric).toBe(`detection.by_type.${d.type}.false_alarm`);
      expect(d.realised?.metric).toBe(`detection.by_type.${d.type}.realised`);
    }
  });

  it("Given a type with a recall and no precision row Then the missing figure is absent, never invented", () => {
    const only = groupRows([share("detection.by_type.lost_rerun.recall")]).detection[0];
    expect(only?.precision).toBeUndefined();
    expect(only?.recall).toBeDefined();
  });
});

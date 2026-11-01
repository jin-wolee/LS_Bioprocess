import { describe, expect, it } from "vitest";
import type { ScenePlan } from "../protocol.ts";
import { handPlan, indexOf } from "./fixture.ts";
import { panelOf } from "./panels.ts";
import { sceneAt } from "./scene_at.ts";

// P5b (docs/design/plant_ui.md section 3.2, "As built in P5b"): `panelOf(plan, pick, t, lens)`, the content of the panel of a reactor, a sample, an analyzer and a member of staff at the clock instant, from
// the plan alone. Every expected value is typed by hand from the hand plan of fixture.ts (see it for the instants): a count is a count of the plan's rows with an instant not later than `t`, a time
// that has not come yet is not shown (null), and a draw that the volume budget skipped is not a sample (it has no tube and no operator).

const card = (sample: number, shown_s: number) => ({ sample, shown_s, available_s: null, slots: [{ name: "unit" as const, stored: true }], findings: [], version_s: [shown_s] });
const base = handPlan();
const plan: ScenePlan = {
  ...base,
  layout: { ...base.layout, architectures: ["a_manual", "b_lims_lite"] },
  records: [
    { architecture: "a_manual", flags_on: ["audit_trail"], cards: [card(indexOf(base, "U01-D00-1"), 2700), card(indexOf(base, "U01-D00-3"), 3700)] },
    { architecture: "b_lims_lite", flags_on: [], cards: [card(indexOf(base, "U01-D00-1"), 2700)] },
  ],
};
const sample = (id: string) => ({ kind: "sample" as const, index: indexOf(plan, id) });

describe("the reactor panel", () => {
  it("Given U01 at 3500 s (inoculated at 1000, three draws so far of four, harvest at 9000) Then it is running, with the batch, the inoculation, no end yet, 3 samples and the newest first", () => {
    const p = panelOf(plan, { kind: "reactor", index: 0 }, 3500, "a_manual");
    expect(p).toEqual({
      kind: "reactor", id: "U01", bay: 1, profile: "bench_manual", batch: "B-U01", status: "running", started_s: 1000, ended_s: null, drawn: 3,
      newest: [{ sample: indexOf(plan, "U01-D00-3"), id: "U01-D00-3", at_s: 3000 }, { sample: indexOf(plan, "U01-D00-2"), id: "U01-D00-2", at_s: 2200 }, { sample: indexOf(plan, "U01-D00-1"), id: "U01-D00-1", at_s: 2000 }],
    });
  });

  it("Given U01 at 9500 s Then it is harvested at 9000 with 4 samples, and at 500 s it is idle with no batch time and nothing drawn", () => {
    expect(panelOf(plan, { kind: "reactor", index: 0 }, 9500, "a_manual")).toMatchObject({ status: "harvested", started_s: 1000, ended_s: 9000, drawn: 4 });
    expect(panelOf(plan, { kind: "reactor", index: 0 }, 500, "a_manual")).toMatchObject({ status: "idle", started_s: null, ended_s: null, drawn: 0, newest: [] });
  });

  it("Given U02 at 12500 s, with a skipped draw at 5000 Then it is stopped, and the draws are 2: the skipped one left no sample", () => {
    const p = panelOf(plan, { kind: "reactor", index: 1 }, 12500, "a_manual");
    expect(p).toMatchObject({ status: "stopped", ended_s: 12000, drawn: 2 });
    expect(p.kind === "reactor" && p.newest.map((x) => x.id)).toEqual(["U02-D00-3", "U02-D00-1"]);
  });

  it("Given more than five samples Then only the newest five are listed and the count is all of them", () => {
    const many: ScenePlan = { ...plan, samples: Array.from({ length: 7 }, (_, i) => ({ ...plan.samples[0] as ScenePlan["samples"][number], id: `U01-D00-${i + 1}`, drawn_s: 2000 + i * 100, visits: [] })) };
    const p = panelOf(many, { kind: "reactor", index: 0 }, 9000, "a_manual");
    expect(p.kind === "reactor" && [p.drawn, p.newest.map((x) => x.id)]).toEqual([7, ["U01-D00-7", "U01-D00-6", "U01-D00-5", "U01-D00-4", "U01-D00-3"]]);
  });
});

describe("the sample panel", () => {
  it("Given U01-D00-3 at 3800 s, inside AN-1 for its first run (3700 to 3970) Then it is in the analyzer, with its times up to now, one visit with no end yet, and the lens holds its card", () => {
    expect(panelOf(plan, sample("U01-D00-3"), 3800, "a_manual")).toEqual({
      kind: "sample", id: "U01-D00-3", unit: "U01", operator: "OP-01", label: "handwritten", phase: "run", planned_s: 2990, drawn_s: 3000, arrived_s: 3700, card: true,
      visits: [{ analyzer: "AN-1", attempt: 1, queued_s: 3700, started_s: 3700, run_started_s: 3700, ended_s: null, qc: null }],
    });
  });

  it("Given U01-D00-3 at 4600 s Then both visits are listed with their times, the first with the QC outcome that failed and the second on AN-2 that passed, and it has left the analyzer", () => {
    const p = panelOf(plan, sample("U01-D00-3"), 4600, "a_manual");
    expect(p.kind === "sample" && p.visits).toEqual([
      { analyzer: "AN-1", attempt: 1, queued_s: 3700, started_s: 3700, run_started_s: 3700, ended_s: 3970, qc: "qc_failed" },
      { analyzer: "AN-2", attempt: 2, queued_s: 3970, started_s: 4240, run_started_s: 4240, ended_s: 4510, qc: "qc_passed" },
    ]);
    expect(p).toMatchObject({ phase: "leave" });
  });

  it("Given U01-D00-3 in the hand at 3030 s Then it is in the hand, its visits are not listed and no time of them is known", () => {
    expect(panelOf(plan, sample("U01-D00-3"), 3030, "a_manual")).toMatchObject({ phase: "hand", arrived_s: null, visits: [] });
  });

  it("Given the lens on B, whose only card is U01-D00-1 Then U01-D00-3 has no card in the lens hall (and the panel says nothing of why); on A it has one only from its card's instant", () => {
    expect(panelOf(plan, sample("U01-D00-3"), 3800, "b_lims_lite")).toMatchObject({ card: false });
    expect(panelOf(plan, sample("U01-D00-3"), 3699, "a_manual")).toMatchObject({ card: false });
    expect(panelOf(plan, sample("U01-D00-3"), 3700, "a_manual")).toMatchObject({ card: true });
  });

  it("Given a sample that is not drawn yet, a skipped draw and a sample long gone Then the phases are planned, skipped and gone", () => {
    expect(panelOf(plan, sample("U01-D00-4"), 7000, "a_manual")).toMatchObject({ phase: "planned", drawn_s: null, planned_s: null });
    expect(panelOf(plan, sample("U02-D00-2"), 6000, "a_manual")).toMatchObject({ phase: "skipped", operator: null, drawn_s: 5000 });
    expect(panelOf(plan, sample("U01-D00-1"), 9000, "a_manual")).toMatchObject({ phase: "gone", card: true });
  });
});

describe("the analyzer panel", () => {
  it("Given AN-1 at 2950 s, running U01-D00-1 (2700 to 2970) with U02-D00-1 and U01-D00-2 waiting in the lane in the order they will enter Then the panel names the one inside and the lane, front first", () => {
    const p = panelOf(plan, { kind: "analyzer", index: 0 }, 2950, "a_manual");
    expect(p).toMatchObject({ kind: "analyzer", id: "AN-1", profile: "allinone_atline", group: "AIO", lamp: "run", inside: "U01-D00-1", lane: ["U02-D00-1", "U01-D00-2"], finished: 0 });
    expect(p.kind === "analyzer" && p.lane.length).toBe(sceneAt(plan, 2950).analyzers[0]?.queue);
  });

  it("Given AN-1 at 3800 s Then it has finished 3 visits, the newest first, it holds U01-D00-3, and its only window to come is the closing at 20000", () => {
    const p = panelOf(plan, { kind: "analyzer", index: 0 }, 3800, "a_manual");
    expect(p).toMatchObject({
      lamp: "run", inside: "U01-D00-3", lane: [], finished: 3,
      newest: [{ id: "U01-D00-2", at_s: 3510, qc: "qc_passed" }, { id: "U02-D00-1", at_s: 3240, qc: "qc_passed" }, { id: "U01-D00-1", at_s: 2970, qc: "qc_passed" }],
      windows: [{ kind: "closed", from_s: 20000, to_s: 30000, open: false }],
    });
  });

  it("Given AN-2 at 2500 s, in maintenance from 2000 to 3300 Then the window is open, the lamp says so, nothing is inside and no visit is finished", () => {
    expect(panelOf(plan, { kind: "analyzer", index: 1 }, 2500, "a_manual")).toMatchObject({
      id: "AN-2", lamp: "maintenance", inside: null, lane: [], finished: 0, newest: [], windows: [{ kind: "maintenance", from_s: 2000, to_s: 3300, open: true }],
    });
  });
});

describe("the staff panel", () => {
  it("Given OP-01 at 3500 s (on duty to 20000, four draws so far) Then it is on duty and resting, with 4 draws and the newest first; the lens A keeps a qualification reference with each draw", () => {
    const p = panelOf(plan, { kind: "staff", index: 0 }, 3500, "a_manual");
    expect(p).toEqual({
      kind: "staff", id: "OP-01", on_duty: true, mode: "idle", drawn: 4, qualification: true,
      newest: [
        { sample: indexOf(plan, "U01-D00-3"), id: "U01-D00-3", at_s: 3000 }, { sample: indexOf(plan, "U01-D00-2"), id: "U01-D00-2", at_s: 2200 },
        { sample: indexOf(plan, "U02-D00-1"), id: "U02-D00-1", at_s: 2100 }, { sample: indexOf(plan, "U01-D00-1"), id: "U01-D00-1", at_s: 2000 },
      ],
    });
  });

  it("Given OP-02 before its shift (10000 s) Then it is off duty with no draws; and the lens on B, which keeps no qualification, says not stored", () => {
    expect(panelOf(plan, { kind: "staff", index: 1 }, 5000, "a_manual")).toMatchObject({ on_duty: false, drawn: 0, newest: [] });
    expect(panelOf(plan, { kind: "staff", index: 1 }, 5000, "b_lims_lite")).toMatchObject({ qualification: false });
  });

  it("Given a lens whose hall has not arrived Then the qualification is unknown (null), not stored", () => {
    expect(panelOf(plan, { kind: "staff", index: 0 }, 3500, "c_context")).toMatchObject({ qualification: null });
  });
});

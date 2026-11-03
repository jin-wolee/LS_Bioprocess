import { describe, expect, it } from "vitest";
import type { PlanVisit, ScenePlan } from "../protocol.ts";
import { TOUR_SPEC, cardsOf, stepAfter, tourEnds, tourKeyAction, tourSample, tourSteps, wantTruth } from "./tour.ts";

// P8b (docs/design/plant_ui.md section 3.5): the guided scene as data. The plan below is typed by hand from the single-sample trace of SC3 (docs/design/single_sample_trace.md; the fixture
// tests/fixtures/trace/single_sample_trace.json): sample U03-D10-2 of unit U03, drawn at 899,841 s, a feed of U03 at 900,000 s, the tube in the analyzer and its run starting at 900,887 s, the result at
// 901,157 s. Around it are decoys that each break one clause of the lineage rule `sc3`: a lower id whose feed falls after its run started, a lower id whose gap holds a feed of ANOTHER unit, and a
// higher id with the same feed in its gap. Every expected value is read off that trace or is hand arithmetic on it, never off the code under test.

const visit = (analyzer: number, run_started_s: number, ended_s: number, attempt = 1): PlanVisit => ({
  analyzer, queued_s: run_started_s, started_s: run_started_s, run_started_s, ended_s, attempt, qc: "qc_passed", setup_s: 0, diluted: false,
});
type Sample = ScenePlan["samples"][number];
const sample = (id: string, unit: number, drawn_s: number | null, visits: PlanVisit[], extra: Partial<Sample> = {}): Sample => ({
  id, unit, operator: 0, planned_s: (drawn_s ?? 0) - 225, drawn_s, arrived_s: visits[0]?.run_started_s ?? null, label: "handwritten", kind: "routine", skipped: false, visits, ...extra,
});
const slots = (sampledAt: boolean, basis: "sampled_at" | "measured_at") => [
  { name: "unit" as const, stored: true }, { name: "sampled_at" as const, stored: sampledAt },
  { name: "context" as const, stored: true, basis }, { name: "value" as const, stored: true },
];
const card = (sampleIndex: number, sampledAt: boolean, basis: "sampled_at" | "measured_at") => ({ sample: sampleIndex, shown_s: 900_887, available_s: null, slots: slots(sampledAt, basis), findings: [], version_s: [901_157] });

const base = (): ScenePlan => ({
  schema_version: "1", seed: 1, horizon_s: 1_814_400,
  layout: { bays: [{ size: 3, profile: "bench_manual" }], analyzers: [{ profile: "allinone_atline", group: "AIO" }, { profile: "allinone_atline", group: "AIO" }], architectures: ["a_manual", "b_lims_lite", "c_context"] },
  units: ["U01", "U02", "U03"].map((id, slot) => ({ id, bay: 1, slot, profile: "bench_manual", batch: `B-${id}`, start_s: 30_600, end_s: 1_072_800 })),
  analyzers: [{ id: "AN-1", profile: "allinone_atline", group: "AIO" }, { id: "AN-2", profile: "allinone_atline", group: "AIO" }],
  staff: [{ id: "OP-01", on_duty: [[28_800, 61_200]] }],
  samples: [
    sample("U01-D10-1", 0, 899_200, [visit(0, 899_500, 899_700)]), // its own unit's feeds (at 899,100 and 900,000) fall before its draw and after its run started
    sample("U02-D10-1", 1, 899_841, [visit(1, 900_887, 901_157)]), // the feed at 900,000 is U03's, not U02's
    sample("U03-D10-2", 2, 899_841, [visit(0, 900_887, 901_157)]), // the sample of the trace
    sample("U03-D10-3", 2, 899_900, [visit(1, 900_950, 901_200)]), // the same feed in its gap, a higher id
  ],
  marks: [
    { t: 899_100, unit: 0, kind: "feed", source: "rule", item: null }, // a feed of another unit, the first feed of the whole plan
    { t: 900_000, unit: 0, kind: "feed", source: "rule", item: null },
    { t: 900_000, unit: 2, kind: "feed", source: "rule", item: null },
    { t: 910_000, unit: 1, kind: "feed", source: "rule", item: null },
  ],
  windows: [], calibrations: [],
  records: [
    { architecture: "a_manual", flags_on: [], cards: [card(2, false, "measured_at")] },
    { architecture: "b_lims_lite", flags_on: ["audit_trail"], cards: [card(2, false, "measured_at")] },
    { architecture: "c_context", flags_on: ["two_clocks"], cards: [card(2, true, "sampled_at")] },
  ],
});

describe("The run the tour opens", () => {
  it("Given the tour's spec Then it is the scenario SC3 at seed 1 with the three presets as halls and no action", () => {
    expect(TOUR_SPEC.run.scenario).toBe("sc03_feed_in_gap");
    expect(TOUR_SPEC.seed).toBe(1);
    expect(TOUR_SPEC.run.architectures).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(TOUR_SPEC.actions).toEqual([]);
  });
});

describe("The sample the tour follows (the lineage rule sc3, read off the plan)", () => {
  it("Given the plan Then it is U03-D10-2: its draw, its feed and the start and the end of its run are the instants of the trace", () => {
    const s = tourSample(base());
    expect(s).toMatchObject({ id: "U03-D10-2", unit: 2, index: 2, drawn_s: 899_841, feeds_in_gap: [900_000], run_started_s: 900_887, ended_s: 901_157, analyzer: 0 });
  });

  it("Given a lower id whose own feed falls after its run started, and one whose gap holds another unit's feed Then neither is picked, and the lowest id of the rest is", () => {
    expect(tourSample(base())?.id).toBe("U03-D10-2");
  });

  it("Given a feed exactly at the draw, or exactly at the start of the run Then it counts (both ends count); one second outside either does not", () => {
    const plan = (feed: number): ScenePlan => ({ ...base(), samples: [sample("U03-D10-2", 2, 899_841, [visit(0, 900_887, 901_157)])], marks: [{ t: feed, unit: 2, kind: "feed", source: "rule", item: null }] });
    expect(tourSample(plan(899_841))?.feeds_in_gap).toEqual([899_841]);
    expect(tourSample(plan(900_887))?.feeds_in_gap).toEqual([900_887]);
    expect(tourSample(plan(899_840))).toBeNull();
    expect(tourSample(plan(900_888))).toBeNull();
  });

  it("Given two feeds in the gap Then both are listed, earliest first", () => {
    const plan: ScenePlan = { ...base(), marks: [{ t: 900_500, unit: 2, kind: "feed", source: "rule", item: null }, { t: 900_000, unit: 2, kind: "feed", source: "scripted", item: null }] };
    expect(tourSample(plan)?.feeds_in_gap).toEqual([900_000, 900_500]);
  });

  it("Given a draw the volume budget skipped, a sample with no visit and a confirming sample Then none of them is a candidate", () => {
    const plan: ScenePlan = {
      ...base(),
      samples: [
        sample("U03-D10-1", 2, null, [], { skipped: true }),
        sample("U03-D10-2", 2, 899_841, []),
        sample("U03-D10-3", 2, 899_841, [visit(0, 900_887, 901_157)], { kind: "confirm" }),
      ],
    };
    expect(tourSample(plan)).toBeNull();
  });

  it("Given a sample with a rerun Then the run that counts is the first attempt's", () => {
    const plan: ScenePlan = { ...base(), samples: [sample("U03-D10-2", 2, 899_841, [visit(1, 905_000, 905_300, 2), visit(0, 900_887, 901_157, 1)])] };
    expect(tourSample(plan)).toMatchObject({ run_started_s: 900_887, ended_s: 901_157, analyzer: 0 });
  });

  it("Given a plan with no feed in any gap Then there is no sample and no step", () => {
    const plan: ScenePlan = { ...base(), marks: [] };
    expect(tourSample(plan)).toBeNull();
    expect(tourSteps(plan)).toEqual([]);
  });
});

describe("The steps of the tour", () => {
  const steps = tourSteps(base());

  it("Given the plan Then there are five steps in this order: the draw, the feed, the run, the records and the truth", () => {
    expect(steps.map((s) => s.id)).toEqual(["draw", "feed", "run", "records", "truth"]);
  });

  it("Given the SC3 sample Then each step's instant is read off the plan: its draw, the feed of ITS unit in the gap, the start of its run, then the end of its run twice", () => {
    expect(steps.map((s) => s.t)).toEqual([899_841, 900_000, 900_887, 901_157, 901_157]);
  });

  it("Given a feed of another unit earlier in the plan Then the feed step still takes the feed of the sample's own unit", () => {
    expect(steps[1]?.t).toBe(900_000);
    expect(steps[1]?.t).not.toBe(899_100);
  });

  it("Given the steps Then the camera frames the reactor with the operator's place twice, then the tube, then the three halls twice", () => {
    expect(steps.map((s) => s.frame)).toEqual(["station:U03", "station:U03", "sample:U03-D10-2", "halls:all", "halls:all"]);
  });

  it("Given the steps Then the first three pick their object (the reactor, the reactor, the sample) and the last two pick none", () => {
    expect(steps.map((s) => s.pick)).toEqual([{ kind: "reactor", index: 2 }, { kind: "reactor", index: 2 }, { kind: "sample", index: 2 }, null, null]);
  });

  it("Given the steps Then only the last opens the record, only the last asks for the overlay, and only the last is optional", () => {
    expect(steps.map((s) => s.record)).toEqual([false, false, false, false, true]);
    expect(steps.map((s) => s.truth)).toEqual([false, false, false, false, true]);
    expect(steps.map((s) => s.optional)).toEqual([false, false, false, false, true]);
  });
});

describe("The overlay during the tour", () => {
  const steps = tourSteps(base());

  it("Given a reader who had the overlay off Then it is wanted at the last step only", () => {
    expect(steps.map((_, i) => wantTruth(steps, i, false))).toEqual([false, false, false, false, true]);
  });

  it("Given a reader who had the overlay on Then it stays on at every step (the tour never turns it off under them)", () => {
    expect(steps.map((_, i) => wantTruth(steps, i, true))).toEqual([true, true, true, true, true]);
  });

  it("Given no step (the tour is over) Then the overlay is the reader's own", () => {
    expect(wantTruth(steps, -1, false)).toBe(false);
    expect(wantTruth(steps, steps.length, false)).toBe(false);
    expect(wantTruth(steps, -1, true)).toBe(true);
  });
});

describe("The card of the sample in each hall", () => {
  it("Given the three halls Then each says which of the four slots it stores, and the context says which time it joined by", () => {
    const rows = cardsOf(base(), 2);
    expect(rows.map((r) => r.architecture)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    const stored = (i: number) => (rows[i] as { slots: { name: string; stored: boolean; basis?: string }[] }).slots.map((s) => `${s.name}:${s.stored}${s.basis ? `:${s.basis}` : ""}`);
    expect(stored(0)).toEqual(["unit:true", "sampled_at:false", "context:true:measured_at", "value:true"]);
    expect(stored(1)).toEqual(["unit:true", "sampled_at:false", "context:true:measured_at", "value:true"]);
    expect(stored(2)).toEqual(["unit:true", "sampled_at:true", "context:true:sampled_at", "value:true"]);
  });

  it("Given a hall whose record has not arrived Then it is pending; given a record that holds no card of the sample Then the hall is left out (a hall never shows an absence)", () => {
    const plan: ScenePlan = { ...base(), records: [{ architecture: "a_manual", flags_on: [], cards: [card(2, false, "measured_at")] }, { architecture: "b_lims_lite", flags_on: [], cards: [] }] };
    const rows = cardsOf(plan, 2);
    expect(rows.map((r) => [r.architecture, r.state])).toEqual([["a_manual", "card"], ["c_context", "pending"]]);
  });
});

describe("Stepping through the tour", () => {
  it("Given Next Then the tour goes on one step, and on the last step it is over (null); Back goes back one step and stays on the first", () => {
    expect([0, 1, 2, 3].map((i) => stepAfter(i, 5, 1))).toEqual([1, 2, 3, 4]);
    expect(stepAfter(4, 5, 1)).toBeNull();
    expect([4, 3, 1].map((i) => stepAfter(i, 5, -1))).toEqual([3, 2, 0]);
    expect(stepAfter(0, 5, -1)).toBe(0);
  });

  it("Given a key Then the right and down arrows step on, the left and up arrows step back, Escape skips and any other key is not the tour's", () => {
    expect(["ArrowRight", "ArrowDown"].map(tourKeyAction)).toEqual([1, 1]);
    expect(["ArrowLeft", "ArrowUp"].map(tourKeyAction)).toEqual([-1, -1]);
    expect(tourKeyAction("Escape")).toBe("skip");
    expect(["w", "a", " ", "Enter", "Tab", "q"].map(tourKeyAction)).toEqual([null, null, null, null, null, null]);
  });
});

describe("When a tour is over by itself", () => {
  const on = { began: 2 as number | null, epoch: 2 as number | null, asked: false, sawBusy: false, settled: true, onRun: true };

  it("Given the plan on screen is the one the first step was applied to Then the tour goes on", () => {
    expect(tourEnds(on)).toBe(false);
  });

  it("Given the plan was replaced by an answer that is not the tour's (an operator action, a link) Then the tour is over", () => {
    expect(tourEnds({ ...on, epoch: 3 })).toBe(true);
  });

  it("Given the tour asked for its own run Then it waits while the request is in flight and until the request was seen, and is over when the answer came and is not the tour's run", () => {
    const waiting = { ...on, began: null, epoch: 1, asked: true, onRun: false };
    expect(tourEnds({ ...waiting, settled: false, sawBusy: true })).toBe(false);
    expect(tourEnds({ ...waiting, settled: true, sawBusy: false })).toBe(false);
    expect(tourEnds({ ...waiting, settled: true, sawBusy: true })).toBe(true);
  });

  it("Given the tour asked for its own run and the answer is that run Then the tour goes on", () => {
    expect(tourEnds({ ...on, began: null, epoch: 2, asked: true, sawBusy: true, onRun: true })).toBe(false);
  });
});

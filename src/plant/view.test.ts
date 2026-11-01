import { describe, expect, it } from "vitest";
import { answerPlantRun } from "../../engine/src/experiments/assembly/lab/plant.ts";
import { createChallenges } from "../../engine/src/experiments/assembly/lab/challenges.ts";
import { labData } from "../../engine/tests/support/lab_data.ts";
import { SMALL } from "../../engine/tests/support/scenarios.ts";
import type { ScenePlan } from "../protocol.ts";
import { layoutOf } from "./layout.ts";
import { analyzerRowsAt, clockOf, countsOf, hallRowsAt, objectsOf, onDuty, startInstant, statusOf } from "./view.ts";

// docs/design/plant_ui.md sections 3.2 and 9: what the HUD, the objects list and the text alternative say about a plan at an instant. Pure functions of the plan; the expected values are typed by hand
// from a plan built by hand (a day is 86400 s; the first shift of a weekday is 08:00 to 13:00, 28800 to 46800 s, as in the default roster).

const plan: ScenePlan = {
  schema_version: "1",
  seed: 1,
  horizon_s: 691200,
  layout: { bays: [{ size: 3, profile: "bench_manual" }], analyzers: [{ profile: "allinone_atline", group: "AIO" }, { profile: "allinone_atline", group: "AIO" }], architectures: ["a_manual", "b_lims_lite"] },
  units: [
    { id: "U01", bay: 1, slot: 0, profile: "bench_manual", batch: "B-U01", start_s: 28800, end_s: 547200 },
    { id: "U02", bay: 1, slot: 1, profile: "bench_manual", batch: "B-U02", start_s: 29700, end_s: null },
    { id: "U03", bay: 1, slot: 2, profile: "bench_manual", batch: null, start_s: null, end_s: null },
  ],
  analyzers: [{ id: "AN-1", profile: "allinone_atline", group: "AIO" }, { id: "AN-2", profile: "allinone_atline", group: "AIO" }],
  staff: [
    { id: "OP-01", on_duty: [[28800, 46800], [115200, 133200]] },
    { id: "OP-02", on_duty: [[28800, 46800], [115200, 133200]] },
    { id: "OP-03", on_duty: [[46800, 64800]] },
  ],
  samples: [
    { id: "U01-D00-1", unit: 0, operator: 0, planned_s: 30000, drawn_s: 30100, arrived_s: 30900, label: "handwritten", kind: "routine", skipped: false,
      visits: [{ analyzer: 0, queued_s: 31000, started_s: 31500, run_started_s: 31500, ended_s: 31770, attempt: 1, qc: "qc_passed", setup_s: 0 }] },
    { id: "U02-D00-1", unit: 1, operator: 1, planned_s: 30500, drawn_s: 30600, arrived_s: 31100, label: "handwritten", kind: "routine", skipped: false,
      visits: [{ analyzer: 1, queued_s: 31200, started_s: 31800, run_started_s: 31800, ended_s: 32070, attempt: 1, qc: "qc_passed", setup_s: 0 }] },
  ],
  marks: [],
  windows: [{ analyzer: 0, kind: "qc", from_s: 28800, to_s: 30600 }, { analyzer: 0, kind: "closed", from_s: 64800, to_s: 115200 }],
  records: [
    { architecture: "a_manual", flags_on: ["audit_trail"], cards: [
      { sample: 0, shown_s: 30000, available_s: null, slots: [], findings: [], versions: 1 },
      { sample: 1, shown_s: 40000, available_s: null, slots: [], findings: [], versions: 1 },
    ] },
    { architecture: "b_lims_lite", flags_on: ["audit_trail", "available_at"], cards: [] },
  ],
};

describe("the clock", () => {
  it("Given seconds of the run Then the clock reads the day and the time (a day is 86400 s; day 0 is a Monday)", () => {
    expect(clockOf(0)).toEqual({ day: 0, time: "00:00" });
    expect(clockOf(28800)).toEqual({ day: 0, time: "08:00" });
    expect(clockOf(86399)).toEqual({ day: 0, time: "23:59" });
    expect(clockOf(115200)).toEqual({ day: 1, time: "08:00" }); // 86400 + 28800
    expect(clockOf(1000000)).toEqual({ day: 11, time: "13:46" }); // 950400 + 49600 s, which is 13 h 46 min 40 s
  });

  it("Given a plan Then its start is the opening of the first staffed window: nobody is on the floor before it", () => {
    expect(startInstant(plan)).toBe(28800);
    expect(startInstant({ ...plan, staff: [] })).toBe(0);
  });
});

describe("the staff on duty", () => {
  it("Given an instant Then the operators whose shift contains it are on duty: the shift opens at its first second and ends before its last", () => {
    expect(onDuty(plan, 28800)).toEqual(["OP-01", "OP-02"]);
    expect(onDuty(plan, 46799)).toEqual(["OP-01", "OP-02"]);
    expect(onDuty(plan, 46800)).toEqual(["OP-03"]); // the shift change
    expect(onDuty(plan, 64800)).toEqual([]);
    expect(onDuty(plan, 0)).toEqual([]);
    expect(onDuty(plan, 115200)).toEqual(["OP-01", "OP-02"]); // day 1
  });
});

describe("the reactors at an instant", () => {
  it("Given a unit that is inoculated and harvested Then it is idle before its start, running from it, and ended from its end", () => {
    const u = plan.units[0] as ScenePlan["units"][number];
    expect([28799, 28800, 547199, 547200].map((t) => statusOf(u, t))).toEqual(["idle", "running", "running", "ended"]);
  });
  it("Given a unit with no end in the plan Then it runs to the end; a unit with no start stays idle", () => {
    expect(statusOf(plan.units[1] as ScenePlan["units"][number], 600000)).toBe("running");
    expect(statusOf(plan.units[2] as ScenePlan["units"][number], 600000)).toBe("idle");
  });
});

describe("the analyzers at an instant", () => {
  it("Given the QC window of AN-1 (28800 to 30600) Then its lamp is qc inside it and idle after it; AN-2 has no window", () => {
    expect(analyzerRowsAt(plan, 28800).map((a) => a.lamp)).toEqual(["qc", "idle"]);
    expect(analyzerRowsAt(plan, 30600).map((a) => a.lamp)).toEqual(["idle", "idle"]);
  });

  it("Given its closed window (64800 to 115200) Then its lamp reads closed", () => {
    expect(analyzerRowsAt(plan, 70000)[0]?.lamp).toBe("closed");
  });

  it("Given two tubes in the lane of the group (queued at 31000 and 31200, started at 31500 and 31800) Then the queue at 31300 is 2, at 31600 is 1, and at 31800 is 0 for both analyzers of the group", () => {
    expect(analyzerRowsAt(plan, 31300).map((a) => a.queue)).toEqual([2, 2]);
    expect(analyzerRowsAt(plan, 31600).map((a) => a.queue)).toEqual([1, 1]);
    expect(analyzerRowsAt(plan, 31800).map((a) => a.queue)).toEqual([0, 0]);
    expect(analyzerRowsAt(plan, 28800).map((a) => a.queue)).toEqual([0, 0]);
  });

  it("Given the rows Then each names its analyzer, profile and group", () => {
    expect(analyzerRowsAt(plan, 0)[1]).toMatchObject({ id: "AN-2", profile: "allinone_atline", group: "AIO" });
  });
});

describe("the record halls at an instant", () => {
  it("Given the cards of A shown at 30000 and 40000 Then A holds none before 30000, one at 35000, two from 40000; B has no card and two flags on", () => {
    expect(hallRowsAt(plan, 29999).map((h) => h.cards)).toEqual([0, 0]);
    expect(hallRowsAt(plan, 35000).map((h) => h.cards)).toEqual([1, 0]);
    expect(hallRowsAt(plan, 40000).map((h) => h.cards)).toEqual([2, 0]);
    expect(hallRowsAt(plan, 0).map((h) => [h.architecture, h.flags])).toEqual([["a_manual", 1], ["b_lims_lite", 2]]);
  });
});

describe("the objects of interest", () => {
  it("Given the plan Then the list is the three reactors, the two analyzers and the two halls, in that order, each with a key", () => {
    const objects = objectsOf(plan);
    expect(objects.map((o) => o.key)).toEqual(["reactor:U01", "reactor:U02", "reactor:U03", "analyzer:AN-1", "analyzer:AN-2", "hall:a_manual", "hall:b_lims_lite"]);
    expect(countsOf(objects)).toEqual({ reactor: 3, analyzer: 2, hall: 2 });
  });
});

describe("the plan and the layout agree (the real plan of the small default scenario)", () => {
  it("Given the plan the Worker builds Then layoutOf of its layout has a vessel for every unit, in the same bay and slot, an analyzer for every analyzer and a hall for every architecture", async () => {
    const data = labData();
    const run = { schema_version: "1" as const, scenario: "default", settings: SMALL, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: [1] };
    const out = await answerPlantRun(data, createChallenges(data), { spec: { run, seed: 1, actions: [] } });
    if (!out.ok) throw new Error(out.message);
    const real = out.answer.plan as ScenePlan;
    const l = layoutOf(real.layout);
    expect(l.vessels).toHaveLength(real.units.length);
    for (const [i, u] of real.units.entries()) expect([l.vessels[i]?.bay, l.vessels[i]?.slot]).toEqual([u.bay - 1, u.slot]);
    expect(l.analyzers.map((a) => a.group)).toEqual(real.analyzers.map((a) => a.group));
    expect(l.halls.map((h) => h.architecture)).toEqual(real.records.map((r) => r.architecture));
    expect(countsOf(objectsOf(real))).toEqual({ reactor: 6, analyzer: 2, hall: 3 });
    // at the start of the plan: nobody before 08:00 of day 0; two operators from it (A098), one reactor inoculated (U01 at 28800 s)
    expect(startInstant(real)).toBe(28800);
    expect(onDuty(real, startInstant(real))).toEqual(["OP-01", "OP-02"]);
    expect(real.units.map((u) => statusOf(u, 28800))).toEqual(["running", "idle", "idle", "idle", "idle", "idle"]);
  }, 60_000);
});

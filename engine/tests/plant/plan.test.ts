import { beforeAll, describe, expect, it } from "vitest";
import { HIDDEN_FIELDS, TRUTH_ONLY_TYPES, observeEvents } from "../../src/observe.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { layoutSpec, plannedIds, scenePlan } from "../../src/experiments/assembly/lab/plant_plan.ts";
import type { ScenePlan } from "../../src/experiments/assembly/lab/plant_plan.ts";
import { recordsOf } from "../../src/experiments/assembly/lab/plant_records.ts";
import { architecturesNamed, labSeed } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { scenarioConfig } from "../../src/experiments/assembly/lab/setup.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";

// P2 (docs/design/plant_ui.md sections 3.3, 4.1 and 6, rule 1): the scene plan. Every expected value is hand arithmetic on the small default scenario, seed 1 (6 reactors in one bay, 8 days,
// A, B and C), or typed from the events of that run, which the goldens of the repository pin: sample U03-D03-1 is planned at 305421 s, drawn at 305626 s by OP-02, received at 306770 s, queued,
// started and run on AN-1 at 306770 s and finished at 307040 s (270 s, the 4.5 min cycle of A023) with QC passed; U03 is inoculated at 30600 s and harvested at 549000 s.

const data = labData();
const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const build = (settings: Record<string, number>) => {
  const spec: RunSpec = { schema_version: "1", scenario: "default", settings, architectures: HALLS, seeds: [1] };
  const { run, input } = labSeed(data, spec, 1, architecturesNamed(data, HALLS));
  const out = runSeed(input);
  const events = observeEvents(run.events);
  const cfg = scenarioConfig(data, "default", settings, 1);
  const records = recordsOf(HALLS.map((id) => out.datasets[id] as RecordedDataset), plannedIds(events));
  return scenePlan({ seed: 1, cfg, events, operators: run.operators.map((o) => o.operator_id), windows: run.l3Input.windows, layout: layoutSpec(data, spec, cfg, HALLS), records });
};

let plan: ScenePlan;
beforeAll(() => {
  plan = build(SMALL);
}, 60_000);
const sample = (id: string) => plan.samples.find((s) => s.id === id);

describe("The scene plan of the small default scenario", () => {
  it("Given the run Then the header and the layout are the shape of the run", () => {
    expect(plan.schema_version).toBe("1");
    expect(plan.seed).toBe(1);
    expect(plan.horizon_s).toBe(691200);
    expect(plan.layout).toEqual({
      bays: [{ size: 6, profile: "bench_manual" }],
      analyzers: [{ profile: "allinone_atline", group: "AIO" }, { profile: "allinone_atline", group: "AIO" }],
      architectures: HALLS,
    });
  });

  it("Given six reactors Then each unit has its bay, slot, profile, batch and the instants of its culture", () => {
    expect(plan.units).toHaveLength(6);
    expect(plan.units[2]).toEqual({ id: "U03", bay: 1, slot: 2, profile: "bench_manual", batch: "B-U03", start_s: 30600, end_s: 549000 });
    expect(plan.units.map((u) => u.start_s)).toEqual([28800, 29700, 30600, 31500, 32400, 33300]);
    expect(plan.units.map((u) => u.end_s)).toEqual([547200, 548100, 549000, 549900, 550800, 551700]);
  });

  it("Given two analyzers Then they are AN-1 and AN-2 of the AIO group", () => {
    expect(plan.analyzers).toEqual([{ id: "AN-1", profile: "allinone_atline", group: "AIO" }, { id: "AN-2", profile: "allinone_atline", group: "AIO" }]);
  });

  it("Given the roster (08:00 to 13:00 for the first shift, 13:00 to 18:00 for the second, a weekend of one operator until 14:00) Then each operator has its shift intervals", () => {
    expect(plan.staff.map((s) => s.id)).toEqual(["OP-01", "OP-02", "OP-03", "OP-04"]);
    const [op1, op2, op3] = plan.staff as [ScenePlan["staff"][number], ScenePlan["staff"][number], ScenePlan["staff"][number]];
    expect(op1.on_duty).toHaveLength(8); // days 0 to 7
    expect(op1.on_duty.slice(0, 2)).toEqual([[28800, 46800], [115200, 133200]]);
    expect(op1.on_duty[5]).toEqual([460800, 482400]); // Saturday, day 5: 08:00 to 14:00
    expect(op1.on_duty[6]).toEqual([547200, 568800]); // Sunday
    expect(op2.on_duty).toHaveLength(6); // weekdays only
    expect(op2.on_duty[5]).toEqual([633600, 651600]); // Monday, day 7
    expect(op3.on_duty).toHaveLength(6);
    expect(op3.on_duty.slice(0, 2)).toEqual([[46800, 64800], [133200, 151200]]);
  });

  it("Given sample U03-D03-1 Then its times, its tube, its label and its one visit are the ones of the log", () => {
    expect(sample("U03-D03-1")).toEqual({
      id: "U03-D03-1", unit: 2, operator: 1, planned_s: 305421, drawn_s: 305626, arrived_s: 306770, label: "handwritten", kind: "routine", skipped: false,
      visits: [{ analyzer: 0, queued_s: 306770, started_s: 306770, run_started_s: 306770, ended_s: 307040, attempt: 1, qc: "qc_passed", setup_s: 0 }],
    });
  });

  it("Given 45 samples drawn Then each is a routine sample with one visit, and the ids are in string order", () => {
    expect(plan.samples).toHaveLength(45);
    expect(plan.samples.every((s) => s.kind === "routine" && !s.skipped && s.visits.length === 1)).toBe(true);
    expect(plan.samples.map((s) => s.id)).toEqual([...plan.samples.map((s) => s.id)].sort());
  });

  it("Given the process events of U03 Then the marks are a temperature shift, two rule feeds and the harvest, at their instants, in log order", () => {
    const u3 = plan.marks.filter((m) => m.unit === 2);
    expect(u3).toEqual([
      { t: 381600, unit: 2, kind: "temperature_shift", source: "scheduled", item: null },
      { t: 381600, unit: 2, kind: "feed", source: "rule", item: null },
      { t: 468000, unit: 2, kind: "feed", source: "rule", item: null },
      { t: 549000, unit: 2, kind: "harvest", source: "scheduled", item: null },
    ]);
  });

  it("Given eight days and two analyzers Then there are 8 QC windows and 8 closed windows each, the last closed window starting before the horizon", () => {
    expect(plan.windows).toHaveLength(32);
    expect(plan.windows.slice(0, 3)).toEqual([
      { analyzer: 0, kind: "qc", from_s: 28800, to_s: 30600 },
      { analyzer: 0, kind: "closed", from_s: 64800, to_s: 115200 },
      { analyzer: 0, kind: "qc", from_s: 115200, to_s: 117000 },
    ]);
    expect(plan.windows.every((w) => w.from_s < plan.horizon_s)).toBe(true);
  });
});

describe("The record halls of the plan", () => {
  const card = (arch: string, id: string) => {
    const hall = plan.records.find((r) => r.architecture === arch);
    return hall?.cards.find((c) => c.sample === plan.samples.findIndex((s) => s.id === id));
  };

  it("Given A, B and C Then one hall each, with the flags that are on and a card for each of the 45 samples", () => {
    expect(plan.records.map((r) => r.architecture)).toEqual(HALLS);
    expect(plan.records.map((r) => r.flags_on)).toEqual([
      [],
      ["system_issued_id", "ingest_idempotency", "audit_trail", "equipment_links"],
      ["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail", "material_lot_links", "equipment_links"],
    ]);
    expect(plan.records.map((r) => r.cards.length)).toEqual([45, 45, 45]);
  });

  it("Given sample U03-D03-1 in A (no flag) Then the card appears at the run's start, knows no sampled_at and no availability, and joins the process by measured_at", () => {
    expect(card("a_manual", "U03-D03-1")).toEqual({
      sample: plan.samples.findIndex((s) => s.id === "U03-D03-1"), shown_s: 306770, available_s: null, findings: [], versions: 1,
      slots: [{ name: "unit", stored: true }, { name: "sampled_at", stored: false }, { name: "context", stored: true, basis: "measured_at" }, { name: "value", stored: true }],
    });
  });

  it("Given the same sample in B Then still no sampled_at and no availability, and the join is by measured_at", () => {
    expect(card("b_lims_lite", "U03-D03-1")).toMatchObject({ shown_s: 306770, available_s: null, slots: [{ name: "unit", stored: true }, { name: "sampled_at", stored: false }, { name: "context", stored: true, basis: "measured_at" }, { name: "value", stored: true }] });
  });

  it("Given the same sample in C Then sampled_at is stored, the result is available at 307040 s and the join is by sampled_at", () => {
    expect(card("c_context", "U03-D03-1")).toEqual({
      sample: plan.samples.findIndex((s) => s.id === "U03-D03-1"), shown_s: 306770, available_s: 307040, findings: [], versions: 1,
      slots: [{ name: "unit", stored: true }, { name: "sampled_at", stored: true }, { name: "context", stored: true, basis: "sampled_at" }, { name: "value", stored: true }],
    });
  });

  it("Given every card of every hall Then a slot is stored exactly as the flags say: sampled_at only with two_clocks, a basis only on a stored context, an availability only with available_at", () => {
    for (const hall of plan.records) {
      for (const c of hall.cards) {
        const slot = (name: string) => c.slots.find((s) => s.name === name);
        expect(slot("sampled_at")?.stored, `${hall.architecture} ${c.sample}`).toBe(hall.flags_on.includes("two_clocks"));
        expect("basis" in (slot("context") ?? {}), hall.architecture).toBe(slot("context")?.stored);
        expect(c.available_s !== null, hall.architecture).toBe(hall.flags_on.includes("available_at"));
        expect(c.slots.map((s) => s.name)).toEqual(["unit", "sampled_at", "context", "value"]);
      }
    }
  });
});

describe("A skipped draw (the volume cap lowered to 0.1 percent, A207): U05-D05-1 reaches the vessel and no tube appears", () => {
  it("Given the run Then the sample has the instant of the attempt, no tube, no label, no operator and no visit; and no hall holds a card for it", () => {
    const capped = build({ ...SMALL, volume_cap_pct: 0.1 });
    const i = capped.samples.findIndex((s) => s.id === "U05-D05-1");
    expect(capped.samples[i]).toEqual({ id: "U05-D05-1", unit: 4, operator: null, planned_s: 462999, drawn_s: 463195, arrived_s: null, label: null, kind: "routine", skipped: true, visits: [] });
    expect(capped.samples.filter((s) => s.skipped).map((s) => s.id)).toEqual(["U02-D05-1", "U05-D05-1", "U06-D06-1"]);
    for (const hall of capped.records) expect(hall.cards.some((c) => c.sample === i), hall.architecture).toBe(false);
  }, 60_000);
});

describe("The truth boundary of the plan (lab_ui.md section 4, rule 1 as amended)", () => {
  // The allow-list is typed from plant_ui.md section 4.1: the exact keys at every level.
  const SHAPE: Record<string, readonly string[]> = {
    plan: ["schema_version", "seed", "horizon_s", "layout", "units", "analyzers", "staff", "samples", "marks", "windows", "records"],
    layout: ["bays", "analyzers", "architectures"],
    bay: ["size", "profile"],
    layoutAnalyzer: ["profile", "group"],
    unit: ["id", "bay", "slot", "profile", "batch", "start_s", "end_s"],
    analyzer: ["id", "profile", "group"],
    staff: ["id", "on_duty"],
    sample: ["id", "unit", "operator", "planned_s", "drawn_s", "arrived_s", "label", "kind", "skipped", "visits"],
    visit: ["analyzer", "queued_s", "started_s", "run_started_s", "ended_s", "attempt", "qc", "setup_s"],
    mark: ["t", "unit", "kind", "source", "item"],
    window: ["analyzer", "kind", "from_s", "to_s"],
    record: ["architecture", "flags_on", "cards"],
    card: ["sample", "shown_s", "available_s", "slots", "findings", "versions"],
    slot: ["name", "stored", "basis"],
  };
  const keys = (o: object): string[] => Object.keys(o);

  it("Given the plan Then every object has keys from the allow-list of section 4.1 and nothing else", () => {
    const within = (o: object, shape: string, where: string): void => {
      for (const k of keys(o)) expect(SHAPE[shape], `${where}.${k}`).toContain(k);
    };
    within(plan, "plan", "plan");
    expect(keys(plan).sort()).toEqual([...(SHAPE.plan as string[])].sort());
    within(plan.layout, "layout", "layout");
    plan.layout.bays.forEach((b) => within(b, "bay", "bay"));
    plan.layout.analyzers.forEach((a) => within(a, "layoutAnalyzer", "layout.analyzer"));
    plan.units.forEach((u) => within(u, "unit", "unit"));
    plan.analyzers.forEach((a) => within(a, "analyzer", "analyzer"));
    plan.staff.forEach((s) => within(s, "staff", "staff"));
    plan.samples.forEach((s) => { within(s, "sample", "sample"); s.visits.forEach((v) => within(v, "visit", "visit")); });
    plan.marks.forEach((m) => within(m, "mark", "mark"));
    plan.windows.forEach((w) => within(w, "window", "window"));
    plan.records.forEach((r) => { within(r, "record", "record"); r.cards.forEach((c) => { within(c, "card", "card"); c.slots.forEach((s) => within(s, "slot", "slot")); }); });
  });

  it("Given the plan as JSON Then no key of HIDDEN_FIELDS appears at any depth, no truth-only type appears as a value, and no field is called value, true_state or verdict", () => {
    const hidden = new Set([...Object.values(HIDDEN_FIELDS).flat(), "value", "verdict", "onset", "origin", "materialised", "answer", "pv"]);
    const seen = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node !== null && typeof node === "object") for (const [k, v] of Object.entries(node)) { seen.add(k); walk(v); }
      else if (typeof node === "string") expect((TRUTH_ONLY_TYPES as readonly string[]).includes(node), node).toBe(false);
    };
    walk(plan);
    expect([...seen].filter((k) => hidden.has(k))).toEqual([]);
    expect(seen.size).toBeGreaterThan(30); // the walk saw the plan
  });

  it("Given the plan Then it is a tree of numbers, strings, booleans, null and arrays: JSON gives it back unchanged, and it is built the same way twice", () => {
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(JSON.stringify(build(SMALL))).toBe(JSON.stringify(plan));
  }, 60_000);

  it("Given the run of a scenario with a break-out event Then the truth-only type contamination_onset is not in the events the plan is built from", () => {
    expect(TRUTH_ONLY_TYPES).toEqual(["contamination_onset"]);
    expect(observeEvents([{ type: "contamination_onset", t: 5, unit_id: "U01", batch_id: "B-U01", contamination_type: "bacterial", origin_kind: "seed_lot", origin_id: "SL-1" }])).toEqual([]);
  });
});

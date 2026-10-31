import { describe, expect, it } from "vitest";
import { truthFromRun } from "../../src/evaluate/truth.ts";
import { seedInputFromRun } from "../../src/experiments/assembly/from_run.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { runScenario } from "../../src/run.ts";
import { configOf, docOf, eventsOf, fx12a } from "../breakout/support.ts";
import { ALL_ARCHS, openLoopInput } from "../support/open_loop_setup.ts";
import { REVIEW } from "../support/review_setup.ts";

// Break-out batch 6, task 1: the follow-ups that the reviews of batches 3 to 5 name. Expected values are typed by hand from the FX12a layout of spec 11.8.4: three seed lots and three
// medium lots, three units, one medium addition of ML-1 for U01 and for U02, one of ML-3 for U03 and the contaminated ML-2 for U01 (four consumed_in edges) and one seed lot per unit
// (three seeded_from edges).

const C = ALL_ARCHS.find((a) => a.id === "c_context") as (typeof ALL_ARCHS)[number];
const base = openLoopInput([1], { architectures: [C] });
const settings = { scenario_id: "fx", staff: base.staff, evaluation: base.evaluation, architectures: [C], days: 21, review: REVIEW };

describe("Break-out follow-up 1: the assembly hands the master data of the topology to the recorder", () => {
  const cfg = configOf(docOf(fx12a()));
  const run = runScenario(cfg);

  it("Given a scenario with a breakout block When the assembly records it under C Then the dataset has the six lots, seven edges and one deviation", () => {
    const ds = runSeed(seedInputFromRun(run, { ...settings, breakout: cfg.breakout })).datasets.c_context;
    expect((ds?.material_lot ?? []).map((l) => l.lot_id).sort()).toEqual(["ML-1", "ML-2", "ML-3", "SL-1", "SL-2", "SL-3"]);
    expect((ds?.lineage_edge ?? []).filter((e) => e.relation === "consumed_in").length).toBe(4);
    expect((ds?.lineage_edge ?? []).filter((e) => e.relation === "seeded_from").length).toBe(3);
    expect((ds?.deviation ?? []).length).toBe(1);
  });

  it("Given a scenario with no breakout block Then the seed input has no breakout member and no dataset has a break-out table (absent, not empty)", () => {
    const plain = runScenario(configOf(docOf()));
    const input = seedInputFromRun(plain, settings);
    expect("breakout" in input).toBe(false);
    const ds = runSeed(input).datasets.c_context as object;
    for (const table of ["material_lot", "equipment", "lineage_edge", "deviation", "quality_hold"]) expect(table in ds, table).toBe(false);
  });
});

describe("Break-out follow-up 2: a skipped confirming draw is not an analysis request", () => {
  // the micro-scale vessel refuses the 42 mL confirming sample of U01 and of U02 (cap 4125 uL), and it refuses some routine draws too (spec 11.8.2 rule S3)
  const doc = docOf(fx12a(), {}, { profiles: { bioreactor: "micro_mini_parallel", analyzer: "allinone_atline", staff: "experienced" } });
  const run = runScenario(configOf(doc));
  const skipped = eventsOf(run, "draw_skipped_volume_budget");

  it("Given two confirming draws skipped for the volume budget Then the truth counts the drawn samples and the routine refusals, and none of the two", () => {
    expect(skipped.filter((e) => e.sample_id.endsWith("-CONF")).map((e) => e.sample_id)).toEqual(["U01-CONF", "U02-CONF"]);
    const routine = skipped.filter((e) => !e.sample_id.endsWith("-CONF")).length;
    expect(routine).toBeGreaterThan(0);
    const requests = truthFromRun(run).requests;
    expect(requests.length).toBe(eventsOf(run, "sample_drawn").length + routine);
    expect(requests.some((r) => r.request_id.endsWith("-CONF"))).toBe(false);
    expect(requests.filter((r) => r.skipped).length).toBe(routine);
  });
});

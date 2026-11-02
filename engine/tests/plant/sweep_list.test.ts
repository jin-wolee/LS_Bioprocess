import { describe, expect, it } from "vitest";
import { checkPlantSpec } from "../../src/experiments/assembly/lab/plant.ts";
import { RUN_SIZE_CAP, runSize } from "../../src/experiments/assembly/lab/settings_bounds.ts";
import { scenarioDoc } from "../../src/experiments/assembly/lab/setup.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";

// P6c (docs/design/plant_ui.md section 10, "The sweep"): the list of the settings sweep, tests/fixtures/plant/sweep/specs.json, is typed by hand. This test reads the file and checks it against hand arithmetic:
// the ten names in their order, the halls, the seeds, that every spec is a spec the Worker accepts under the bounds of lab_ui.md section 4, and the size of the large plant's run, typed from the settings:
// (100 reactors + 6 analyzers + 8 operators a weekday shift + 4 at the weekend) x 21 days x 86,400 s / 60 s = 118 x 21 x 1,440 = 3,568,320 steps, under the cap of 10,000,000.

interface SweepSpec {
  name: string;
  title: string;
  run: { scenario: string; settings: Record<string, number>; bay_profiles?: string[]; analyzer_profiles?: string[]; capture_path?: string; architectures: string[] };
  seed: number;
  look_s: number;
  action: { kind: string; at: number; unit_id: string };
  frames: boolean;
  gate: boolean;
  phone: boolean;
  judged: boolean;
}
const list = readJson<{ schema_version: string; specs: SweepSpec[] }>("tests", "fixtures", "plant", "sweep", "specs.json");
const byName = (name: string): SweepSpec => list.specs.find((s) => s.name === name) as SweepSpec;
const DAY = 86_400;

describe("the list of the settings sweep", () => {
  it("Given the file Then it holds the ten specs of the brief, in this order, each with the three halls and a seed", () => {
    expect(list.schema_version).toBe("1");
    expect(list.specs.map((s) => [s.name, s.run.scenario, s.seed])).toEqual([
      ["default_seed1", "default", 1], ["default_seed2", "default", 2], ["default_seed3", "default", 3],
      ["sc02_burst_seed1", "sc02_shift_burst", 1], ["sc03_gap_seed1", "sc03_feed_in_gap", 1], ["sc05_down_seed1", "sc05_one_analyzer_down", 1],
      ["small_seed1", "default", 1], ["large_seed1", "default", 1], ["mixed_seed1", "default", 1], ["capture_seed1", "default", 1],
    ]);
    for (const s of list.specs) expect(s.run.architectures, s.name).toEqual(["a_manual", "b_lims_lite", "c_context"]);
  });

  it("Given the specs Then the frames are measured on 1, 7 and 8 only, the gate runs 2 and 7, and only the large plant is also shot at 390 by 844", () => {
    expect(list.specs.filter((s) => s.frames).map((s) => s.name)).toEqual(["default_seed1", "small_seed1", "large_seed1"]);
    expect(list.specs.filter((s) => s.gate).map((s) => s.name)).toEqual(["default_seed2", "small_seed1"]);
    expect(list.specs.filter((s) => s.phone).map((s) => s.name)).toEqual(["large_seed1"]);
  });

  it("Given the author's decision of 2026-11-02 Then only the large plant's times are not judged against the budgets", () => {
    expect(list.specs.filter((s) => !s.judged).map((s) => s.name)).toEqual(["large_seed1"]);
  });

  it("Given the small plant Then its settings are those of SMALL (6 reactors in one bay, 8 days, a production of 6) and nothing else", () => {
    expect(byName("small_seed1").run.settings).toEqual({ reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 8, production_days: 6 });
  });

  it("Given the large plant Then it is 100 reactors in bays of 12, four cohorts of 25, 6 analyzers and 8 operators a shift with 4 at the weekend", () => {
    expect(byName("large_seed1").run.settings).toEqual({ reactor_count: 100, bay_size: 12, cohort_size: 25, analyzer_count: 6, operators_per_shift: 8, weekend_operators: 4 });
  });

  it("Given the mixed spec Then it names three bay profiles that differ and analyzer profiles that include the split pair, one for each of the three bays and two analyzers", () => {
    const run = byName("mixed_seed1").run;
    expect(run.settings).toEqual({ reactor_count: 18, bay_size: 6, cohort_size: 6 });
    expect(run.bay_profiles).toEqual(["bench_manual", "micro_mini_parallel", "pilot"]);
    expect(run.analyzer_profiles).toEqual(["split_cellcounter_metabolite", "hplc"]);
  });

  it("Given the capture spec Then it is the default scenario with the path adapter_ingest and nothing else", () => {
    expect(byName("capture_seed1").run).toEqual({ scenario: "default", settings: {}, capture_path: "adapter_ingest", architectures: ["a_manual", "b_lims_lite", "c_context"] });
  });

  it("Given the instants Then the action is a feed at 09:00 on the day of the look and the look is at 08:40, on day 8 (day 3 for the small plant, whose culture is 8 days)", () => {
    for (const s of list.specs) {
      const day = s.name === "small_seed1" ? 3 : 8;
      expect([s.look_s, s.action.at, s.action.kind], s.name).toEqual([day * DAY + 8 * 3600 + 40 * 60, day * DAY + 9 * 3600, "add_feed"]);
    }
    expect(byName("small_seed1").action.unit_id).toBe("U03");
    expect(byName("default_seed1").action.unit_id).toBe("U10");
  });

  it("Given every spec Then the Worker's own check accepts it as a plant spec (the bounds of lab_ui.md section 4 and the cap on the size of a run)", () => {
    const data = labData();
    for (const s of list.specs) {
      const checked = checkPlantSpec({ run: { schema_version: "1", ...s.run, seeds: [s.seed] }, seed: s.seed, actions: [] }, data);
      expect(checked.ok, `${s.name}: ${checked.ok ? "" : checked.message}`).toBe(true);
    }
  });

  it("Given the large plant Then the size of its run is 3,568,320, under the cap of 10,000,000", () => {
    const own = Object.fromEntries(Object.entries(scenarioDoc(labData(), "default").settings).map(([name, s]) => [name, s.value]));
    expect(runSize({ ...own, ...byName("large_seed1").run.settings })).toBe(3_568_320);
    expect(3_568_320).toBeLessThan(RUN_SIZE_CAP);
  });
});

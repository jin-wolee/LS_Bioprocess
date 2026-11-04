import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerBreakout } from "../../src/experiments/assembly/lab/breakout.ts";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { answerPlantRun, checkPlantSpec, runPlant } from "../../src/experiments/assembly/lab/plant.ts";
import { answerPlantCase } from "../../src/experiments/assembly/lab/plant_case.ts";
import { ENGINE_VERSION } from "../../src/trace.ts";
import { breakoutData } from "../lab/breakout_data.ts";
import { labData } from "../support/lab_data.ts";
import { ENGINE_NODE_FLAGS } from "../support/node_flags.ts";
import { ROOT, listFiles } from "../support/paths.ts";

// P6c adds the sweep: the same file holds an entry for each spec of tests/fixtures/plant/sweep/specs.json (the truth hash and the digest of the cells of each hall, no action), and the test below
// checks it against the list's names typed by hand, the BASE of the small plant, and what runPlant answers for every spec.
// P6a (docs/design/plant_ui.md section 5.7, item 3): engine/tests/support/plant_reference_cli.ts runs the hand scenario of every fixture of tests/fixtures/plant/ under the engine's flags and writes
// plant_reference.json, which the end-to-end check `plant_equal` compares with the hashes the page shows. This test runs the CLI, checks that the file holds every fixture, and checks its hashes
// against what engine/tests/plant/proof.test.ts already proves: the truth hash of the base run (taken at the base commit 26e1580, typed here again) is what a lab setting leaves, a flag switched in
// one hall changes the cells of that hall only, and the Worker's answer for each fixture's actions is the reference's entry.

const CLI = join(ROOT, "engine", "tests", "support", "plant_reference_cli.ts");
const scratch = mkdtempSync(join(tmpdir(), "plant-reference-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// the small default scenario, seed 1, under A, B and C with no action: the BASE of proof.test.ts
const BASE = {
  truth: "9692942bf38f16b7826732e379dec3c721210c4a2c35839fd6f6e2cc5856c46d",
  cells: { a_manual: "4dd4b2452bdab1b53227554f37e214518969bdf4b1a544ddc5286c50a442e117", b_lims_lite: "67819158b45604fa3d97a439384042b46c036b607a12f52afa7eac39abb13050", c_context: "844ed248088e7fe70f7dc53224f1976d71d0a4abc082977ac8ffacff7accba00" },
};
// typed by hand from the fixtures
const NAMES = ["add_feed", "analyzer_down", "change_lot", "move_draw", "raise_alarm", "set_capture_path", "set_flag_b", "set_flag_c", "set_labelling", "three_together"];
const SMALL = { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 8, production_days: 6 };
const HALLS = ["a_manual", "b_lims_lite", "c_context"];
// P6c: the specs of tests/fixtures/plant/sweep/specs.json, typed by hand in the order of the file
const SWEEP_NAMES = [
  "default_seed1", "default_seed2", "default_seed3", "sc02_burst_seed1", "sc03_gap_seed1", "sc05_down_seed1", "small_seed1", "large_seed1", "mixed_seed1", "capture_seed1",
];
const SWEEP_SEEDS = [1, 2, 3, 1, 1, 1, 1, 1, 1, 1];

interface Entry { name: string; actions: unknown[]; spec: { scenario: string; settings: Record<string, number>; seed: number; architectures: string[] }; truth: string; cells: Record<string, string> }
interface SweepEntry { name: string; seed: number; truth: string; cells: Record<string, string> }
interface Reference { schema_version: string; engine_version: string; node: { version: string; flags: string[] }; fixtures: Entry[]; sweep: SweepEntry[] }

let reference: Reference;
const entry = (name: string): Entry => reference.fixtures.find((e) => e.name === name) as Entry;
const swept = (name: string): SweepEntry => reference.sweep.find((e) => e.name === name) as SweepEntry;

beforeAll(() => {
  const out = join(scratch, "plant_reference.json");
  const done = spawnSync(process.execPath, [...ENGINE_NODE_FLAGS, CLI, out], { cwd: ROOT, encoding: "utf8", timeout: 240_000 });
  expect(done.status, done.stderr).toBe(0);
  reference = JSON.parse(readFileSync(out, "utf8")) as Reference;
}, 300_000);

describe("plant_reference_cli", () => {
  it("Given the fixtures of the folder Then the file holds every one of them, by name, with its actions, and says which engine and which Node made it", () => {
    expect(listFiles("tests", "fixtures", "plant").filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""))).toEqual(NAMES);
    expect(reference.fixtures.map((e) => e.name)).toEqual(NAMES);
    expect(reference).toMatchObject({ schema_version: "1", engine_version: ENGINE_VERSION, node: { version: process.version, flags: ["--no-maglev-escape-analysis"] } });
    for (const e of reference.fixtures) {
      const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "plant", `${e.name}.json`), "utf8")) as { actions: unknown[] };
      expect(e.actions, e.name).toEqual(fixture.actions);
    }
  });

  it("Given an entry Then it carries the spec the page opens it on: the small default scenario, seed 1, the three halls", () => {
    for (const e of reference.fixtures) expect(e.spec, e.name).toEqual({ scenario: "default", settings: SMALL, seed: 1, architectures: HALLS });
  });

  it("Given every entry Then its truth hash is 64 hex digits and it has a digest of the cells for each hall; a flag switched in a hall names the derived hall", () => {
    for (const e of reference.fixtures) {
      expect(e.truth, e.name).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.values(e.cells).every((d) => /^[0-9a-f]{64}$/.test(d)), e.name).toBe(true);
      expect(Object.keys(e.cells), e.name).toEqual(e.name === "set_flag_b" ? ["a_manual", "b_lims_lite_plus_available_at", "c_context"] : e.name === "set_flag_c" ? ["a_manual", "b_lims_lite", "c_context_minus_audit_trail"] : HALLS);
    }
  });

  it("Given a lab setting Then the truth hash is the one of the base run (proof.test.ts: a lab setting leaves the truth log as it was)", () => {
    for (const name of ["set_capture_path", "set_flag_b", "set_flag_c"]) expect(entry(name).truth, name).toBe(BASE.truth);
  });

  it("Given a flag switched in one hall Then only the cells of that hall differ from the base run (section 5.7, item 8)", () => {
    const b = entry("set_flag_b").cells;
    expect([b.a_manual, b.c_context]).toEqual([BASE.cells.a_manual, BASE.cells.c_context]);
    expect(b.b_lims_lite_plus_available_at).not.toBe(BASE.cells.b_lims_lite);
    const c = entry("set_flag_c").cells;
    expect([c.a_manual, c.b_lims_lite]).toEqual([BASE.cells.a_manual, BASE.cells.b_lims_lite]);
    expect(c.c_context_minus_audit_trail).not.toBe(BASE.cells.c_context);
  });

  it("Given a plant action Then the truth hash is not the base run's, and given the plant's own answer for the fixture's actions Then its hashes are the entry's, for every fixture", async () => {
    const data = labData();
    const challenges = createChallenges(data);
    for (const e of reference.fixtures) {
      const spec = { run: { schema_version: "1", scenario: e.spec.scenario, settings: e.spec.settings, architectures: e.spec.architectures, seeds: [e.spec.seed] }, seed: e.spec.seed, actions: e.actions };
      const out = await answerPlantRun(data, challenges, { spec });
      if (!out.ok) throw new Error(`${e.name}: ${out.message}`);
      expect(out.answer.hashes, e.name).toEqual({ truth: e.truth, cells: e.cells });
      if (["add_feed", "raise_alarm", "move_draw", "analyzer_down", "change_lot", "three_together"].includes(e.name)) expect(e.truth, e.name).not.toBe(BASE.truth);
    }
  }, 300_000);
});

describe("plant_reference_cli: the sweep of P6c (docs/design/plant_ui.md section 10)", () => {
  it("Given the list of the sweep Then the file holds every spec of it, by name and in its order, with the seed and a digest of the cells for each of the three halls", () => {
    expect(reference.sweep.map((e) => [e.name, e.seed])).toEqual(SWEEP_NAMES.map((n, i) => [n, SWEEP_SEEDS[i]]));
    for (const e of reference.sweep) {
      expect(e.truth, e.name).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(e.cells), e.name).toEqual(HALLS);
      expect(Object.values(e.cells).every((d) => /^[0-9a-f]{64}$/.test(d)), e.name).toBe(true);
    }
  });

  it("Given the small plant Then its entry is the run of the hand fixtures with no action: the BASE typed above, the same truth hash and the same three digests", () => {
    expect(swept("small_seed1")).toMatchObject(BASE);
  });

  it("Given three seeds of the default scenario Then the three truth hashes differ", () => {
    expect(new Set(["default_seed1", "default_seed2", "default_seed3"].map((n) => swept(n).truth)).size).toBe(3);
  });

  it("Given the capture path as the only change to the default scenario Then the truth hash is spec 1's (a lab setting leaves the truth log) and the cells of some hall are not", () => {
    expect(swept("capture_seed1").truth).toBe(swept("default_seed1").truth);
    expect(HALLS.some((h) => swept("capture_seed1").cells[h] !== swept("default_seed1").cells[h])).toBe(true);
  });

  it("Given the SC2, SC3 and SC5 scenarios and the large and mixed plants Then each truth hash is neither the default scenario's nor another spec's of seed 1", () => {
    const seed1 = ["default_seed1", "sc02_burst_seed1", "sc03_gap_seed1", "sc05_down_seed1", "small_seed1", "large_seed1", "mixed_seed1"].map((n) => swept(n).truth);
    expect(new Set(seed1).size).toBe(seed1.length);
  });

  it("Given each spec of the list Then the plant's own answer for it (runPlant, no action) has the hashes of its entry", async () => {
    const data = labData();
    const list = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "plant", "sweep", "specs.json"), "utf8")) as { specs: { name: string; seed: number; run: Record<string, unknown> }[] };
    for (const s of list.specs) {
      const checked = checkPlantSpec({ run: { schema_version: "1", ...s.run, seeds: [s.seed] }, seed: s.seed, actions: [] }, data);
      if (!checked.ok) throw new Error(`${s.name}: ${checked.message}`);
      const out = await runPlant(data, checked.spec);
      if (!out.ok) throw new Error(`${s.name}: ${out.message}`);
      expect(out.answer.hashes, s.name).toEqual({ truth: swept(s.name).truth, cells: swept(s.name).cells });
    }
  }, 300_000);
});

describe("plant_reference_cli: the break-out case of P7b (docs/design/plant_ui.md section 10)", () => {
  // typed by hand: the medium-lot case at seed 9013 (the seed the Break-out check of the lab uses) under the five records of the Break-out form
  const CASE = "sc12_medium_lot";
  const ARCH5 = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"];
  type BreakoutEntry = { case: string; seed: number; architectures: string[]; truth: string; cells: Record<string, string> };
  const entries = (): BreakoutEntry[] => (reference as unknown as { breakout?: BreakoutEntry[] }).breakout ?? [];

  it("Given the file Then it holds one break-out entry: the case, the seed, the five records, the truth hash and a digest of the cell of each record", () => {
    expect(entries()).toHaveLength(1);
    const e = entries()[0] as BreakoutEntry;
    expect([e.case, e.seed, e.architectures]).toEqual([CASE, 9013, ARCH5]);
    expect(e.truth).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(e.cells).sort()).toEqual([...ARCH5].sort()); // the file is written in canonical key order
    expect(Object.values(e.cells).every((d) => /^[0-9a-f]{64}$/.test(d))).toBe(true);
  });

  it("Given the entry Then the plant's own answer for the case (runPlantCase, no action) has its hashes", async () => {
    const e = entries()[0] as BreakoutEntry;
    const out = await answerPlantCase(breakoutData(), { case: e.case, architectures: e.architectures, seed: e.seed, actions: [] });
    if (!out.ok) throw new Error(out.message);
    expect(out.answer.hashes).toEqual({ truth: e.truth, cells: e.cells });
  }, 120_000);

  it("Given the entry Then its hashes are the Break-out request's: the truth_log_hash of the answer, and a cell digest that differs between a record with the lot links and one without", async () => {
    const e = entries()[0] as BreakoutEntry;
    const screen = await answerBreakout(breakoutData(), { case: e.case, architectures: e.architectures, seed: e.seed });
    if (!screen.ok) throw new Error(screen.message);
    expect(screen.result.truth_log_hash).toBe(e.truth);
    expect(e.cells.c_context).not.toBe(e.cells.c_context_minus_material_lot_links);
  }, 120_000);
});

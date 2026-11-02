import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { answerPlantRun } from "../../src/experiments/assembly/lab/plant.ts";
import { ENGINE_VERSION } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { ENGINE_NODE_FLAGS } from "../support/node_flags.ts";
import { ROOT, listFiles } from "../support/paths.ts";

// P6a (docs/design/plant_ui.md section 5.7, item 3): engine/tests/support/plant_reference_cli.ts runs the hand scenario of every fixture of tests/fixtures/plant/ under the engine's flags and writes
// plant_reference.json, which the end-to-end check `plant_equal` compares with the hashes the page shows. This test runs the CLI, checks that the file holds every fixture, and checks its hashes
// against what engine/tests/plant/proof.test.ts already proves: the truth hash of the base run (taken at the base commit be98442, typed here again) is what a lab setting leaves, a flag switched in
// one hall changes the cells of that hall only, and the Worker's answer for each fixture's actions is the reference's entry.

const CLI = join(ROOT, "engine", "tests", "support", "plant_reference_cli.ts");
const scratch = mkdtempSync(join(tmpdir(), "plant-reference-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// the small default scenario, seed 1, under A, B and C with no action: the BASE of proof.test.ts
const BASE = {
  truth: "9692942bf38f16b7826732e379dec3c721210c4a2c35839fd6f6e2cc5856c46d",
  cells: { a_manual: "865965eccd541a5e330de9f66aad07332f74097971d96bd1b66cae4993456eab", b_lims_lite: "d5362a2426e480214c43827a8995e48bdc6e6ed02b7161af3d205aaa68dce21c", c_context: "dd6f6686ec1995793d794307ba449f4790cd1dc24eb808224ec2b2333f94cc20" },
};
// typed by hand from the fixtures
const NAMES = ["add_feed", "analyzer_down", "change_lot", "move_draw", "raise_alarm", "set_capture_path", "set_flag_b", "set_flag_c", "set_labelling", "three_together"];
const SMALL = { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 8, production_days: 6 };
const HALLS = ["a_manual", "b_lims_lite", "c_context"];

interface Entry { name: string; actions: unknown[]; spec: { scenario: string; settings: Record<string, number>; seed: number; architectures: string[] }; truth: string; cells: Record<string, string> }
interface Reference { schema_version: string; engine_version: string; node: { version: string; flags: string[] }; fixtures: Entry[] }

let reference: Reference;
const entry = (name: string): Entry => reference.fixtures.find((e) => e.name === name) as Entry;

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

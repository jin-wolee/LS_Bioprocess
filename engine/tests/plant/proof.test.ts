import { describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { answerPlantRun, runPlant } from "../../src/experiments/assembly/lab/plant.ts";
import type { PlantKept, PlantSpec } from "../../src/experiments/assembly/lab/plant.ts";
import type { Action } from "../../src/experiments/assembly/lab/actions.ts";
import { labSeedOf } from "../../src/experiments/assembly/lab/seed_setup.ts";
import { scenarioConfig } from "../../src/experiments/assembly/lab/setup.ts";
import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { canonicalJson, logHash, sha256Hex } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, patched, rawScenario } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";

// P2 (docs/design/plant_ui.md section 5.7): a recomputed run with actions equals the same scenario with the actions written in by hand. The hand fixtures under tests/fixtures/plant/ are the
// scenario fields, the capture path and the record halls typed from the mapping of section 5.2; here they are run by the lab's own path (no plant code) and the hashes are compared with what
// the plant answers. The strict log hash and the digest of the metric cells of each hall are those of lab_ui.md section 7.

const data = labData();
const challenges = createChallenges(data);
const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const FIXTURES = ["add_feed", "raise_alarm", "move_draw", "analyzer_down", "change_lot", "set_labelling", "set_capture_path", "set_flag_c", "set_flag_b", "three_together"];
interface Fixture { actions: Action[]; hand: { scenario_fields: Json; capture_path?: "manual_transcription" | "adapter_ingest"; architectures: (string | Json)[] } }
const fixture = (name: string): Fixture => readJson<Fixture>("tests", "fixtures", "plant", `${name}.json`);
const plantSpec = (actions: readonly unknown[]) => ({ run: { schema_version: "1", scenario: "default", settings: SMALL, architectures: HALLS, seeds: [1] }, seed: 1, actions });

/** The run of the hand-written fixture by the lab's own path: no plant module is involved. */
const byHand = async (f: Fixture) => {
  const handData: LabData = { ...data, scenarios: { ...data.scenarios, default: patched(rawScenario("default"), { fields: f.hand.scenario_fields }) } };
  const halls = f.hand.architectures.map((a) => parseArchitecture(typeof a === "string" ? readJson("data", "scenarios", "architectures", `${a}.json`) : a));
  const spec = { schema_version: "1" as const, scenario: "default", settings: SMALL, architectures: HALLS, seeds: [1] };
  const config = scenarioConfig(handData, "default", SMALL, 1, f.hand.capture_path ? { capture_path: f.hand.capture_path } : {});
  const { run, input } = labSeedOf(handData, spec, config, halls);
  const out = runSeed(input);
  return {
    truth: await logHash(run.events),
    cells: Object.fromEntries(await Promise.all(out.cells.map(async (c, i) => [(halls[i] as { id: string }).id, await sha256Hex(canonicalJson(c))] as const))),
    events: run.events,
  };
};

const ask = async (actions: readonly Action[], previous?: PlantKept) => {
  const out = await answerPlantRun(data, challenges, { spec: plantSpec(actions) }, previous);
  if (!out.ok) throw new Error(`refused: ${out.message}`);
  return out;
};

// Taken at the base commit 26e1580, before any engine code changed (the script is kept outside the repository): the small default scenario, seed 1, under A, B and C. The three cell hashes
// were taken again in A2 (2026-11-02, approved in advance; audit F4): the utilisation per staffed window follows the roster, and nothing else in a cell moved. The truth hash is the base commit's.
const BASE = {
  truth: "9692942bf38f16b7826732e379dec3c721210c4a2c35839fd6f6e2cc5856c46d",
  cells: { a_manual: "4dd4b2452bdab1b53227554f37e214518969bdf4b1a544ddc5286c50a442e117", b_lims_lite: "67819158b45604fa3d97a439384042b46c036b607a12f52afa7eac39abb13050", c_context: "844ed248088e7fe70f7dc53224f1976d71d0a4abc082977ac8ffacff7accba00" },
};

describe("5.7 items 2 and 3: the plant's answer for the actions equals the run of the scenario written by hand", () => {
  it("Given no action Then the hashes are the ones of the base commit (the plant adds nothing to a run that has no action)", async () => {
    const { answer } = await ask([]);
    expect(answer.hashes).toEqual(BASE);
    expect(answer.resume_at).toBe(0);
    expect(answer.checks).toEqual({ prefix_equal: null, truth_equal: null });
  }, 60_000);

  it.each(FIXTURES)("Given the fixture %s Then the truth hash and the cells digest of every hall equal those of the hand-written run", async (name) => {
    const f = fixture(name);
    const [{ answer }, hand] = [await ask(f.actions), await byHand(f)];
    expect(answer.hashes.truth).toBe(hand.truth);
    expect(answer.hashes.cells).toEqual(hand.cells);
  }, 60_000);

  it("Given a plant action Then the answer differs from the base run (the actions are not ignored); a lab setting leaves the truth hash as it was", async () => {
    for (const name of ["add_feed", "raise_alarm", "move_draw", "analyzer_down", "change_lot"]) {
      expect((await ask(fixture(name).actions)).answer.hashes.truth, name).not.toBe(BASE.truth);
    }
    for (const name of ["set_capture_path", "set_flag_c", "set_flag_b"]) expect((await ask(fixture(name).actions)).answer.hashes.truth, name).toBe(BASE.truth);
  }, 120_000);

  it("Given the plant's answer for each action Then the scene plan shows it at the instant written in the fixture", async () => {
    const feed = (await ask(fixture("add_feed").actions)).answer.plan;
    expect(feed.marks).toContainEqual({ t: 291600, unit: 2, kind: "feed", source: "scripted", item: null });
    const alarm = (await ask(fixture("raise_alarm").actions)).answer.plan;
    expect(alarm.marks).toContainEqual({ t: 295200, unit: 4, kind: "alarm", source: "scripted", item: null });
    const moved = (await ask(fixture("move_draw").actions)).answer.plan;
    expect(moved.samples.find((s) => s.id === "U03-D03-1")).toMatchObject({ planned_s: 297000, drawn_s: 297205, arrived_s: 298349, operator: 1 });
    const down = (await ask(fixture("analyzer_down").actions)).answer.plan;
    expect(down.windows).toContainEqual({ analyzer: 0, kind: "maintenance", from_s: 306000, to_s: 313200 });
  }, 120_000);
});

describe("5.7 item 4: every permutation of three actions gives one scenario and one set of hashes", () => {
  it("Given the six orders of the three actions of three_together Then the hashes and the plan are one", async () => {
    const three = fixture("three_together").actions;
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((p) => p.map((i) => three[i] as Action));
    const answers = await Promise.all(orders.map((o) => ask(o)));
    expect(new Set(answers.map((a) => JSON.stringify(a.answer.hashes))).size).toBe(1);
    expect(new Set(answers.map((a) => JSON.stringify(a.answer.plan))).size).toBe(1);
    const hand = await byHand(fixture("three_together"));
    expect(answers[0]?.answer.hashes).toEqual({ truth: hand.truth, cells: hand.cells });
  }, 120_000);
});

describe("5.7 items 5 and 6: an undo returns the base hashes and the same list gives one hash", () => {
  it("Given each action undone Then the hashes are the base hashes; given three actions with one undone Then the hashes are those of the other two", async () => {
    for (const name of FIXTURES) {
      const acted = await ask(fixture(name).actions);
      const undone = await ask([], acted.kept);
      expect(undone.answer.hashes, name).toEqual(BASE);
    }
    const three = fixture("three_together").actions;
    const rest = three.filter((a) => a.kind !== "move_draw");
    const without = await ask(rest);
    const back = await ask(rest, (await ask(three)).kept);
    expect(back.answer.hashes).toEqual(without.answer.hashes);
    expect(without.answer.hashes.truth).not.toBe(BASE.truth);
  }, 300_000);

  it("Given the same list asked ten times Then the hash is one value", async () => {
    const list = fixture("three_together").actions;
    const hashes = new Set<string>();
    for (let i = 0; i < 10; i++) hashes.add(JSON.stringify((await ask(list)).answer.hashes));
    expect(hashes.size).toBe(1);
  }, 300_000);
});

describe("5.7 items 7 and 8: the past is not rewritten by a plant action, and a lab setting leaves the truth as it was", () => {
  it("Given a plant action after the base run Then the events before its instant are identical to the base run's, checked here directly and by the answer, and the view resumes at the instant", async () => {
    const base = await ask([]);
    for (const [name, at] of [["add_feed", 291600], ["raise_alarm", 295200], ["move_draw", 291600], ["analyzer_down", 291600], ["change_lot", 291600], ["three_together", 291600]] as const) {
      const acted = await ask(fixture(name).actions, base.kept);
      const before = (log: PlantKept["events"]) => log.filter((e) => e.t < at);
      expect(before(acted.kept.events).length, name).toBeGreaterThan(300);
      expect(before(acted.kept.events), name).toEqual(before(base.kept.events));
      expect(acted.answer.checks, name).toEqual({ prefix_equal: true, truth_equal: null });
      expect(acted.answer.resume_at, name).toBe(at);
    }
  }, 300_000);

  it("Given a previous answer from another seed Then the prefix check is false: the check can fail", async () => {
    const other = await runPlant(data, { ...(plantSpec([]) as unknown as PlantSpec), seed: 2 });
    if (!other.ok) throw new Error(other.message);
    const acted = await ask(fixture("add_feed").actions, other.kept);
    expect(acted.answer.checks.prefix_equal).toBe(false);
    const lab = await ask(fixture("set_flag_c").actions, other.kept);
    expect(lab.answer.checks.truth_equal).toBe(false);
  }, 120_000);

  it("Given a lab setting Then the truth hash equals the base hash, truth_equal is true, and only the cells of the hall that changed differ", async () => {
    const base = await ask([]);
    const flag = await ask(fixture("set_flag_c").actions, base.kept);
    expect(flag.answer.checks).toEqual({ prefix_equal: null, truth_equal: true });
    expect(flag.answer.hashes.truth).toBe(BASE.truth);
    expect(Object.keys(flag.answer.hashes.cells)).toEqual(["a_manual", "b_lims_lite", "c_context_minus_audit_trail"]);
    expect(flag.answer.hashes.cells.a_manual).toBe(BASE.cells.a_manual);
    expect(flag.answer.hashes.cells.b_lims_lite).toBe(BASE.cells.b_lims_lite);
    expect(flag.answer.hashes.cells.c_context_minus_audit_trail).not.toBe(BASE.cells.c_context);
    expect(flag.answer.plan.records.map((r) => r.architecture)).toEqual(["a_manual", "b_lims_lite", "c_context_minus_audit_trail"]);
    expect(flag.answer.resume_at).toBe(291600);
    const path = await ask(fixture("set_capture_path").actions, base.kept);
    expect(path.answer.checks.truth_equal).toBe(true);
    expect(path.answer.hashes.truth).toBe(BASE.truth);
  }, 120_000);

  it("Given the labelling method Then the strict hash changes because the label_bound events are the method's, and the logs without them are equal", async () => {
    const base = await ask([]);
    const labelled = await ask(fixture("set_labelling").actions, base.kept);
    expect(labelled.answer.hashes.truth).not.toBe(BASE.truth);
    expect(labelled.answer.checks).toEqual({ prefix_equal: null, truth_equal: true });
    const rest = (log: PlantKept["events"]) => log.filter((e) => e.type !== "label_bound");
    expect(rest(labelled.kept.events)).toEqual(rest(base.kept.events));
    // pre-printed barcodes are bound at the planned instant of the sample, handwritten ones at the draw: U03-D03-1 is planned at 305421 s and drawn at 305626 s
    expect(labelled.kept.events.filter((e) => e.type === "label_bound" && e.sample_id === "U03-D03-1")).toEqual([{ type: "label_bound", t: 305421, sample_id: "U03-D03-1", method: "preprinted_barcode" }]);
  }, 120_000);
});

describe("The request as the Worker receives it", () => {
  const run = (raw: unknown) => answerPlantRun(data, challenges, { spec: raw });

  it.each([
    ["a spec that is not an object", 7],
    ["an unknown key", { ...plantSpec([]), extra: 1 }],
    ["a run that fails the spec checks", { ...plantSpec([]), run: { schema_version: "1", scenario: "nope", settings: {}, architectures: HALLS, seeds: [1] } }],
    ["no record hall", { ...plantSpec([]), run: { ...plantSpec([]).run, architectures: [] } }],
    ["a seed that looks like a date", { ...plantSpec([]), seed: 20261101 }],
    ["an action with a field missing", plantSpec([{ kind: "add_feed", at: 60 }])],
  ])("Given %s Then it is invalid_spec", async (_name, raw) => {
    expect(await run(raw)).toMatchObject({ ok: false, code: "invalid_spec" });
  });

  it("Given an action the rules refuse Then the answer is refused with its reason and the index in the list", async () => {
    const out = await run(plantSpec([{ kind: "add_feed", at: 291600, unit_id: "U03" }, { kind: "add_feed", at: 291600, unit_id: "U99" }]));
    expect(out).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 1 });
    expect(await run(plantSpec([{ kind: "place_contamination", at: 60, origin: { kind: "seed_lot", item_id: "SL-1" }, contaminated_at: 120 }]))).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
  });

  it("Given a move to the next day Then the refusal is the plant's own, outside_window, made before the engine runs", async () => {
    const move = (to: number): Action => ({ kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to });
    expect(await run(plantSpec([move(383400)]))).toMatchObject({ ok: false, code: "refused", reason: "outside_window" });
  });

  it("Given a run that is an unrevealed challenge Then the plant is locked, with or without actions; a run with no open challenge is not", async () => {
    const own = createChallenges(data);
    const spec = plantSpec([]).run;
    const started = own.start({ variant: "sample", spec, seed: 1, shown: "a_manual" });
    expect(started.ok).toBe(true);
    expect(await answerPlantRun(data, own, { spec: plantSpec([]) })).toMatchObject({ ok: false, code: "locked" });
    expect(await answerPlantRun(data, own, { spec: plantSpec([fixture("add_feed").actions[0] as Action]) })).toMatchObject({ ok: false, code: "locked" });
    expect(await answerPlantRun(data, createChallenges(data), { spec: plantSpec([]) })).toMatchObject({ ok: true });
  }, 120_000);
});

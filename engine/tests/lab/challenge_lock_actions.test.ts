import { describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { answerLineage } from "../../src/experiments/assembly/lab/lineage_request.ts";
import { answerPlantRun, runPlant } from "../../src/experiments/assembly/lab/plant.ts";
import type { PlantSpec } from "../../src/experiments/assembly/lab/plant.ts";
import { answerPlantStart } from "../../src/experiments/assembly/lab/plant_stage.ts";
import { answerPlantTruth } from "../../src/experiments/assembly/lab/plant_truth.ts";
import { labData } from "../support/lab_data.ts";

// Audit R1, finding S-01 (2026-11-06): the lock of a challenge (lab_ui.md section 4, rule 2; plant_ui.md section 6, "the same run is the resolved run") compared the truth of the request's run with its
// operator actions stripped. A plant spec whose actions make the very run the challenge holds (SC5 is the default scenario plus one maintenance window on AN-1) was therefore not locked: the plant, its
// truth overlay and the lineage view answered from the truth of a challenge in progress. The lock now also asks the truth the actions make.
//
// Expected values are typed by hand from the data. Scenario SC5 (data/scenarios/sc05_one_analyzer_down.json) is the default scenario with one maintenance window on AN-1: it starts at 12030 min
// (day 8, 08:30; 8 x 1440 = 11520, 12030 - 11520 = 510 min = 8 h 30 min) = 12030 x 60 = 721800 s and lasts 4 h = 240 min (A205, A096). The action `analyzer_down` of the plant writes that same window
// into the default scenario, so the two runs are one run. The control writes the window on AN-2 instead: a different run, which must stay open.

const data = labData();
const SETTINGS = { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 10, production_days: 9 };
const sc05 = { schema_version: "1" as const, scenario: "sc05_one_analyzer_down", settings: SETTINGS, architectures: ["a_manual"], seeds: [41] };
const dflt = { ...sc05, scenario: "default" };
const SC5_WINDOW = { kind: "analyzer_down", at: 0, analyzer: "AN-1", from: 12030 * 60, length_min: 240 };
const OTHER_ANALYZER = { ...SC5_WINDOW, analyzer: "AN-2" };
const SAMPLE = "U01-D03-1";

const open = () => {
  const challenges = createChallenges(data);
  const started = challenges.start({ variant: "sample", spec: sc05, seed: 41, shown: "a_manual" });
  if (!started.ok) throw new Error(started.message);
  return challenges;
};
const plantSpec = (actions: unknown[]) => ({ run: dflt, seed: 41, actions });

describe("S-01: a plant spec whose actions make the truth of a challenge in progress is locked", () => {
  it("Given a challenge opened on SC5 When plant_run asks the default scenario with the SC5 window as an action Then it is locked", async () => {
    const out = await answerPlantRun(data, open(), { spec: plantSpec([SC5_WINDOW]) });
    expect(out).toMatchObject({ ok: false, code: "locked" });
  });

  it("Given a challenge opened on SC5 When the progressive plant_run asks the same spec Then it is locked as well", async () => {
    const out = await answerPlantStart(data, open(), { spec: plantSpec([SC5_WINDOW]) });
    expect(out).toMatchObject({ ok: false, code: "locked" });
  });

  it("Given a challenge opened on SC5 When lineage asks the default scenario with the SC5 window as an action Then it is locked", () => {
    const out = answerLineage(data, open(), { spec: dflt, seed: 41, pick: { sample_id: SAMPLE }, actions: [SC5_WINDOW] });
    expect(out).toMatchObject({ ok: false, code: "locked" });
  });

  it("Given a plan posted before the challenge was opened When the challenge is opened on SC5 Then the truth overlay of that plan is locked", async () => {
    const challenges = createChallenges(data);
    const plan = await runPlant(data, plantSpec([SC5_WINDOW]) as unknown as PlantSpec);
    if (!plan.ok) throw new Error("the plan was refused");
    expect(answerPlantTruth(plan.kept, challenges, { halls: true }).ok).toBe(true);
    const started = challenges.start({ variant: "sample", spec: sc05, seed: 41, shown: "a_manual" });
    expect(started.ok).toBe(true);
    expect(answerPlantTruth(plan.kept, challenges, { halls: true })).toMatchObject({ ok: false, code: "locked" });
    expect(answerPlantTruth(plan.kept, challenges, { sample_id: SAMPLE })).toMatchObject({ ok: false, code: "locked" });
  });
});

describe("S-01 control: a plant spec whose actions make another truth stays open (no over-locking)", () => {
  it("Given a challenge opened on SC5 When plant_run asks the default scenario with the window on AN-2 Then it is answered", async () => {
    const out = await answerPlantRun(data, open(), { spec: plantSpec([OTHER_ANALYZER]) });
    expect(out.ok).toBe(true);
  });

  it("Given a challenge opened on SC5 When lineage asks the default scenario with the window on AN-2 Then it is answered", () => {
    const out = answerLineage(data, open(), { spec: dflt, seed: 41, pick: { sample_id: SAMPLE }, actions: [OTHER_ANALYZER] });
    expect(out.ok).toBe(true);
  });

  it("Given a plan with the window on AN-2 When a challenge is opened on SC5 Then its truth overlay is still answered", async () => {
    const challenges = createChallenges(data);
    const plan = await runPlant(data, plantSpec([OTHER_ANALYZER]) as unknown as PlantSpec);
    if (!plan.ok) throw new Error("the plan was refused");
    expect(challenges.start({ variant: "sample", spec: sc05, seed: 41, shown: "a_manual" }).ok).toBe(true);
    expect(answerPlantTruth(plan.kept, challenges, { halls: true }).ok).toBe(true);
  });

  it("Given no challenge is open Then the SC5 window as an action is answered (the lock is of a challenge in progress only)", async () => {
    const out = await answerPlantRun(data, createChallenges(data), { spec: plantSpec([SC5_WINDOW]) });
    expect(out.ok).toBe(true);
  });
});

it("Given two challenges for the same truth When each is revealed Then access opens only after the last reveal", async () => {
  const challenges = createChallenges(data);
  const plan = await runPlant(data, plantSpec([SC5_WINDOW]) as unknown as PlantSpec);
  if (!plan.ok) throw new Error("the plan was refused");
  const first = challenges.start({ variant: "sample", spec: sc05, seed: 41, shown: "a_manual" });
  const second = challenges.start({ variant: "sample", spec: sc05, seed: 41, shown: "a_manual" });
  if (!first.ok || !second.ok) throw new Error("the challenge was refused");
  expect(answerPlantTruth(plan.kept, challenges, { halls: true })).toMatchObject({ ok: false, code: "locked" });
  expect(challenges.finish(first.challenge, null)).not.toHaveProperty("code");
  expect(answerPlantTruth(plan.kept, challenges, { halls: true })).toMatchObject({ ok: false, code: "locked" });
  expect(challenges.finish(second.challenge, null)).not.toHaveProperty("code");
  expect(answerPlantTruth(plan.kept, challenges, { halls: true }).ok).toBe(true);
  expect(answerLineage(data, challenges, { spec: dflt, seed: 41, pick: { sample_id: SAMPLE }, actions: [SC5_WINDOW] }).ok).toBe(true);
  expect((await answerPlantRun(data, challenges, { spec: plantSpec([SC5_WINDOW]) })).ok).toBe(true);
});

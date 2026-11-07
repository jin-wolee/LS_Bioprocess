import { describe, expect, it } from "vitest";
import type { PlantAction, PlantSpec, Response } from "../../../src/protocol.ts";
import { initial, reduce } from "../../../src/ui/state.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import { labData } from "../support/lab_data.ts";

// SC5 is the default scenario plus an AN-1 outage at 12030 minutes for 240 minutes.
const settings = { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 10, production_days: 9 };
const base = { schema_version: "1" as const, scenario: "default", settings, architectures: ["a_manual"], seeds: [41] };
const sc5 = { ...base, scenario: "sc05_one_analyzer_down" };
const outage: PlantAction = { kind: "analyzer_down", at: 0, analyzer: "AN-1", from: 12030 * 60, length_min: 240 };
const sample = "U01-D03-1";

const setup = async (actions: PlantAction[], challengeSpec: typeof base) => {
  const posted: Response[] = [];
  const worker = createWorker((message) => posted.push(structuredClone(message)), { data: labData(), now: () => performance.now(), fetchReference: async () => undefined });
  const spec: PlantSpec = { run: base, seed: 41, actions };
  let state = reduce(initial, { type: "plant_started", id: 1, epoch: 1, spec });
  await worker.onMessage({ type: "plant_run", id: 1, epoch: 1, spec });
  const ready = posted.find((m) => m.type === "plant_ready");
  if (!ready || ready.type !== "plant_ready") throw new Error(`plant not ready: ${JSON.stringify(posted)}`);
  state = reduce(state, ready);
  state = reduce(state, { type: "plant_truth_switched", on: true });
  state = reduce(state, { type: "plant_truth_started", id: 2, epoch: 1, pick: { halls: true } });
  state = reduce(state, { type: "plant_truth_started", id: 3, epoch: 1, pick: { sample_id: sample } });
  await worker.onMessage({ type: "plant_truth", id: 2, epoch: 1, pick: { halls: true } });
  await worker.onMessage({ type: "plant_truth", id: 3, epoch: 1, pick: { sample_id: sample } });
  const halls = posted.find((m) => m.type === "plant_truth_view" && m.id === 2);
  const sampleView = posted.find((m) => m.type === "plant_truth_view" && m.id === 3);
  if (!halls || halls.type !== "plant_truth_view" || !sampleView || sampleView.type !== "plant_truth_view") throw new Error(`truth missing: ${JSON.stringify(posted)}`);
  await worker.onMessage({ type: "challenge_start", id: 4, variant: "sample", spec: challengeSpec, seed: 41, shown: "a_manual" });
  const challenge = posted.find((m) => m.type === "challenge_ready");
  if (!challenge || challenge.type !== "challenge_ready") throw new Error(`challenge missing: ${JSON.stringify(posted)}`);
  return { worker, posted, ready, halls, sampleView, challenge, state };
};

describe("SC5: cached action-equivalent plant truth locks through Worker and UI", () => {
  it("Given halls and sample already received When SC5 opens Then both cached views clear and later requests are locked", async () => {
    const { worker, posted, ready, halls, sampleView, challenge, state } = await setup([outage], sc5);
    expect(ready.key).not.toBe(challenge.key);
    expect(ready.action_truth_key).toBe(challenge.key);
    const cached = reduce(reduce(state, halls), sampleView);
    expect(cached.plant.truth.halls?.view).toEqual(halls.view);
    expect(cached.plant.truth.sample?.view).toEqual(sampleView.view);
    const locked = reduce(cached, challenge);
    expect(locked.plant.truth.halls).toMatchObject({ view: null, problem: { code: "locked" }, closed: true });
    expect(locked.plant.truth.sample).toMatchObject({ view: null, problem: { code: "locked" }, closed: true });
    await worker.onMessage({ type: "plant_truth", id: 5, epoch: 1, pick: { halls: true } });
    await worker.onMessage({ type: "plant_truth", id: 6, epoch: 1, pick: { sample_id: sample } });
    expect(posted.filter((m) => m.type === "error" && (m.id === 5 || m.id === 6))).toEqual([
      expect.objectContaining({ id: 5, code: "locked" }), expect.objectContaining({ id: 6, code: "locked" }),
    ]);
  }, 60_000);

  it("Given both answers pending When SC5 opens before their delivery Then late halls and sample answers are discarded", async () => {
    const { halls, sampleView, challenge, state } = await setup([outage], sc5);
    const locked = reduce(state, challenge);
    expect(locked.plant.truth.halls).toMatchObject({ view: null, problem: { code: "locked" }, closed: true });
    expect(locked.plant.truth.sample).toMatchObject({ view: null, problem: { code: "locked" }, closed: true });
    const late = reduce(reduce(locked, halls), sampleView);
    expect(late.plant.truth).toEqual(locked.plant.truth);
  }, 60_000);

  it("Given an AN-2 action When SC5 opens Then unrelated cached and pending answers remain available", async () => {
    const other: PlantAction = { ...outage, analyzer: "AN-2" };
    const { worker, posted, ready, halls, sampleView, challenge, state } = await setup([other], sc5);
    expect(ready.action_truth_key).not.toBe(challenge.key);
    const cached = reduce(state, halls);
    const unlocked = reduce(cached, challenge);
    expect(unlocked.plant.truth.halls?.view).toEqual(halls.view);
    expect(reduce(unlocked, sampleView).plant.truth.sample?.view).toEqual(sampleView.view);
    await worker.onMessage({ type: "plant_truth", id: 5, epoch: 1, pick: { halls: true } });
    expect(posted.find((m) => m.type === "plant_truth_view" && m.id === 5)).toMatchObject({ type: "plant_truth_view", view: { kind: "halls" } });
  }, 60_000);

  it("Given an action changes the truth When a challenge opens on the original base run Then the base-key lock still clears both views", async () => {
    const { ready, halls, sampleView, challenge, state } = await setup([outage], base);
    expect(ready.key).toBe(challenge.key);
    const locked = reduce(reduce(reduce(state, halls), sampleView), challenge);
    expect(locked.plant.truth.halls).toMatchObject({ view: null, problem: { code: "locked" }, closed: true });
    expect(locked.plant.truth.sample).toMatchObject({ view: null, problem: { code: "locked" }, closed: true });
  }, 60_000);
});

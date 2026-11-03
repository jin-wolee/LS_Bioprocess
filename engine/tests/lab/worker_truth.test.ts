import { describe, expect, it } from "vitest";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";

// P5b (docs/design/plant_ui.md section 6, rules 2 and 8): `plant_truth` through the Worker, on the small default scenario (seed 1, 6 reactors, 8 days, A, B and C; 45 samples, U03-D03-1 among
// them). The epoch rules are those of `plant_record`: another epoch is `cancelled` with the epoch echoed; an unknown sample is `refused` as `unknown_target`; a malformed request is
// `invalid_spec`; and a challenge open on the same run answers `locked` at the moment of the request, also when it was opened after the plan was posted. No message that carries the plan or a hall
// holds a verdict, a materialised error, a hidden onset or a placeholder (rule 2).

const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const run = { schema_version: "1", scenario: "default", settings: SMALL, architectures: HALLS, seeds: [1] };
const spec = { run, seed: 1, actions: [] };

const data = labData();
const setup = () => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data, now: () => performance.now(), fetchReference: async () => undefined };
  const worker = createWorker((m) => posted.push(structuredClone(m)), env);
  const ask = async (message: unknown): Promise<Response[]> => {
    const n = posted.length;
    await worker.onMessage(message);
    return posted.slice(n);
  };
  return { posted, worker, ask, plant: (id: number, epoch: number) => worker.onMessage({ type: "plant_run", id, epoch, spec }) };
};
const keysDeep = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysDeep) : typeof v === "object" && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);
const valuesDeep = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(valuesDeep) : typeof v === "object" && v !== null ? Object.values(v).flatMap(valuesDeep) : [v]);

describe("plant_truth: the answer", () => {
  it("Given the plan and its halls Then a pick of the halls is answered with plant_truth_view, the id and the epoch of the request echoed, one entry for each hall in the order of the spec", async () => {
    const { ask, plant } = setup();
    await plant(1, 5);
    const [m, ...rest] = await ask({ type: "plant_truth", id: 2, epoch: 5, pick: { halls: true } });
    expect(rest).toEqual([]);
    if (m?.type !== "plant_truth_view") throw new Error(`plant_truth_view expected, got ${JSON.stringify(m)?.slice(0, 200)}`);
    expect(Object.keys(m).sort()).toEqual(["epoch", "id", "type", "view"]);
    expect([m.id, m.epoch, m.view.kind]).toEqual([2, 5, "halls"]);
    if (m.view.kind === "halls") expect(m.view.halls.map((h) => h.architecture)).toEqual(HALLS);
  }, 120_000);

  it("Given a sample of the run Then a pick of the sample is answered with the truth column and one column for each hall", async () => {
    const { ask, plant } = setup();
    await plant(1, 5);
    const [m] = await ask({ type: "plant_truth", id: 3, epoch: 5, pick: { sample_id: "U03-D03-1" } });
    if (m?.type !== "plant_truth_view" || m.view.kind !== "sample") throw new Error(`a sample view expected, got ${JSON.stringify(m)?.slice(0, 200)}`);
    expect(m.view.sample).toEqual({ sample_id: "U03-D03-1", unit_id: "U03", picked_by: "reader" });
    expect(m.view.columns.map((c) => c.architecture)).toEqual(HALLS);
    expect(m.view.columns.every((c) => c.answers.length === 3)).toBe(true);
  }, 120_000);
});

describe("plant_truth: the epoch, the checks and the lock", () => {
  it("Given an epoch the Worker does not hold, or no plant run at all Then the request is cancelled with that epoch and the Worker goes on", async () => {
    const { ask, plant } = setup();
    expect(await ask({ type: "plant_truth", id: 9, epoch: 1, pick: { halls: true } })).toMatchObject([{ type: "error", id: 9, epoch: 1, code: "cancelled" }]);
    await plant(1, 5);
    expect(await ask({ type: "plant_truth", id: 10, epoch: 4, pick: { halls: true } })).toMatchObject([{ type: "error", id: 10, epoch: 4, code: "cancelled" }]);
    expect(await ask({ type: "plant_truth", id: 11, epoch: 5, pick: { halls: true } })).toMatchObject([{ type: "plant_truth_view", id: 11, epoch: 5 }]);
  }, 120_000);

  it("Given a sample the run did not draw Then it is refused as unknown_target with its epoch and no index", async () => {
    const { ask, plant } = setup();
    await plant(1, 5);
    const [m] = await ask({ type: "plant_truth", id: 12, epoch: 5, pick: { sample_id: "U99-D99-9" } });
    expect(m).toMatchObject({ type: "error", id: 12, epoch: 5, code: "refused", reason: "unknown_target" });
    expect(m).not.toHaveProperty("index");
  }, 120_000);

  it.each([
    ["no id", { id: undefined }, null, undefined],
    ["no whole epoch", { epoch: 1.5 }, 20, undefined],
    ["no pick", { pick: undefined }, 20, 5],
    ["a pick of no kind", { pick: {} }, 20, 5],
    ["a pick of a unit (not offered yet)", { pick: { unit_id: "U01" } }, 20, 5],
    ["a pick of the break-out that is not true (P7b offers the pick of a case)", { pick: { breakout: false } }, 20, 5],
  ])("Given a request with %s Then invalid_spec", async (_, extra, id, epoch) => {
    const { ask, plant } = setup();
    await plant(1, 5);
    const out = await ask({ type: "plant_truth", id: 20, epoch: 5, pick: { halls: true }, ...extra });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", id, code: "invalid_spec" });
    if (epoch !== undefined) expect(out[0]).toMatchObject({ epoch });
  }, 120_000);

  it("Given a challenge opened on the same run after the plan was posted Then the truth request is locked with its epoch, the plan on screen stays, and the overlay opens again once the challenge is revealed", async () => {
    const { ask, plant } = setup();
    await plant(1, 5);
    expect(await ask({ type: "plant_truth", id: 30, epoch: 5, pick: { halls: true } })).toMatchObject([{ type: "plant_truth_view" }]);
    const [started] = await ask({ type: "challenge_start", id: 31, variant: "sample", spec: { ...run, architectures: [], seeds: [1] }, seed: 1, shown: "a_manual" });
    if (started?.type !== "challenge_ready") throw new Error(`challenge_ready expected, got ${JSON.stringify(started)?.slice(0, 200)}`);
    for (const pick of [{ halls: true }, { sample_id: "U03-D03-1" }]) {
      expect(await ask({ type: "plant_truth", id: 32, epoch: 5, pick })).toMatchObject([{ type: "error", id: 32, epoch: 5, code: "locked" }]);
    }
    await ask({ type: "challenge_giveup", id: 33, challenge: started.challenge });
    expect(await ask({ type: "plant_truth", id: 34, epoch: 5, pick: { halls: true } })).toMatchObject([{ type: "plant_truth_view", id: 34 }]);
  }, 240_000);

  it("Given a challenge on another seed Then the truth request of this plan is answered", async () => {
    const { ask, plant } = setup();
    await plant(1, 5);
    await ask({ type: "challenge_start", id: 31, variant: "sample", spec: { ...run, architectures: [], seeds: [43] }, seed: 43, shown: "a_manual" });
    expect(await ask({ type: "plant_truth", id: 32, epoch: 5, pick: { halls: true } })).toMatchObject([{ type: "plant_truth_view" }]);
  }, 240_000);
});

describe("plant_truth: rule 2, the plan and the halls carry no truth", () => {
  it("Given every message of a plant run, its halls and a record request Then none holds a key or a value of the overlay (a verdict, an answer, a materialised error, a hidden onset or origin, a placeholder), and no plant_truth_view arrives before one is asked for", async () => {
    const { posted, ask, plant } = setup();
    await plant(1, 5);
    await ask({ type: "plant_record", id: 2, epoch: 5, architecture: "c_context", sample_id: "U03-D03-1" });
    expect(posted.some((m) => m.type === "plant_truth_view")).toBe(false);
    const forbiddenKeys = new Set(["verdict", "answers", "answer", "realised_errors", "placeholders", "why", "materialised", "onset", "origin", "kind_of_error"]);
    const forbiddenValues = new Set(["unanswerable", "wrong", "correct", "not_recorded", "label_error", "lost_rerun", "duplicate_replay", "unit_rekey"]);
    const messages = posted.filter((m) => m.type === "plant_ready" || m.type === "plant_halls" || m.type === "plant_record_view");
    expect(messages.map((m) => m.type)).toEqual(["plant_ready", "plant_halls", "plant_halls", "plant_record_view"]);
    for (const m of messages) {
      expect(keysDeep(m).filter((k) => forbiddenKeys.has(k)), m.type).toEqual([]);
      expect(valuesDeep(m).filter((v) => typeof v === "string" && forbiddenValues.has(v)), m.type).toEqual([]);
    }
  }, 120_000);
});

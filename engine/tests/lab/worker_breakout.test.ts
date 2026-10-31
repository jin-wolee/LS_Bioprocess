import { describe, expect, it } from "vitest";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { labData } from "../support/lab_data.ts";
import { breakoutData } from "./breakout_data.ts";

// S3g, the `breakout` request of the Worker protocol (docs/design/lab_ui.md sections 4 and 20). The Worker is driven through createWorker with a recording `post`, as worker.test.ts does.

const setup = (data = breakoutData()) => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data, now: () => performance.now(), fetchReference: async () => undefined };
  const worker = createWorker((r) => posted.push(structuredClone(r)), env);
  const send = async (message: unknown): Promise<Response> => {
    const before = posted.length;
    await worker.onMessage(message);
    return posted.slice(before).at(-1) as Response;
  };
  return { posted, send, worker };
};
const ASK = { type: "breakout", id: 11, case: "sc12_medium_lot", architectures: ["a_manual", "c_context"], seed: 9013 };
const codeOf = (r: Response): string => (r.type === "error" ? r.code : r.type);

describe("ready", () => {
  it("Given a build with break-out data Then ready lists the five cases, the seed list and the flags direction 3 needs", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const ready = posted[0];
    if (ready?.type !== "ready") throw new Error("ready first");
    expect(ready.breakout?.cases.map((c) => c.id)).toEqual(["sc12_medium_lot", "sc12_seed_lot", "sc12_sampling", "sc12_equipment", "sc12_mycoplasma"]);
    expect(ready.breakout?.seed_list.slice(0, 2)).toEqual([9013, 9127]);
    expect(ready.breakout?.needs).toEqual({ lots: "material_lot_links", equipment: "equipment_links" });
    expect(ready.scenarios.map((s) => s.id)).not.toContain("sc12_medium_lot"); // reachable from the Break-out screen only
  });

  it("Given a build with none (the public build while a source is below main-reread) Then ready says null", async () => {
    const { posted, worker } = setup(labData());
    await worker.start();
    expect(posted[0]).toMatchObject({ type: "ready", breakout: null });
  });
});

describe("breakout", () => {
  it("Given a case, a seed and architectures Then the Worker answers breakout_result under the id of the request", async () => {
    const { send } = setup();
    const answer = await send(ASK);
    if (answer.type !== "breakout_result") throw new Error(`expected breakout_result, got ${JSON.stringify(answer)}`);
    expect(answer.id).toBe(11);
    expect(answer.result).toMatchObject({ kind: "simulation_result", case: "sc12_medium_lot", seed: 9013, architectures: ["a_manual", "c_context"] });
    expect(answer.result.per_architecture.map((a) => a.reach.direction3)).toEqual([false, true]);
  }, 60_000);

  it.each([
    ["an unknown case", { case: "sc12_nope" }],
    ["no architecture", { architectures: [] }],
    ["an unknown architecture", { architectures: ["nope"] }],
    ["a date-shaped seed", { seed: 20260101 }],
  ])("Given %s Then invalid_spec under the id of the request", async (_, extra) => {
    const { send } = setup();
    const answer = await send({ ...ASK, ...extra });
    expect(answer).toMatchObject({ type: "error", id: 11, code: "invalid_spec" });
  });

  it("Given a request with no numeric id Then invalid_spec with no id", async () => {
    const { send } = setup();
    expect(await send({ ...ASK, id: "x" })).toMatchObject({ type: "error", id: null, code: "invalid_spec" });
  });

  it("Given a build with no break-out data Then a request is refused as invalid_spec and nothing is run", async () => {
    const { send } = setup(labData());
    const answer = await send(ASK);
    expect(codeOf(answer)).toBe("invalid_spec");
    expect(answer).toMatchObject({ message: expect.stringMatching(/does not offer the Break-out screen/) });
  });

  it("Given a scenario that fails the engine's own validation Then the Worker reports engine_error with the engine's message", async () => {
    const data = breakoutData();
    const broken = structuredClone(data.breakout?.scenarios.sc12_medium_lot) as { breakout: { confirm: string[] } };
    broken.breakout.confirm = ["U99"];
    const { send } = setup({ ...data, breakout: { ...(data.breakout as NonNullable<typeof data.breakout>), scenarios: { sc12_medium_lot: broken } } });
    const answer = await send(ASK);
    expect(answer).toMatchObject({ type: "error", id: 11, code: "engine_error" });
  }, 60_000);
});

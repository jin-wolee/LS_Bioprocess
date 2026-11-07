import { describe, expect, it } from "vitest";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { SMALL } from "../support/scenarios.ts";
import { breakoutData } from "./breakout_data.ts";

// P5c (docs/design/plant_ui.md section 6, rule 9): `lineage` and `breakout` through the Worker with the `actions` of the plant they were opened from. A refusal of an action arrives as an `error` with code
// `refused`, its reason and its index and no epoch (these are not plant requests); an empty list answers as no list; a challenge takes no actions. The small default scenario (6 reactors, 8 days, seed 1).

const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const run = { schema_version: "1", scenario: "default", settings: SMALL, architectures: HALLS, seeds: [1] };
const FEED = { kind: "add_feed", at: 291600, unit_id: "U03" };
const lineage = (id: number, extra: Record<string, unknown> = {}) => ({ type: "lineage", id, spec: run, seed: 1, pick: { sample_id: "U03-D03-1" }, ...extra });

const setup = () => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data: breakoutData(), now: () => performance.now(), fetchReference: async () => undefined };
  const worker = createWorker((m) => posted.push(structuredClone(m)), env);
  const send = async (message: unknown): Promise<Response> => {
    const before = posted.length;
    await worker.onMessage(message);
    return posted.slice(before).at(-1) as Response;
  };
  return { send };
};

describe("lineage with actions", () => {
  it("Given a feed Then the view is the lineage view of the run with the feed (one feed more in the true context of the sample drawn after it)", async () => {
    const { send } = setup();
    const without = await send(lineage(1));
    const feed = await send(lineage(2, { actions: [FEED] }));
    if (without.type !== "lineage" || feed.type !== "lineage") throw new Error(`lineage expected, got ${JSON.stringify([without, feed]).slice(0, 300)}`);
    expect(without.view.truth.context.feed_epoch).toBe(0);
    expect(feed.view.truth.context.feed_epoch).toBe(1);
    expect(feed.id).toBe(2);
  }, 120_000);

  it("Given an empty list Then the answer is the answer without the field", async () => {
    const { send } = setup();
    const a = await send(lineage(3));
    const b = await send(lineage(3, { actions: [] }));
    expect(b).toEqual(a);
  }, 120_000);

  it("Given an action a rule refuses Then the error is `refused` with its reason and its index and no epoch; a malformed list is invalid_spec", async () => {
    const { send } = setup();
    const refused = await send(lineage(4, { actions: [FEED, { kind: "add_feed", at: 291600, unit_id: "U99" }] }));
    expect(refused).toMatchObject({ type: "error", id: 4, code: "refused", reason: "unknown_target", index: 1 });
    expect(refused).not.toHaveProperty("epoch");
    expect(await send(lineage(5, { actions: "feed" }))).toMatchObject({ type: "error", id: 5, code: "invalid_spec" });
  }, 120_000);
});

describe("breakout with actions", () => {
  const ask = (id: number, extra: Record<string, unknown>) => ({ type: "breakout", id, case: "sc12_medium_lot", architectures: ["a_manual", "c_context"], seed: 9013, ...extra });
  const DOWN = { kind: "analyzer_down", at: 464400, analyzer: "AN-1", from: 478800, length_min: 120 };

  it("Given a window of AN-1 Then the answer is a break-out result; given an analyzer the case lacks Then it is refused with its reason and index", async () => {
    const { send } = setup();
    expect(await send(ask(6, { actions: [DOWN] }))).toMatchObject({ type: "breakout_result", id: 6 });
    expect(await send(ask(7, { actions: [DOWN, { ...DOWN, analyzer: "AN-9", from: 484800 }] }))).toMatchObject({ type: "error", id: 7, code: "refused", reason: "unknown_target", index: 1 });
  }, 180_000);

  it("Given a capture path Then it is refused, with its index", async () => {
    const { send } = setup();
    expect(await send(ask(8, { actions: [{ kind: "set_capture_path", at: 464400, path: "adapter_ingest" }] }))).toMatchObject({ type: "error", id: 8, code: "refused", reason: "unknown_target", index: 0 });
  }, 60_000);
});

describe("challenge_start takes no actions", () => {
  it("Given a list of actions Then the start is invalid_spec and no challenge is opened; without the list it starts", async () => {
    const { send } = setup();
    const spec = { schema_version: "1", scenario: "default", settings: SMALL, architectures: [], seeds: [41] };
    const start = (id: number, extra: Record<string, unknown> = {}) => ({ type: "challenge_start", id, variant: "sample", spec, seed: 41, shown: "a_manual", ...extra });
    expect(await send(start(9, { actions: [FEED] }))).toMatchObject({ type: "error", id: 9, code: "invalid_spec" });
    expect((await send(start(10))).type).toBe("challenge_ready");
  }, 120_000);
});

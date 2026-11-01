import { describe, expect, it } from "vitest";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";

// P3 (docs/design/plant_ui.md section 6, rules 3 and 4): the `plant_run` request of the Worker protocol. The Worker answers `plant_ready` through `answerPlantRun` and keeps what the next
// answer is compared with (`PlantKept`); a newer `plant_run` cancels an older unfinished one (the epoch); a refusal is an `error` with code `refused`, its reason and the index of the action;
// `invalid_spec`, `locked` and `engine_error` as for the other requests. The runs use the small size of the default scenario (6 reactors in one bay, 8 days), seed 1, halls A, B and C.
// Expected values are typed by hand: U01 is inoculated at 28800 s (08:00 of day 0) and harvested at 547200 s; a feed at 302400 s is day 3 at 12:00.

const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const run = { schema_version: "1", scenario: "default", settings: SMALL, architectures: HALLS, seeds: [1] };
const spec = (actions: unknown[] = [], seed = 1) => ({ run, seed, actions });
const FEED = { kind: "add_feed", at: 302400, unit_id: "U01" };

const data = labData();
const setup = () => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data, now: () => performance.now(), fetchReference: async () => undefined };
  const worker = createWorker((r) => posted.push(structuredClone(r)), env);
  const plant = (id: number, epoch: number, s: unknown = spec()) => worker.onMessage({ type: "plant_run", id, epoch, spec: s });
  return { posted, worker, plant };
};
const plantMessages = (posted: Response[]) => posted.filter((m) => m.type === "plant_ready" || m.type === "error");
const ready = (m: Response | undefined) => {
  if (m?.type !== "plant_ready") throw new Error(`plant_ready expected, got ${JSON.stringify(m)?.slice(0, 200)}`);
  return m;
};

describe("plant_run: the answer", () => {
  it("Given a plant spec Then the answer is one plant_ready with the epoch, the plan of the run, the hashes and no checks to make (the first answer)", async () => {
    const { posted, plant } = setup();
    await plant(51, 1);
    const m = ready(plantMessages(posted)[0]);
    expect(posted.filter((p) => p.type === "plant_ready")).toHaveLength(1);
    expect(Object.keys(m).sort()).toEqual(["checks", "epoch", "hashes", "id", "plan", "resume_at", "type"]);
    expect([m.id, m.epoch, m.resume_at, m.checks]).toEqual([51, 1, 0, { prefix_equal: null, truth_equal: null }]);
    expect(m.plan.units).toHaveLength(6);
    expect(m.plan.units[2]).toEqual({ id: "U03", bay: 1, slot: 2, profile: "bench_manual", batch: "B-U03", start_s: 30600, end_s: 549000 });
    expect(m.plan.analyzers.map((a) => a.id)).toEqual(["AN-1", "AN-2"]);
    expect(m.plan.layout.architectures).toEqual(HALLS);
    expect(m.hashes.truth).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(m.hashes.cells)).toEqual(HALLS);
  }, 60_000);

  it("Given the answer Then it is plain data: it survives structuredClone and holds no key of a hidden field", async () => {
    const { posted, plant } = setup();
    await plant(52, 1);
    const m = ready(plantMessages(posted)[0]);
    expect(structuredClone(m)).toEqual(m);
    const keys = new Set(JSON.stringify(m).match(/"[a-z_]+":/g));
    for (const hidden of ['"true_value":', '"noise":', '"true_state":', '"onset":', '"verdict":']) expect(keys.has(hidden), hidden).toBe(false);
  }, 60_000);

  it("Given a second request that adds a feed Then the Worker kept the first answer: the instant of the feed is where the view resumes and the events before it are equal", async () => {
    const { posted, plant } = setup();
    await plant(53, 1);
    await plant(54, 2, spec([FEED]));
    const second = ready(plantMessages(posted)[1]);
    expect([second.epoch, second.resume_at, second.checks]).toEqual([2, 302400, { prefix_equal: true, truth_equal: null }]);
    expect(second.plan.marks.some((x) => x.unit === 0 && x.kind === "feed" && x.t === 302400 && x.source === "scripted")).toBe(true);
    await plant(55, 3, spec([]));
    const third = ready(plantMessages(posted)[2]);
    expect([third.resume_at, third.checks]).toEqual([302400, { prefix_equal: true, truth_equal: null }]);
    expect(third.hashes.truth).toBe(ready(plantMessages(posted)[0]).hashes.truth); // the undo returns to the base hash
  }, 120_000);
});

describe("plant_run: epochs", () => {
  it("Given two requests sent one after the other Then the older is cancelled before it runs and only the newer is answered with a plant", async () => {
    const { posted, plant } = setup();
    await Promise.all([plant(61, 1), plant(62, 2)]);
    expect(plantMessages(posted).map((m) => (m.type === "error" ? `error:${m.id}:${m.code}:${m.epoch}` : `ready:${m.id}:${m.epoch}`))).toEqual(["error:61:cancelled:1", "ready:62:2"]);
  }, 60_000);

  it("Given a newer request that arrives while the older one is being built Then the older answer is dropped in the Worker and is not kept for the checks of the next", async () => {
    const { posted, plant } = setup();
    const first = plant(63, 1, spec([FEED]));
    await Promise.resolve(); // the first request has begun (it waits for the event loop once before it builds)
    const second = new Promise<void>((resolve) => setTimeout(() => void Promise.resolve(plant(64, 2)).then(resolve), 0));
    await Promise.all([first, second]);
    expect(plantMessages(posted).map((m) => (m.type === "error" ? `error:${m.id}:${m.code}` : `ready:${m.id}`))).toEqual(["error:63:cancelled", "ready:64"]);
    // the cancelled answer was never kept: the second request is the first answer the Worker kept, so there is nothing to compare it with
    const m = ready(plantMessages(posted)[1]);
    expect([m.resume_at, m.checks]).toEqual([0, { prefix_equal: null, truth_equal: null }]);
  }, 60_000);

  it("Given an epoch that is not larger than the last one Then the request is invalid_spec and the answer of the last epoch stands", async () => {
    const { posted, plant } = setup();
    await plant(65, 5);
    await plant(66, 5);
    await plant(67, 3);
    expect(plantMessages(posted).map((m) => (m.type === "error" ? `error:${m.id}:${m.code}` : `ready:${m.id}`))).toEqual(["ready:65", "error:66:invalid_spec", "error:67:invalid_spec"]);
  }, 60_000);
});

describe("plant_run: what is refused and what is invalid", () => {
  const errorOf = (posted: Response[]) => {
    const e = posted.filter((m) => m.type === "error").pop();
    if (e?.type !== "error") throw new Error("an error was expected");
    return e;
  };

  it("Given an action on a unit the run does not have Then it is refused with the reason, the index of the action and the epoch", async () => {
    const { posted, plant } = setup();
    await plant(71, 1, spec([FEED, { kind: "add_feed", at: 302400, unit_id: "U99" }]));
    expect(errorOf(posted)).toMatchObject({ type: "error", id: 71, epoch: 1, code: "refused", reason: "unknown_target", index: 1 });
    expect(plantMessages(posted).some((m) => m.type === "plant_ready")).toBe(false);
  }, 60_000);

  it("Given a feed before the inoculation of its unit Then it is refused as outside_window, and the Worker goes on answering", async () => {
    const { posted, plant } = setup();
    await plant(72, 1, spec([{ kind: "add_feed", at: 600, unit_id: "U01" }]));
    expect(errorOf(posted)).toMatchObject({ code: "refused", reason: "outside_window", index: 0, epoch: 1 });
    await plant(73, 2);
    expect(ready(plantMessages(posted).pop())).toMatchObject({ id: 73, epoch: 2 });
  }, 60_000);

  it("Given a kind that closes the loop Then it is refused as closed_loop", async () => {
    const { posted, plant } = setup();
    await plant(74, 1, spec([{ kind: "hold", at: 302400, unit_id: "U01" }]));
    expect(errorOf(posted)).toMatchObject({ code: "refused", reason: "closed_loop", index: 0 });
  }, 60_000);

  it("Given a malformed spec, an unknown key, an unknown scenario, no halls or a seed that is date-shaped Then invalid_spec with the epoch", async () => {
    const { posted, plant } = setup();
    const cases: unknown[] = [null, { ...spec(), extra: 1 }, { ...spec(), run: { ...run, scenario: "nope" } }, { ...spec(), run: { ...run, architectures: [] } }, spec([], 20260101), { run, seed: 1, actions: "feed" }];
    for (const [i, s] of cases.entries()) {
      await plant(80 + i, i + 1, s);
      expect(errorOf(posted), JSON.stringify(s)?.slice(0, 80)).toMatchObject({ id: 80 + i, epoch: i + 1, code: "invalid_spec" });
    }
    expect(posted.filter((m) => m.type === "plant_ready")).toHaveLength(0);
  }, 60_000);

  it("Given a request with no numeric id or no whole epoch Then invalid_spec and nothing runs", async () => {
    const { posted, worker } = setup();
    await worker.onMessage({ type: "plant_run", epoch: 1, spec: spec() });
    expect(errorOf(posted)).toMatchObject({ id: null, code: "invalid_spec" });
    for (const epoch of [undefined, -1, 1.5, "1"]) {
      await worker.onMessage({ type: "plant_run", id: 90, epoch, spec: spec() });
      expect(errorOf(posted)).toMatchObject({ id: 90, code: "invalid_spec" });
    }
    expect(plantMessages(posted).filter((m) => m.type === "plant_ready")).toHaveLength(0);
  });

  it("Given a run that is an unrevealed challenge Then the plant of it is locked (with the epoch), and after the give-up the same run answers", async () => {
    const { posted, worker, plant } = setup();
    const challenge = { schema_version: "1", scenario: "default", settings: SMALL, architectures: [], seeds: [41] };
    await worker.onMessage({ type: "challenge_start", id: 95, variant: "sample", spec: challenge, seed: 41, shown: "a_manual" });
    const started = posted.find((m) => m.type === "challenge_ready");
    if (started?.type !== "challenge_ready") throw new Error("a challenge was expected to start");
    await plant(96, 1, spec([], 41));
    expect(errorOf(posted)).toMatchObject({ id: 96, epoch: 1, code: "locked" });
    await plant(97, 2, spec([], 42)); // another seed is another run
    expect(plantMessages(posted).pop()).toMatchObject({ type: "plant_ready", id: 97 });
    await worker.onMessage({ type: "challenge_giveup", id: 98, challenge: started.challenge });
    await plant(99, 3, spec([], 41));
    expect(plantMessages(posted).pop()).toMatchObject({ type: "plant_ready", id: 99 });
  }, 120_000);

  it("Given a bay list of the wrong length Then the engine's own message arrives verbatim as engine_error, and the Worker keeps answering", async () => {
    const { posted, plant } = setup();
    const bad = { ...spec(), run: { ...run, settings: { ...SMALL, bay_size: 3 }, bay_profiles: ["bench_manual"] } };
    await plant(100, 1, bad);
    expect(errorOf(posted)).toEqual({
      type: "error",
      id: 100,
      epoch: 1,
      code: "engine_error",
      message: "scenario default: bay_profiles names 1 bioreactor profile but the scenario has 2 bays (reactor_count 6 in bays of 3); name one bioreactor profile per bay, bay 1 first (spec section 4.5)",
    });
    await plant(101, 2);
    expect(ready(plantMessages(posted).pop())).toMatchObject({ id: 101, epoch: 2 });
  }, 120_000);
});

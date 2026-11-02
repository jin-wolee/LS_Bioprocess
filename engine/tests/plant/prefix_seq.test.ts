import { describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { answerPlantRun } from "../../src/experiments/assembly/lab/plant.ts";
import type { PlantKept } from "../../src/experiments/assembly/lab/plant.ts";
import type { Action } from "../../src/experiments/assembly/lab/actions.ts";
import { labData } from "../support/lab_data.ts";

// P6a (docs/design/plant_ui.md section 5.5, "As built in P6a"; found by the check `plant_prefix` of the browser QA on the default scenario): an analyzer window added later moves the `seq` of a request
// that is queued again before it. The analyzer's queue takes its event numbers from one counter that starts above the numbers of the requests, and the start and the end of every window take two of them
// when the queue is set up, before the run, so one more window moves the number of every rerun by two. `seq` is the tie-break ordinal of the queue and not a thing that happened: no time, type or id
// before the action's instant changes. The small default scenario of proof.test.ts has no rerun before day 3, which is why the P2 proof did not see it. The expected shift is typed by hand: two
// numbers for one window.

const data = labData();
const challenges = createChallenges(data);
const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const AT = 8 * 86400 + 9 * 3600; // day 8 at 09:00 of the default scenario
const WINDOW: Action = { kind: "analyzer_down", at: AT, analyzer: "AN-1", from: AT + 5 * 3600, length_min: 60 };

const ask = async (actions: Action[], previous?: PlantKept) => {
  const out = await answerPlantRun(data, challenges, { spec: { run: { schema_version: "1", scenario: "default", settings: {}, architectures: HALLS, seeds: [1] }, seed: 1, actions } }, previous);
  if (!out.ok) throw new Error(out.message);
  return out;
};

describe("a window added later and the events before the action's instant", () => {
  it("Given the default scenario and a window that starts five hours after the action Then the answer says prefix_equal true", async () => {
    const base = await ask([]);
    const acted = await ask([WINDOW], base.kept);
    expect(acted.answer.checks).toEqual({ prefix_equal: true, truth_equal: null });
    expect(acted.answer.resume_at).toBe(AT);
  }, 120_000);

  it("Given the same two runs Then the only difference before the instant is the seq of the requests that were queued again, by two for the one window", async () => {
    const base = await ask([]);
    const acted = await ask([WINDOW], base.kept);
    const before = (log: PlantKept["events"]) => log.filter((e) => e.t < AT);
    const [a, b] = [before(base.kept.events), before(acted.kept.events)];
    expect(b.length).toBe(a.length);
    const differing = a.flatMap((e, i) => (JSON.stringify(e) === JSON.stringify(b[i]) ? [] : [[e, b[i]] as const]));
    expect(differing.length).toBeGreaterThan(0); // the day-6 rerun of the default run: there are some, or this test says nothing
    for (const [x, y] of differing) {
      expect(x.type).toBe("request_queued");
      const [p, q] = [x as { attempt: number; seq: number }, y as { attempt: number; seq: number }];
      expect(p.attempt).toBeGreaterThan(1);
      expect(q.seq - p.seq).toBe(2);
      expect({ ...x, seq: 0 }).toEqual({ ...y, seq: 0 });
    }
  }, 120_000);

  it("Given an action that changes a time before its instant Then the check still fails: a different seed is a different past", async () => {
    const other = await answerPlantRun(data, challenges, { spec: { run: { schema_version: "1", scenario: "default", settings: {}, architectures: HALLS, seeds: [2] }, seed: 2, actions: [] } });
    if (!other.ok) throw new Error(other.message);
    expect((await ask([WINDOW], other.kept)).answer.checks.prefix_equal).toBe(false);
  }, 120_000);

  // the check must still see a request_queued that really changed before the instant: the first run is the previous answer, with one event of it changed, and the window is asked for under it
  const tamper = async (change: (e: { t: number; seq: number; request_id: string }) => object) => {
    const base = await ask([]);
    const at = base.kept.events.findIndex((e) => e.type === "request_queued" && e.t < AT - 3600 && e.t > AT - 86400);
    expect(at, "a request_queued of the day before the action").toBeGreaterThan(-1);
    const events = base.kept.events.map((e, i) => (i === at ? ({ ...e, ...change(e as never) } as typeof e) : e));
    return (await ask([WINDOW], { ...base.kept, events })).answer.checks.prefix_equal;
  };

  it("Given one request_queued before the instant with its time, or its request, changed in the previous answer Then prefix_equal is false: a request_queued is still compared", async () => {
    expect(await tamper((e) => ({ t: e.t + 1 }))).toBe(false);
    expect(await tamper((e) => ({ request_id: `${e.request_id}-x` }))).toBe(false);
  }, 240_000);

  it("Given one request_queued before the instant with only its seq changed in the previous answer Then prefix_equal is true: the queue's number is not a thing that happened", async () => {
    expect(await tamper((e) => ({ seq: e.seq + 7 }))).toBe(true);
  }, 120_000);
});

import { describe, expect, it } from "vitest";
import { PRIORITY, createEventQueue, roundDuration } from "../../src/clock.ts";

const drain = <T>(q: ReturnType<typeof createEventQueue<T>>): T[] => {
  const out: T[] = [];
  for (let e = q.pop(); e; e = q.pop()) out.push(e.payload);
  return out;
};

describe("Contract: time and event order", () => {
  it("the priority table is 0 capacity restored, 1 visit finished, 2 request queued, 3 capacity removed, 4 dispatch", () => {
    expect(PRIORITY).toEqual({ capacityRestored: 0, visitFinished: 1, requestQueued: 2, capacityRemoved: 3, dispatch: 4 });
  });

  it("at equal t events pop in ascending priority, whatever the order they were scheduled in", () => {
    const q = createEventQueue<string>();
    q.push(100, PRIORITY.dispatch, 1, "dispatch");
    q.push(100, PRIORITY.capacityRemoved, 2, "removed");
    q.push(100, PRIORITY.requestQueued, 3, "queued");
    q.push(100, PRIORITY.visitFinished, 4, "finished");
    q.push(100, PRIORITY.capacityRestored, 5, "restored");
    expect(drain(q)).toEqual(["restored", "finished", "queued", "removed", "dispatch"]);
  });

  it("inside one priority the ascending seq breaks the tie", () => {
    const q = createEventQueue<string>();
    q.push(50, PRIORITY.requestQueued, 9, "nine");
    q.push(50, PRIORITY.requestQueued, 2, "two");
    q.push(50, PRIORITY.requestQueued, 5, "five");
    expect(drain(q)).toEqual(["two", "five", "nine"]);
  });

  it("time dominates priority and seq", () => {
    const q = createEventQueue<string>();
    q.push(60, PRIORITY.capacityRestored, 1, "late");
    q.push(59, PRIORITY.dispatch, 99, "early");
    expect(drain(q)).toEqual(["early", "late"]);
  });

  it("sampled continuous durations round with floor(x + 0.5), minimum one second", () => {
    expect([0, 0.2, 0.5, 1.49, 1.5, 2.5, 269.7, -3].map(roundDuration)).toEqual([1, 1, 1, 1, 2, 3, 270, 1]);
    expect(Number.isInteger(roundDuration(123.456))).toBe(true);
  });
});

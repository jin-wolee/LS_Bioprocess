import { describe, expect, it } from "vitest";
import { objectTimes } from "./events.ts";
import { handPlan, indexOf } from "./fixture.ts";
import { createPlayback } from "./playback.ts";
import { keyOf, pickedOfKey } from "./view.ts";

// P5b (docs/design/plant_ui.md sections 3.4 and 4.2): the instants of one picked object, which `,` and `.` step between when something is picked, and the keys that name a picked object. Every list
// is typed by hand from the hand plan of fixture.ts (see it for the instants): U01 and U02 are the reactors 0 and 1, AN-1 and AN-2 the analyzers 0 and 1, OP-01 and OP-02 the operators 0 and 1.

const plan = handPlan();
const sample = (id: string) => ({ kind: "sample" as const, index: indexOf(plan, id) });

describe("The instants of a picked object", () => {
  it("Given the sample U01-D00-3 (drawn at 3000, received at 3700, a failed run on AN-1 to 3970, a second on AN-2 from 3970 to 4510) Then its instants are the draw, the arrival and the instants of its two visits", () => {
    // queued 3700, started 3700, run started 3700, ended 3970; queued 3970, started 4240, run started 4240, ended 4510
    expect(objectTimes(plan, sample("U01-D00-3"))).toEqual([3000, 3700, 3970, 4240, 4510]);
  });

  it("Given a draw that the volume budget skipped Then its only instant is the skip, and a sample with no operator in the log has its own instants all the same", () => {
    expect(objectTimes(plan, sample("U02-D00-2"))).toEqual([5000]);
    expect(objectTimes(plan, sample("U02-D00-4"))).toEqual([14000, 14700, 14970, 15240]);
  });

  it("Given the reactor U02 (inoculated at 2000, stopped at 12000) Then its instants are its inoculation, its marks and the draws on it, the skipped one included", () => {
    // draws at 2100, 5000 (skipped), 11000 and 14000; marks: a scripted feed at 3500, a signal at 7000, a deviation at 7500, the stop at 12000
    expect(objectTimes(plan, { kind: "reactor", index: 1 })).toEqual([2000, 2100, 3500, 5000, 7000, 7500, 11000, 12000, 14000]);
  });

  it("Given the reactor U01 Then the draws on it and its own marks are in, and the marks of U02 are not", () => {
    // draws at 2000, 2200, 3000 and 8000; inoculated at 1000; a feed at 3000, a shift at 3600, an alarm at 4000, the harvest at 9000
    expect(objectTimes(plan, { kind: "reactor", index: 0 })).toEqual([1000, 2000, 2200, 3000, 3600, 4000, 8000, 9000]);
  });

  it("Given the analyzer AN-2 Then its instants are the start, the run start and the end of the visits it holds, its window edges and nothing of AN-1", () => {
    // visits on AN-2: 4240/4240/4510, 11700/11820/12090, 14970/14970/15240; the maintenance window 2000 to 3300; its calibrations: none (the only calibration is AN-1's, at 5000)
    expect(objectTimes(plan, { kind: "analyzer", index: 1 })).toEqual([2000, 3300, 4240, 4510, 11700, 11820, 12090, 14970, 15240]);
  });

  it("Given the analyzer AN-1 Then its calibration, its two windows and its visits are in", () => {
    const times = objectTimes(plan, { kind: "analyzer", index: 0 });
    for (const t of [0, 1500, 5000, 20000, 30000, 2700, 2970, 3510, 3700, 3970, 8700, 8970, 14700, 14970]) expect(times, `t = ${t}`).toContain(t);
    expect(times).not.toContain(4240); // AN-2's
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
  });

  it("Given the operators Then their instants are their draws only", () => {
    expect(objectTimes(plan, { kind: "staff", index: 1 })).toEqual([11000]);
    expect(objectTimes(plan, { kind: "staff", index: 0 })).toEqual([2000, 2100, 2200, 3000, 8000]);
  });
});

describe("The step to the next event of the picked object", () => {
  it("Given a sample picked and the clock at its draw Then the next step lands on its arrival and not on the nearer event of another object, the previous on nothing before it, and the clock pauses", () => {
    const playback = createPlayback(plan, true);
    const times = objectTimes(plan, sample("U01-D00-3"));
    playback.seek(3000);
    playback.step(1, times);
    expect(playback.get()).toMatchObject({ t: 3700, playing: false }); // the floor has events at 3000 and 3500 and 3600 and 3700; the next of the sample is 3700, the floor's would be 3500
    playback.step(1, times);
    expect(playback.get().t).toBe(3970);
    playback.step(-1, times);
    expect(playback.get().t).toBe(3700);
    playback.seek(2000);
    playback.step(-1, times);
    expect(playback.get().t).toBe(2000); // nothing before its draw: the clock stays
  });

  it("Given a clock between two instants of the object Then next and previous are the two around it", () => {
    const playback = createPlayback(plan, false);
    const times = objectTimes(plan, { kind: "reactor", index: 1 });
    playback.seek(4000);
    playback.step(1, times);
    expect(playback.get().t).toBe(5000);
    playback.seek(4000);
    playback.step(-1, times);
    expect(playback.get().t).toBe(3500);
  });

  it("Given nothing picked (no list) Then the step goes over the whole floor as in P4", () => {
    const playback = createPlayback(plan, false);
    playback.seek(2000);
    playback.step(1);
    expect(playback.get().t).toBe(2100);
  });

  it("Given a picked object with no instants Then the step stays where it is", () => {
    const playback = createPlayback(plan, false);
    playback.seek(5000);
    playback.step(1, []);
    expect(playback.get().t).toBe(5000);
  });
});

describe("The key that names a picked object", () => {
  it("Given a reactor, an analyzer, an operator and a sample Then the key is the kind and the id of the plan, and the key gives the pick back", () => {
    const picks = [{ kind: "reactor" as const, index: 1 }, { kind: "analyzer" as const, index: 0 }, { kind: "staff" as const, index: 1 }, sample("U02-D00-3")];
    expect(picks.map((p) => keyOf(plan, p))).toEqual(["reactor:U02", "analyzer:AN-1", "staff:OP-02", "sample:U02-D00-3"]);
    for (const p of picks) expect(pickedOfKey(plan, keyOf(plan, p))).toEqual(p);
  });

  it("Given a key the plan does not hold, or of a kind that is not a pick (a hall) Then there is no pick", () => {
    expect(pickedOfKey(plan, "reactor:U99")).toBeNull();
    expect(pickedOfKey(plan, "hall:a_manual")).toBeNull();
    expect(pickedOfKey(plan, "nonsense")).toBeNull();
  });
});

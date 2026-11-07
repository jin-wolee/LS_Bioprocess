import { expect } from "vitest";
import { handPlan, indexOf } from "./fixture.ts";
import { sceneAt } from "./scene_at.ts";
import type { SceneState } from "./scene_at.ts";

export const plan = handPlan();
export const at = (t: number): SceneState => sceneAt(plan, t);
export const tube = (s: SceneState, id: string) => s.tubes.find((x) => x.sample === indexOf(plan, id));
export const DIGITS = 6;
/** A point of the floor within a micrometre of where the hand arithmetic puts it (the metres are sums of decimals, which a float does not hold exactly). */
export const near = (p: { x: number; z: number } | undefined, x: number, z: number): void => {
  expect(p, "a point").toBeDefined();
  expect(p?.x).toBeCloseTo(x, DIGITS);
  expect(p?.z).toBeCloseTo(z, DIGITS);
};

const id = "U01-D00-1";

// Staff movement and draw fixtures.
export const staffShift = () => {
  expect(at(9999).staff[1]?.on_duty).toBe(false);
  const op2 = at(10000).staff[1];
  expect(op2?.on_duty).toBe(true);
  expect(op2?.mode).toBe("idle");
  near(op2, 16.4, 18.9);
  expect(at(30000).staff[1]?.on_duty).toBe(false);
};

export const staffFirstWalk = () => {
  // home (15.6, 18.9) east to (24.5, 18.9) 8.9 m, north to (24.5, 14.7) 4.2 m, west to (13, 14.7) 11.5 m: 24.6 m (the way west is 25.8 m)
  const before = at(1589).staff[0];
  expect(before?.mode).toBe("idle");
  near(before, 15.6, 18.9);
  expect(at(1590).staff[0]?.mode).toBe("walking");
  const half = at(1795).staff[0];
  expect(half?.mode).toBe("walking");
  near(half, 24.5, 15.5);
  const arrived = at(2000).staff[0];
  expect(arrived?.mode).toBe("at_vessel");
  near(arrived, 13, 14.7);
};

export const staffCarry = () => {
  expect(at(2000).staff[0]?.carrying).toBe(indexOf(plan, "U01-D00-1"));
  expect(at(2049).staff[0]?.carrying).toBe(indexOf(plan, "U01-D00-1"));
  expect(at(2050).staff[0]?.carrying).toBeNull();
  expect(at(2060).staff[0]?.mode).toBe("at_vessel");
  near(at(2060).staff[0], 13, 14.7);
};

export const staffNextDraw = () => {
  // it leaves at 2100 - 2 / 0.06 = 2066.67 s, after the stay; at 2083 s it is 17 s from the end, 1.02 m short of U02
  const mid = at(2083).staff[0];
  expect(mid?.mode).toBe("walking");
  near(mid, 15 - 1.02, 14.7);
  const there = at(2100).staff[0];
  near(there, 15, 14.7);
  expect([there?.mode, there?.carrying]).toEqual(["at_vessel", indexOf(plan, "U02-D00-1")]);
};

export const staffWait = () => {
  const wait = at(2800).staff[0];
  near(wait, 13, 14.7);
  expect(wait?.mode).toBe("at_vessel");
};

export const staffReturnHome = () => {
  // the way home from (13, 14.7): east 11.5 m, south 4.2 m, west 8.9 m = 24.6 m (410 s), from 3060 s
  expect(at(3060).staff[0]?.mode).toBe("walking");
  near(at(3265).staff[0], 24.5, 15.5);
  const home = at(5000).staff[0];
  near(home, 15.6, 18.9);
  expect(home?.mode).toBe("idle");
  expect(at(7589).staff[0]?.mode).toBe("idle");
  expect(at(7590).staff[0]?.mode).toBe("walking");
  const there = at(8000).staff[0];
  near(there, 13, 14.7);
  expect([there?.mode, there?.carrying]).toEqual(["at_vessel", indexOf(plan, "U01-D00-4")]);
};

export const staffSecondOperator = () => {
  // home (16.4, 18.9) east 8.1 m, north 4.2 m, west 9.5 m
  const there = at(11000).staff[1];
  near(there, 15, 14.7);
  expect([there?.mode, there?.carrying]).toEqual(["at_vessel", indexOf(plan, "U02-D00-3")]);
  expect(at(10600).staff[1]?.mode).toBe("idle");
  expect(at(10700).staff[1]?.mode).toBe("walking");
};

// Tube movement through its first analyzer visit.
export const tubeHand = () => {
  expect(tube(at(1999), id)).toBeUndefined();
  for (const t of [2000, 2059]) {
    const x = tube(at(t), id);
    expect(x?.phase).toBe("hand");
    near(x, 13, 14.7);
  }
};

export const tubeTransport = () => {
  // (13, 14.7) west to (3.5, 14.7) 9.5 m, south to (3.5, 18.9) 4.2 m, east to (14, 18.9) 10.5 m, then north to the slot (14, 17.7) 1.2 m
  const start = tube(at(2060), id);
  expect(start?.phase).toBe("transport");
  near(start, 13, 14.7);
  const half = tube(at(2380), id);
  expect(half?.phase).toBe("transport");
  near(half, 3.5, 17.9);
  // 639 s of 640: 25.4 - 25.4 / 640 = 25.3603125 m along, 1.1603125 m into the last stretch north from (14, 18.9)
  const late = tube(at(2699), id);
  expect(late?.phase).toBe("transport");
  near(late, 14, 18.9 - 1.1603125);
};

export const tubeEnter = () => {
  expect(tube(at(2699), id)?.phase).toBe("transport");
  expect(at(2699).analyzers[0]?.tube).toBeNull();
  const first = tube(at(2700), id);
  expect(first?.phase).toBe("enter");
  near(first, 14, 17.7);
  const half = tube(at(2730), id);
  expect(half?.phase).toBe("enter");
  near(half, 13.4, 17.5);
};

export const tubeRun = () => {
  for (const t of [2760, 2969]) {
    const x = tube(at(t), id);
    expect(x?.phase).toBe("run");
    near(x, 12.8, 17.3);
    expect(at(t).analyzers[0]?.tube).toBe(indexOf(plan, id));
  }
};

export const tubeLeave = () => {
  const leaving = tube(at(2970), id);
  expect(leaving?.phase).toBe("leave");
  near(leaving, 12.8, 17.3);
  const half = tube(at(3030), id);
  expect(half?.phase).toBe("leave");
  near(half, 15.5, 17.05);
  expect(tube(at(3089), id)?.phase).toBe("leave");
  expect(tube(at(3090), id)).toBeUndefined();
  expect(at(3000).analyzers[0]?.tube).not.toBe(indexOf(plan, id));
};

export const tubeLabel = () => {
  expect(tube(at(2100), "U01-D00-1")?.label).toBe("handwritten");
  expect(tube(at(2300), "U02-D00-1")?.label).toBe("preprinted_barcode");
  expect(tube(at(2300), "U01-D00-2")?.label).toBe("issued_at_draw");
};

// Analyzer state and signals.
export const analyzerRun = () => {
  const state = at(2750);
  expect(state.analyzers[0]).toMatchObject({ lamp: "run", sign: null, tube: indexOf(plan, "U01-D00-1") });
  expect(state.analyzers[0]?.progress).toBeCloseTo(5 / 27, DIGITS);
  expect(state.analyzers[1]).toMatchObject({ lamp: "maintenance", sign: "maintenance", progress: null, tube: null });
};

export const analyzerMaintenance = () => {
  expect([1999, 2000, 3299, 3300].map((t) => at(t).analyzers[1]?.sign)).toEqual([null, "maintenance", "maintenance", null]);
};

export const analyzerSetup = () => {
  expect(at(11790).analyzers[1]).toMatchObject({ lamp: "setup", progress: null, tube: indexOf(plan, "U02-D00-3") });
  expect(at(11820).analyzers[1]).toMatchObject({ lamp: "run", progress: 0 });
  expect(at(11955).analyzers[1]?.progress).toBe(0.5);
  expect(tube(at(11790), "U02-D00-3")?.phase).toBe("setup");
  expect(tube(at(11730), "U02-D00-3")?.phase).toBe("enter");
  expect(tube(at(11955), "U02-D00-3")?.diluted).toBe(true);
  expect(tube(at(2750), "U01-D00-1")?.diluted).toBe(false);
};

export const analyzerFailedQc = () => {
  expect(at(4000).analyzers[0]).toMatchObject({ verdict: "qc_failed", slip: true });
  expect(at(4569).analyzers[0]).toMatchObject({ verdict: "qc_failed", slip: true });
  expect(at(4570).analyzers[0]).toMatchObject({ verdict: null, slip: false });
};

export const analyzerPassedQc = () => {
  expect(at(2985).analyzers[0]).toMatchObject({ verdict: "qc_passed", slip: true, lamp: "run" });
};

export const analyzerCalibration = () => {
  expect([4999, 5000, 5899, 5900].map((t) => at(t).analyzers[0]?.calibration)).toEqual([false, true, true, false]);
  expect(at(5000).analyzers[1]?.calibration).toBe(false);
};

export const analyzerWindows = () => {
  expect(at(1000).analyzers[0]).toMatchObject({ lamp: "qc", sign: "qc" });
  expect(at(1500).analyzers[0]).toMatchObject({ lamp: "idle", sign: null });
  expect(at(25000).analyzers[0]).toMatchObject({ lamp: "closed", sign: "closed" });
  expect(at(30000).analyzers[0]).toMatchObject({ lamp: "idle", sign: null });
};

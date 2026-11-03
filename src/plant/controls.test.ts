import { describe, expect, it } from "vitest";
import type { ScenePlan } from "../protocol.ts";
import { DEFAULT_VIEW, LIMITS, cameraAt, drag, followGoal, heading, keyDirection, lifted, lookKey, tilt, turn, zoom } from "./controls.ts";
import { layoutOf } from "./layout.ts";

// docs/design/plant_ui.md section 3.4: drag to look, wheel to zoom, the keys of the table, a camera limited in zoom (4 to 40 m) and pitch that never goes below the floor or inside a vessel.
// The state of the controls is a plain object and these are pure functions of it, so no WebGL. Yaw 0 is a camera south of the walker looking north (z decreases); x runs east.

const l = layoutOf({ bays: [{ size: 12, profile: "bench_manual" }], analyzers: [{ profile: "allinone_atline", group: "AIO" }], architectures: ["a_manual"] } satisfies ScenePlan["layout"]);
const view = { yaw: 0, pitch: 0.5, dist: 12 };

describe("the view", () => {
  it("Given the limits Then the zoom is 4 to 40 metres and the pitch stays above the floor and below the top-down view", () => {
    expect(LIMITS.dist).toEqual([4, 40]);
    expect(LIMITS.pitch[0]).toBeGreaterThan(0);
    expect(LIMITS.pitch[1]).toBeLessThan(Math.PI / 2);
    expect(DEFAULT_VIEW.dist).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_VIEW.dist).toBeLessThanOrEqual(40);
  });

  it("Given a drag to the right Then the camera goes round to the west (yaw decreases) by 0.005 rad a pixel; a drag down raises it", () => {
    const v = drag(view, 100, 40);
    expect(v.yaw).toBeCloseTo(-0.5, 9);
    expect(v.pitch).toBeCloseTo(0.5 + 0.2, 9);
    expect(v.dist).toBe(12);
  });

  it("Given a long drag up Then the pitch stops at its lower limit; a long drag down at its upper limit", () => {
    expect(drag(view, 0, -10000).pitch).toBe(LIMITS.pitch[0]);
    expect(drag(view, 0, 10000).pitch).toBe(LIMITS.pitch[1]);
  });

  it("Given the wheel Then the distance scales and stays within 4 and 40 metres", () => {
    expect(zoom(view, -100).dist).toBeLessThan(12);
    expect(zoom(view, 100).dist).toBeGreaterThan(12);
    expect(zoom(view, -1e6).dist).toBe(4);
    expect(zoom(view, 1e6).dist).toBe(40);
  });

  it("Given the keys Q and E, R and F Then they turn and tilt by a step, and the tilt stops at its limit", () => {
    expect(turn(view, 1).yaw).toBeGreaterThan(0);
    expect(turn(view, -1).yaw).toBeLessThan(0);
    expect(tilt(view, 1).pitch).toBeGreaterThan(0.5);
    expect(tilt({ ...view, pitch: LIMITS.pitch[1] }, 1).pitch).toBe(LIMITS.pitch[1]);
  });
});

describe("the keys of the look (P8a: one key, one meaning)", () => {
  it("Given R and T Then R tilts the camera up by a step and T tilts it down; Q and E turn; plus and minus zoom", () => {
    expect(lookKey("r")?.(view).pitch).toBeCloseTo(0.5 + 0.12, 9);
    expect(lookKey("t")?.(view).pitch).toBeCloseTo(0.5 - 0.12, 9);
    expect(lookKey("q")?.(view).yaw).toBeCloseTo(-0.12, 9);
    expect(lookKey("e")?.(view).yaw).toBeCloseTo(0.12, 9);
    expect(lookKey("+")?.(view).dist).toBeLessThan(12);
    expect(lookKey("-")?.(view).dist).toBeGreaterThan(12);
  });

  it("Given F Then the camera's look has no use for it: F follows a picked sample and nothing else (it tilted the camera down until P8a)", () => {
    expect(lookKey("f")).toBeNull();
    expect(lookKey("F")).toBeNull();
  });
});

describe("the camera", () => {
  it("Given yaw 0, pitch 30 degrees and 10 metres Then the camera is 8.66 m south of the target (cos 30 x 10), 5 m above it (sin 30 x 10)", () => {
    const c = cameraAt({ yaw: 0, pitch: Math.PI / 6, dist: 10 }, { x: 20, z: 15 }, 1.2);
    expect(c.position.x).toBeCloseTo(20, 9);
    expect(c.position.z).toBeCloseTo(15 + 8.660254, 5);
    expect(c.position.y).toBeCloseTo(1.2 + 5, 9);
    expect(c.target).toEqual({ x: 20, y: 1.2, z: 15 });
  });

  it("Given yaw a quarter turn Then the camera is east of the target", () => {
    const c = cameraAt({ yaw: Math.PI / 2, pitch: Math.PI / 6, dist: 10 }, { x: 20, z: 15 }, 1.2);
    expect(c.position.x).toBeCloseTo(20 + 8.660254, 5);
    expect(c.position.z).toBeCloseTo(15, 9);
  });

  it("Given a camera that would stand inside the bay Then it is lifted above the vessels (the plinth's 2.2 m and 0.4 m); one in the open is not moved", () => {
    const inBay = { position: { x: 10, y: 1, z: 11 }, target: { x: 10, y: 1.2, z: 5 } };
    expect(lifted(l, inBay).position.y).toBeCloseTo(2.6, 9);
    const open = { position: { x: 3.5, y: 3, z: 11 }, target: { x: 3.5, y: 1.2, z: 5 } };
    expect(lifted(l, open)).toEqual(open);
  });

  it("Given a camera below the floor Then it is lifted to a head's height above it", () => {
    expect(lifted(l, { position: { x: 3.5, y: -2, z: 11 }, target: { x: 3.5, y: 1.2, z: 5 } }).position.y).toBeGreaterThanOrEqual(0.5);
  });
});

describe("the keys that walk", () => {
  it("Given yaw 0 Then W and the up arrow walk north (-z), S south, D east, A and the left arrow west", () => {
    const d = (keys: string[]) => keyDirection(new Set(keys), 0);
    expect(d(["w"])).toEqual({ x: 0, z: -1 });
    expect(d(["ArrowUp"])).toEqual({ x: 0, z: -1 });
    expect(d(["s"])).toEqual({ x: 0, z: 1 });
    expect(d(["d"])).toEqual({ x: 1, z: 0 });
    expect(d(["ArrowLeft"])).toEqual({ x: -1, z: 0 });
  });
  it("Given yaw a quarter turn (the camera east of the walker looking west) Then W walks west", () => {
    const d = keyDirection(new Set(["w"]), Math.PI / 2);
    expect(d.x).toBeCloseTo(-1, 9);
    expect(d.z).toBeCloseTo(0, 9);
  });
  it("Given two keys at once Then the direction is a unit vector (a diagonal is no faster); opposite keys cancel; no key is no direction", () => {
    const d = keyDirection(new Set(["w", "d"]), 0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 9);
    expect(keyDirection(new Set(["w", "s"]), 0)).toEqual({ x: 0, z: 0 });
    expect(keyDirection(new Set(), 0)).toEqual({ x: 0, z: 0 });
  });
  it("Given a direction Then the heading of the figure is the angle it faces (0 north, a quarter turn east)", () => {
    expect(heading({ x: 0, z: -1 })).toBeCloseTo(0, 9);
    expect(heading({ x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
  });
});

// P5b (docs/design/plant_ui.md sections 3.4 and 9): follow keeps the camera on a tube; under reduced motion there is no follow while the clock plays, and the camera cuts to the tube at each step and
// each seek of a paused clock.
describe("where the camera follows a tube to", () => {
  const tube = { x: 13.5, z: 14.2 };

  it("Given the run playing and no reduced motion Then the camera goes to the tube at every reading of the clock", () => {
    expect(followGoal(tube, false, true)).toEqual({ x: 13.5, z: 14.2 });
    expect(followGoal(tube, false, false)).toEqual({ x: 13.5, z: 14.2 });
  });

  it("Given reduced motion Then the camera cuts to the tube when the clock is paused (a step or a seek) and does not follow while it plays", () => {
    expect(followGoal(tube, true, false)).toEqual({ x: 13.5, z: 14.2 });
    expect(followGoal(tube, true, true)).toBeNull();
  });

  it("Given a tube that is not on the floor Then there is no place to go to and the camera stays where it was", () => {
    expect(followGoal(undefined, false, true)).toBeNull();
    expect(followGoal(undefined, true, false)).toBeNull();
  });
});

import { Group, Matrix4, Quaternion, Vector3 } from "three";
import type { BufferGeometry, InstancedMesh, Material } from "three";
import { describe, expect, it } from "vitest";
import { tubeScale } from "../controls.ts";
import { handPlan } from "../fixture.ts";
import { sceneAt } from "../scene_at.ts";
import { buildTubeMotion } from "./motion_tubes.ts";

// P8a: the tubes grow with the distance of the camera, so that they are more than a few pixels at the default camera, and stand on the same foot at every size. A tube is 0.42 m tall (TUBE.height of motion_tubes.ts).
// The tubes are those of the hand plan at 2,750 s (sample U01-D00-1 and sample U02-D00-1 are on the floor).

const plan = handPlan();
const state = sceneAt(plan, 2750);

const drawn = (scale?: number) => {
  const group = new Group();
  const disposables: (BufferGeometry | Material)[] = [];
  const draw = buildTubeMotion(plan.samples.length, group, disposables);
  if (scale === undefined) draw(state);
  else draw(state, scale);
  const bodies = group.children[0] as InstancedMesh;
  const at = (i: number) => {
    const m = new Matrix4();
    bodies.getMatrixAt(i, m);
    const p = new Vector3();
    const s = new Vector3();
    m.decompose(p, new Quaternion(), s);
    return { p, s };
  };
  return { count: bodies.count, at };
};

describe("tubeScale: how much bigger than life a tube is drawn at a camera distance", () => {
  it("Given the camera is at 9 m or nearer Then the tube is its own size; at the default 14 m it is 14/9 of it; the farthest camera, 40 m, stops at twice", () => {
    expect(tubeScale(4)).toBe(1);
    expect(tubeScale(9)).toBe(1);
    expect(tubeScale(14)).toBeCloseTo(14 / 9, 9);
    expect(tubeScale(18)).toBe(2);
    expect(tubeScale(40)).toBe(2);
  });
});

describe("the tubes of the scene", () => {
  it("Given tubes on the floor and no scale Then each is drawn at its own size with its foot on the floor of the state", () => {
    const { count, at } = drawn();
    expect(count).toBe(state.tubes.length);
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const { p, s } = at(i);
      expect(s.y).toBeCloseTo(1, 5);
      expect(p.y - 0.21).toBeCloseTo((state.tubes[i] as { y: number }).y, 5);
    }
  });

  it("Given a scale of 1.5 Then each tube is 1.5 times as tall and as wide, and its foot is where it was", () => {
    const { count, at } = drawn(1.5);
    for (let i = 0; i < count; i++) {
      const { p, s } = at(i);
      expect([s.x, s.y, s.z].map((v) => +v.toFixed(5))).toEqual([1.5, 1.5, 1.5]);
      expect(p.y - 0.21 * 1.5).toBeCloseTo((state.tubes[i] as { y: number }).y, 5);
    }
  });
});

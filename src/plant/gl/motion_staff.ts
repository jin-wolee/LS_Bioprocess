import { BoxGeometry, CapsuleGeometry, Group, MeshStandardMaterial, SphereGeometry } from "three";
import type { BufferGeometry, Material } from "three";
import type { SceneState } from "../scene_at.ts";
import { makePool } from "./pool.ts";

// The staff on the floor (docs/design/plant_ui.md section 3.2): a plain figure for each operator who is on duty at the clock instant, in a pale coat, walking to the vessel of a draw, standing at it with
// the tube in the hand, and walking home. No likeness of any product's character. The id tag is a DOM label that follows the figure (labels.ts).

export const STAFF_HEAD = 1.78; // metres: where the id tag floats

export const buildStaffMotion = (count: number, group: Group, disposables: (BufferGeometry | Material)[]): ((state: SceneState) => { x: number; z: number }[]) => {
  const coat = new MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.7 });
  const skin = new MeshStandardMaterial({ color: 0xf0c8a6, roughness: 0.8 });
  const body = new CapsuleGeometry(0.21, 0.72, 4, 12);
  const head = new SphereGeometry(0.17, 14, 10);
  // a pale clipboard held in front, so that the way the figure faces can be seen
  const board = new BoxGeometry(0.3, 0.26, 0.04);
  const paper = new MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.6 });
  disposables.push(coat, skin, body, head, board, paper);
  const bodies = makePool(body, coat, count, { cast: true });
  const heads = makePool(head, skin, count, { cast: true });
  const boards = makePool(board, paper, count);
  group.add(bodies.mesh, heads.mesh, boards.mesh);

  return (state) => {
    bodies.begin();
    heads.begin();
    boards.begin();
    const out: { x: number; z: number }[] = [];
    for (const s of state.staff) {
      if (!s.on_duty) {
        out.push({ x: Number.NaN, z: Number.NaN });
        continue;
      }
      bodies.put(s.x, 0.58, s.z, 1, 1, 1, -s.heading);
      heads.put(s.x, 1.24, s.z);
      boards.put(s.x + Math.sin(s.heading) * 0.25, 0.72, s.z - Math.cos(s.heading) * 0.25, 1, 1, 1, -s.heading);
      out.push({ x: s.x, z: s.z });
    }
    bodies.end();
    heads.end();
    boards.end();
    return out;
  };
};

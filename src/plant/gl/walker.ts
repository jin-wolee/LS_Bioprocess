import type { Mesh } from "three";
import { heading, keyDirection } from "../controls.ts";
import type { Layout, Point } from "../layout.ts";
import { SPEED, advance, pathOf, stepTo } from "../walk.ts";

// The reader's figure on the floor (docs/design/plant_ui.md section 3.4): where it stands, which way it faces, the path a click asked for and the keys that walk it. The scene gives it the seconds of a frame and
// the yaw of the camera (W walks away from the camera) and reads where it is; the camera, the rings and the picking are the scene's.

export interface Walker {
  readonly position: Point;
  /** The angle the figure faces: 0 is north, a quarter turn is east. */
  readonly facing: number;
  /** Seconds the figure has been walking without a stop (the bob of the walk). */
  readonly walked: number;
  /** The walking keys that are held (`w a s d` and the arrows). */
  readonly keys: Set<string>;
  /** Asks for a walk to a point along the walk graph; the mark on the floor is put where it ends. */
  walkTo(to: Point): void;
  /** One frame: "keys" when held keys moved the figure (they cancel a click's path), "path" when a click's path did, null when it stood still. */
  step(dt: number, yaw: number): "keys" | "path" | null;
}

export const buildWalker = (layout: Layout, marker: Mesh): Walker => {
  let position: Point = { ...layout.entrance };
  let facing = 0;
  let path: Point[] | null = null;
  let walked = 0;
  const keys = new Set<string>();
  return {
    get position() {
      return position;
    },
    get facing() {
      return facing;
    },
    get walked() {
      return walked;
    },
    keys,
    walkTo(to) {
      path = pathOf(layout, position, to);
      const end = path[path.length - 1] as Point;
      marker.position.set(end.x, 0.03, end.z);
      marker.visible = path.length > 1;
    },
    step(dt, yaw) {
      const direction = keyDirection(keys, yaw);
      let moved: "keys" | "path" | null = null;
      if (direction.x !== 0 || direction.z !== 0) {
        path = null;
        marker.visible = false;
        position = stepTo(layout, position, direction.x * SPEED * dt, direction.z * SPEED * dt);
        facing = heading(direction);
        moved = "keys";
      } else if (path) {
        const before = position;
        const step = advance(path, SPEED * dt);
        position = step.position;
        path = step.done ? null : step.rest;
        if (step.done) marker.visible = false;
        if (position.x !== before.x || position.z !== before.z) facing = heading({ x: position.x - before.x, z: position.z - before.z });
        moved = step.done ? null : "path";
      }
      walked = moved ? walked + dt : 0;
      return moved;
    },
  };
};

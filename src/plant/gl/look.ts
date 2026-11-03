import { Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import type { Point } from "../layout.ts";

// What the camera was brought to, written on the plant host for the end-to-end checks (docs/design/plant_ui.md section 3.5, "How it ends"; section 10): `data-plant-look` is the key of the object a step of
// the tour, a button of a list or a pick last brought the camera to (`reactor:U03`, `halls:all`), and `data-plant-look-ndc` is where the point the camera is brought to is on the screen, `[x,y]` from -1
// to 1 in device coordinates: `[0.000,0.000]` once the camera is on it, so a camera that cuts is there in the frame after the step and one that glides is not. Absent while the camera follows the figure.

export const buildLook = (host: HTMLElement) => {
  const p = new Vector3();
  return {
    set(key: string): void {
      host.dataset.plantLook = key;
    },
    /** Each frame: where the point the camera is brought to (at the height it looks at) is on the screen, or nothing when the camera follows the figure. */
    update(at: Point | null, camera: PerspectiveCamera, head: number): void {
      if (at === null) {
        delete host.dataset.plantLookNdc;
        return;
      }
      p.set(at.x, head, at.z).project(camera);
      const where = `[${p.x.toFixed(3)},${p.y.toFixed(3)}]`;
      if (host.dataset.plantLookNdc !== where) host.dataset.plantLookNdc = where;
    },
  };
};

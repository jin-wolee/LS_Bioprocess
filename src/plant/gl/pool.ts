import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { BufferGeometry, Material } from "three";

// A pool of the instances of one shape that change with the clock (docs/design/plant_ui.md sections 3.2 and 8): one draw call for all of them. Each frame the owner calls `begin`, `put` once for
// each instance that is visible, and `end`; the mesh then draws exactly those. The instances move, so the mesh is never culled by the bounding sphere of its first state.

export interface Pool {
  mesh: InstancedMesh;
  begin(): void;
  /** One instance: its place, its scale, its turn about the vertical axis and (for a pool made with `colored`) its colour. Beyond the capacity it is dropped. */
  put(x: number, y: number, z: number, sx?: number, sy?: number, sz?: number, ry?: number, color?: number): void;
  end(): void;
}

const up = new Vector3(0, 1, 0);

export const makePool = (geometry: BufferGeometry, material: Material, capacity: number, options: { cast?: boolean; colored?: boolean } = {}): Pool => {
  const size = Math.max(1, capacity);
  const mesh = new InstancedMesh(geometry, material, size);
  mesh.count = 0;
  mesh.castShadow = options.cast === true;
  mesh.frustumCulled = false;
  if (options.colored) mesh.setColorAt(0, new Color(0xffffff)); // allocates the colour buffer before the first draw
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const place = new Vector3();
  const scale = new Vector3();
  const tint = new Color();
  let n = 0;
  return {
    mesh,
    begin: () => {
      n = 0;
    },
    put(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, color) {
      if (n >= size) return;
      turn.setFromAxisAngle(up, ry);
      mesh.setMatrixAt(n, matrix.compose(place.set(x, y, z), turn, scale.set(sx, sy, sz)));
      if (color !== undefined && options.colored) mesh.setColorAt(n, tint.set(color));
      n++;
    },
    end() {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
};

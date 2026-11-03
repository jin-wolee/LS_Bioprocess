import { BoxGeometry, Color, ExtrudeGeometry, InstancedMesh, MeshStandardMaterial, Path, Plane, Shape, Vector3 } from "three";
import type { BufferGeometry, Material, Object3D, Ray } from "three";
import { FLAGS_BOARD, cellAt, cellCentre, flagMatrix, flagsGeometry } from "../flags_board.ts";
import type { Layout } from "../layout.ts";
import { rayBox } from "../pick.ts";
import type { ScenePlan } from "../../protocol.ts";
import { PALETTE } from "./floor.ts";
import type { Labels } from "./labels.ts";
import { placed } from "./place.ts";

// The flags board of the scene (docs/design/plant_ui.md section 3.2, "As built in P6b", and P8a): a plate on the north wall and a cell for each (flag, hall). A flag that is on is a raised block, one that is
// off is a hollow outline (a rectangle with a hole, ADR-0011: it was a flat filled tile, told from an on cell by colour and height), and a hall whose record has not arrived is a small flat mark (shape carries
// it, colour repeats it). The blocks and the marks are one instanced mesh, the outlines another. The names of the flags and the id of each hall are labels. The matrix is `flagMatrix` of the plan with the
// halls that have arrived, written again when the page says another hall came; the cell a ray meets is `cellAt` on the plane of the front face.

export interface PickedCell {
  /** The index into the halls of the layout. */
  hall: number;
  flag: string;
  /** The distance along the ray to the front face: the scene compares it with the other things a click can reach. */
  distance: number;
}

export interface FlagsBoard {
  /** The halls that have arrived (as `setHalls` of the scene): the cells are written again. */
  setHalls(records: ScenePlan["records"]): void;
  /** The cell the ray meets on the front face, or null. */
  pick(ray: Ray): PickedCell | null;
}

const RAISED = 0.07;
const FLAT = 0.012;
const OUTLINE = 0.03;
const MARK = 0.35;
// the border of an outline as a fraction of the cell it is scaled to (0.4 m by 0.154 m): about 3.5 cm all round
const BORDER = { x: 0.09, y: 0.22 };

/** A unit rectangle with a rectangular hole, one unit deep and centred on the origin like a box: scaled to a cell it is the hollow outline of an off flag. */
const outline = (): ExtrudeGeometry => {
  const shape = new Shape();
  shape.moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.5, 0.5).lineTo(-0.5, 0.5).lineTo(-0.5, -0.5);
  const hole = new Path();
  const [x, y] = [0.5 - BORDER.x, 0.5 - BORDER.y];
  hole.moveTo(-x, -y).lineTo(-x, y).lineTo(x, y).lineTo(x, -y).lineTo(-x, -y);
  shape.holes.push(hole);
  const geometry = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geometry.translate(0, 0, -0.5);
  return geometry;
};

export const buildFlagsBoard = (layout: Layout, plan: ScenePlan, flags: readonly string[], parent: Object3D, labels: Labels, disposables: (BufferGeometry | Material)[]): FlagsBoard => {
  const halls = plan.layout.architectures;
  const g = flagsGeometry(layout.width, flags.length, halls.length);
  const box = new BoxGeometry(1, 1, 1);
  disposables.push(box);

  const plate = new InstancedMesh(box, new MeshStandardMaterial({ color: 0xf6f1e4, roughness: 0.9 }), 1);
  plate.setMatrixAt(0, placed((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, g.z - FLAGS_BOARD.thick / 2, g.x1 - g.x0, g.y1 - g.y0, FLAGS_BOARD.thick));
  plate.receiveShadow = true;
  const capacity = Math.max(1, flags.length * halls.length);
  const cells = new InstancedMesh(box, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), capacity);
  const frame = outline();
  const frames = new InstancedMesh(frame, new MeshStandardMaterial({ color: 0x5f6f7e, roughness: 0.6 }), capacity);
  cells.castShadow = true;
  frames.castShadow = true;
  parent.add(plate, cells, frames);
  disposables.push(plate.material as Material, cells.material as Material, frame, frames.material as Material);

  // the names of the flags down the left of the rows (they show when the camera is near) and the id of each hall over its column
  labels.fixed([
    ...flags.map((text, row) => ({ text, kind: "flagname", x: g.x0 + FLAGS_BOARD.pad + FLAGS_BOARD.nameW / 2, y: cellCentre(g, row, 0).y - FLAGS_BOARD.cellH / 2, z: g.z })),
    // the ids of the halls over their columns: a long id of a derived hall wraps inside its column (labels.ts)
    ...halls.map((text, col) => ({ text, kind: "flaghall", x: cellCentre(g, 0, col).x, y: g.cellsTop, z: g.z })),
  ]);

  const on = new Color(PALETTE.accent);
  const pending = new Color(0xc7d0d8);
  const write = (records: ScenePlan["records"]): void => {
    const matrix = flagMatrix({ ...plan, records: [...records] }, flags);
    let blocks = 0;
    let outlines = 0;
    for (const [row, line] of matrix.cells.entries()) {
      for (const [col, cell] of line.entries()) {
        const at = cellCentre(g, row, col);
        const [w, h] = [FLAGS_BOARD.cellW * 0.8, FLAGS_BOARD.cellH * 0.7];
        if (cell === false) {
          frames.setMatrixAt(outlines++, placed(at.x, at.y, g.z + OUTLINE / 2, w, h, OUTLINE));
          continue;
        }
        const depth = cell === true ? RAISED : FLAT;
        const scale = cell === null ? MARK : 1;
        cells.setMatrixAt(blocks, placed(at.x, at.y, g.z + depth / 2, w * scale, h * scale, depth));
        cells.setColorAt(blocks++, cell === true ? on : pending);
      }
    }
    cells.count = blocks;
    frames.count = outlines;
    cells.instanceMatrix.needsUpdate = true;
    frames.instanceMatrix.needsUpdate = true;
    if (cells.instanceColor) cells.instanceColor.needsUpdate = true;
  };
  plate.instanceMatrix.needsUpdate = true;
  write(plan.records);

  const hit = new Vector3();
  const face = new Plane(new Vector3(0, 0, 1), -g.z);
  return {
    setHalls: write,
    pick(ray) {
      if (!ray.intersectPlane(face, hit)) return null;
      const found = cellAt(g, hit.x, hit.y);
      const flag = found === null ? undefined : flags[found.row];
      if (found === null || flag === undefined) return null;
      // the halls and the bays stand between the camera and the wall: a ray that enters one of them first is aimed at it, not at the panel behind it
      const distance = ray.origin.distanceTo(hit);
      const o = ray.origin;
      const d = ray.direction;
      const aim = { origin: [o.x, o.y, o.z] as [number, number, number], dir: [d.x, d.y, d.z] as [number, number, number] };
      for (const b of layout.obstacles) {
        const t = rayBox(aim, { min: [b.x, 0, b.z], max: [b.x + b.w, b.h, b.z + b.d] });
        if (t !== null && t < distance) return null;
      }
      return { hall: found.col, flag, distance };
    },
  };
};

import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, MeshStandardMaterial } from "three";
import type { BufferGeometry, Material } from "three";
import { BENCH_TOP, BOARD, PLINTH, analyzerShape, boardPoint, vesselShape } from "../dims.ts";
import { SHELF } from "../hall_shelves.ts";
import type { Layout } from "../layout.ts";
import { laneLength, trayZ } from "../scene_at.ts";
import type { ObjectKind } from "../view.ts";
import { PALETTE } from "./floor.ts";
import { placed } from "./place.ts";

// The things on the floor (docs/design/plant_ui.md section 3.2), built from primitives and instanced: the bay plinths with their vessels and status lamps, the bench with the analyzers and the
// intake lanes, and the record halls (one wall of shelves for each data architecture). Shape and text carry the meaning, colour only repeats it. The profile changes the look and never the
// position. This file builds what does not move (P3); the lamps, the liquid, the tubes and the staff that follow the clock are drawn by motion.ts from `sceneAt`, and the cards on the shelves
// (P5a) by motion_halls.ts from `hallsAt`; the boards are the ones hall_shelves.ts lays the cards on.

// the sizes are dims.ts's (the pick reads the same numbers); the files of the scene keep importing them from here
export { ANALYZERS, BENCH_TOP, PLINTH, VESSELS, analyzerShape, vesselShape } from "../dims.ts";

/** The height of the top of the intake lane's table (a tube stands on it: LOOK.level.lane is just above). */
const LANE_TOP = 0.68;

const standard = (color: number, roughness = 0.6, metalness = 0.05): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness, metalness });

export interface Built {
  group: Group;
  /** The glass of each reactor, by unit: the mesh and the instance, so that the jacket can be tinted. */
  jackets: { mesh: InstancedMesh; index: number }[];
  /** What was built, by kind: the number of instances of the main mesh of each. */
  objects: Record<Exclude<ObjectKind, "staff" | "flags">, number>;
  /** The geometries and materials to free on dispose. */
  disposables: (BufferGeometry | Material)[];
}

export const buildThings = (layout: Layout): Built => {
  const group = new Group();
  const disposables: (BufferGeometry | Material)[] = [];
  const box = new BoxGeometry(1, 1, 1);
  disposables.push(box);
  const add = (geometry: BufferGeometry, material: Material, count: number, cast = true): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(material);
    return mesh;
  };

  // the bays: one plinth each
  const plinths = add(box, standard(PALETTE.plinth, 0.9), layout.bays.length, false);
  for (const [i, b] of layout.bays.entries()) plinths.setMatrixAt(i, placed(b.footprint.x + b.footprint.w / 2, PLINTH / 2, b.footprint.z + b.footprint.d / 2, b.footprint.w, PLINTH, b.footprint.d));

  // the sampling board of each bay (P6a): a plate on two posts; its rows are DOM labels (labels.ts), written from `boardsAt`
  const plates = add(box, standard(0xf6f1e4, 0.9), layout.bays.length, false);
  const posts = add(box, standard(PALETTE.steel, 0.5, 0.2), 2 * layout.bays.length, false);
  for (const [i, b] of layout.bays.entries()) {
    const at = boardPoint(b.footprint);
    plates.setMatrixAt(i, placed(at.x, PLINTH + BOARD.bottom + BOARD.h / 2, at.z, BOARD.w, BOARD.h, BOARD.thick));
    for (const [k, dx] of [-BOARD.w / 2 + 0.1, BOARD.w / 2 - 0.1].entries()) posts.setMatrixAt(2 * i + k, placed(at.x + dx, PLINTH + BOARD.bottom / 2, at.z, BOARD.post, BOARD.bottom, BOARD.post));
  }

  // the vessels: one instanced mesh for each profile in use; the lamp, the liquid and the tint of the jacket are motion.ts's
  const profiles = [...new Set(layout.bays.map((b) => b.profile))];
  const jackets: Built["jackets"] = [];
  const white = new Color(0xffffff);
  let vessels = 0;
  for (const profile of profiles) {
    const shape = vesselShape(profile);
    const own = layout.vessels.filter((v) => (layout.bays[v.bay] as { profile: string }).profile === profile);
    const cylinder = new CylinderGeometry(shape.radius, shape.radius, shape.height, 20);
    disposables.push(cylinder);
    const mesh = add(cylinder, new MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.55 }), own.length);
    for (const [k, v] of own.entries()) {
      mesh.setMatrixAt(k, placed(v.x, PLINTH + shape.height / 2, v.z));
      mesh.setColorAt(k, white);
      jackets[v.unit] = { mesh, index: k };
    }
    vessels += own.length;
  }

  // the bench and its analyzers
  const bench = layout.bench;
  const top = add(box, standard(PALETTE.bench, 0.5), 1);
  top.setMatrixAt(0, placed(bench.x + bench.w / 2, BENCH_TOP / 2, bench.z + bench.d / 2, bench.w, BENCH_TOP, bench.d));
  const bodies = add(box, standard(0xf1f4f6, 0.5), layout.analyzers.length);
  const doors = add(box, standard(PALETTE.accent, 0.5), layout.analyzers.length, false);
  for (const [i, a] of layout.analyzers.entries()) {
    const [w, h, d] = analyzerShape(a.profile);
    bodies.setMatrixAt(i, placed(a.x, BENCH_TOP + h / 2, a.z, w, h, d));
    doors.setMatrixAt(i, placed(a.x, BENCH_TOP + h * 0.42, a.z + d / 2 + 0.01, w * 0.7, h * 0.55, 0.02));
  }
  // the intake lane of each group: a low table in front of its analyzers, with the tray on it where the tubes stand in their slots
  const lanes = add(box, standard(PALETTE.steel, 0.4, 0.3), layout.lanes.length, false);
  const legs = add(box, standard(PALETTE.steel, 0.5, 0.2), layout.lanes.length, false);
  for (const [i, lane] of layout.lanes.entries()) {
    const length = laneLength(lane);
    lanes.setMatrixAt(i, placed(lane.x, LANE_TOP - 0.03, trayZ(layout), length, 0.06, 0.5));
    legs.setMatrixAt(i, placed(lane.x, (LANE_TOP - 0.06) / 2, trayZ(layout), length - 0.2, LANE_TOP - 0.06, 0.3));
  }

  // the record halls: a back, two sides and the boards of hall_shelves.ts each
  const frame = standard(0x8fa3b5, 0.7);
  const shelf = standard(0xcbd8e2, 0.8);
  const n = layout.halls.length;
  const backs = add(box, frame, n);
  const sides = add(box, frame, 2 * n);
  const boards = add(box, shelf, SHELF.rows * n);
  for (const [i, h] of layout.halls.entries()) {
    const f = h.footprint;
    backs.setMatrixAt(i, placed(f.x + f.w / 2, f.h / 2, f.z + 0.05, f.w, f.h, 0.1));
    for (const [k, x] of [f.x + 0.04, f.x + f.w - 0.04].entries()) sides.setMatrixAt(2 * i + k, placed(x, f.h / 2, f.z + f.d / 2, 0.08, f.h, f.d));
    for (let k = 0; k < SHELF.rows; k++) boards.setMatrixAt(SHELF.rows * i + k, placed(f.x + f.w / 2, SHELF.board0 + k * SHELF.step, f.z + f.d / 2, f.w - 0.1, SHELF.thick, f.d - 0.05));
  }

  for (const mesh of group.children as InstancedMesh[]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  return { group, jackets, objects: { reactor: vessels, analyzer: bodies.count, hall: backs.count, board: plates.count }, disposables };
};

import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, MeshStandardMaterial, SphereGeometry } from "three";
import type { BufferGeometry, Material } from "three";
import type { Layout } from "../layout.ts";
import { METRES } from "../layout.ts";
import type { ScenePlan } from "../../protocol.ts";
import type { ObjectKind } from "../view.ts";
import { analyzerRowsAt, statusOf } from "../view.ts";
import { PALETTE } from "./floor.ts";
import { placed } from "./place.ts";

// The things on the floor (docs/design/plant_ui.md section 3.2), built from primitives and instanced: the bay plinths with their vessels and status lamps, the bench with the analyzers and the
// intake lanes, and the record halls (one wall of shelves for each data architecture). Shape and text carry the meaning, colour only repeats it. The profile changes the look and never the
// position. P3 draws the plan at one instant; the shelves are empty until the cards of P5.

const PLINTH = 0.2; // metres
const BENCH_TOP = 1.2;

/** The vessel of each bioreactor profile: a bench vessel, a small one of a mini-parallel block, a pilot tank. Unknown profiles are drawn as the bench vessel. */
const VESSELS: Record<string, { radius: number; height: number }> = {
  bench_manual: { radius: 0.42, height: 1 },
  micro_mini_parallel: { radius: 0.26, height: 0.7 },
  pilot: { radius: 0.62, height: 1.7 },
};
/** The analyzer of each profile: width, height and depth of its body on the bench. */
const ANALYZERS: Record<string, [number, number, number]> = {
  allinone_atline: [1.5, 0.85, 0.75],
  hplc: [1.1, 1.15, 0.85],
  split_cellcounter_metabolite: [1.8, 0.7, 0.6],
};

const standard = (color: number, roughness = 0.6, metalness = 0.05): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness, metalness });

export interface Built {
  group: Group;
  /** What was built, by kind: the number of instances of the main mesh of each. */
  objects: Record<ObjectKind, number>;
  /** The geometries and materials to free on dispose. */
  disposables: (BufferGeometry | Material)[];
}

export const buildThings = (layout: Layout, plan: ScenePlan, at: number): Built => {
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

  // the vessels: one instanced mesh for each profile in use, a lamp on the face toward the aisle
  const lamps = add(new SphereGeometry(0.09, 10, 8), standard(0xffffff, 0.4), layout.vessels.length, false);
  disposables.push(lamps.geometry);
  const lampColor = { idle: PALETTE.lampIdle, running: PALETTE.lampRunning, ended: PALETTE.lampEnded } as const;
  const profiles = [...new Set(layout.bays.map((b) => b.profile))];
  let vessels = 0;
  for (const profile of profiles) {
    const shape = VESSELS[profile] ?? (VESSELS.bench_manual as { radius: number; height: number });
    const own = layout.vessels.filter((v) => (layout.bays[v.bay] as { profile: string }).profile === profile);
    const cylinder = new CylinderGeometry(shape.radius, shape.radius, shape.height, 20);
    disposables.push(cylinder);
    const mesh = add(cylinder, new MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.25, metalness: 0.1 }), own.length);
    for (const [k, v] of own.entries()) {
      mesh.setMatrixAt(k, placed(v.x, PLINTH + shape.height / 2, v.z));
      lamps.setMatrixAt(v.unit, placed(v.x, PLINTH + shape.height * 0.92, v.z + shape.radius + 0.02));
      lamps.setColorAt(v.unit, new Color(lampColor[statusOf(plan.units[v.unit] as ScenePlan["units"][number], at)]));
    }
    vessels += own.length;
  }

  // the bench and its analyzers
  const bench = layout.bench;
  const top = add(box, standard(PALETTE.bench, 0.5), 1);
  top.setMatrixAt(0, placed(bench.x + bench.w / 2, BENCH_TOP / 2, bench.z + bench.d / 2, bench.w, BENCH_TOP, bench.d));
  const bodies = add(box, standard(0xf1f4f6, 0.5), layout.analyzers.length);
  const doors = add(box, standard(PALETTE.accent, 0.5), layout.analyzers.length, false);
  const analyzerLamps = add(new SphereGeometry(0.07, 10, 8), standard(0xffffff, 0.4), layout.analyzers.length, false);
  disposables.push(analyzerLamps.geometry);
  const lamp = { idle: PALETTE.lampIdle, qc: 0xd9a23a, maintenance: 0xd9a23a, closed: 0xb5483f } as const;
  for (const [i, a] of layout.analyzers.entries()) {
    const [w, h, d] = ANALYZERS[a.profile] ?? (ANALYZERS.allinone_atline as [number, number, number]);
    bodies.setMatrixAt(i, placed(a.x, BENCH_TOP + h / 2, a.z, w, h, d));
    doors.setMatrixAt(i, placed(a.x, BENCH_TOP + h * 0.42, a.z + d / 2 + 0.01, w * 0.7, h * 0.55, 0.02));
    analyzerLamps.setMatrixAt(i, placed(a.x + w * 0.32, BENCH_TOP + h * 0.88, a.z + d / 2 + 0.03));
    analyzerLamps.setColorAt(i, new Color(lamp[(analyzerRowsAt(plan, at)[i] as { lamp: keyof typeof lamp }).lamp]));
  }
  // the intake lane of each group: a tray in front of its analyzers
  const lanes = add(box, standard(PALETTE.steel, 0.4, 0.3), layout.lanes.length, false);
  for (const [i, lane] of layout.lanes.entries()) lanes.setMatrixAt(i, placed(lane.x, 0.04, bench.z + bench.d + 0.45, lane.analyzers.length * METRES.analyzerPitch - 0.4, 0.08, 0.5));

  // the record halls: a back, two sides and four shelves each
  const frame = standard(0x8fa3b5, 0.7);
  const shelf = standard(0xcbd8e2, 0.8);
  const n = layout.halls.length;
  const backs = add(box, frame, n);
  const sides = add(box, frame, 2 * n);
  const boards = add(box, shelf, 4 * n);
  for (const [i, h] of layout.halls.entries()) {
    const f = h.footprint;
    backs.setMatrixAt(i, placed(f.x + f.w / 2, f.h / 2, f.z + 0.05, f.w, f.h, 0.1));
    for (const [k, x] of [f.x + 0.04, f.x + f.w - 0.04].entries()) sides.setMatrixAt(2 * i + k, placed(x, f.h / 2, f.z + f.d / 2, 0.08, f.h, f.d));
    for (let k = 0; k < 4; k++) boards.setMatrixAt(4 * i + k, placed(f.x + f.w / 2, 0.3 + k * 0.62, f.z + f.d / 2, f.w - 0.1, 0.06, f.d - 0.05));
  }

  for (const mesh of group.children as InstancedMesh[]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  return { group, objects: { reactor: vessels, analyzer: bodies.count, hall: backs.count }, disposables };
};

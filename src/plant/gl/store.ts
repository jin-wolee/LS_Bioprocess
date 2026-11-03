import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, MeshStandardMaterial } from "three";
import type { BufferGeometry, Material } from "three";
import type { ScenePlan } from "../../protocol.ts";
import { CRATE, STATION } from "../dims.ts";
import type { Layout } from "../layout.ts";
import { STORE } from "../layout_store.ts";
import { PALETTE } from "./floor.ts";
import type { Labels } from "./labels.ts";
import { placed } from "./place.ts";

// The store of a break-out scene that does not move (docs/design/plant_ui.md section 3.2, "As built in P7c"): the lot rack with a crate for each lot (a box for a medium lot, a cylinder for a seed lot), the
// equipment stations (a table with a tank on it) and the confirmation shelf with its boards. Built from primitives and instanced, in the style of shapes.ts; the id of each crate and station is a DOM label.
// The tape, the links and the confirming tubes that follow the clock are motion_items.ts's. Nothing here says which item is contaminated: a crate is a crate.

const standard = (color: number, roughness = 0.6, metalness = 0.05): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness, metalness });
const FRAME = 0.06;

export interface StoreParts {
  group: Group;
  /** What was built, by kind: the lots and the stations. */
  objects: { lot: number; equipment: number };
  disposables: (BufferGeometry | Material)[];
}

export const buildStore = (layout: Layout, plan: ScenePlan, labels: Labels): StoreParts => {
  const group = new Group();
  const disposables: (BufferGeometry | Material)[] = [];
  const box = new BoxGeometry(1, 1, 1);
  const cylinder = new CylinderGeometry(1, 1, 1, 20);
  disposables.push(box, cylinder);
  const add = (geometry: BufferGeometry, material: Material, count: number, cast = true): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
    mesh.count = count;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(material);
    return mesh;
  };

  // the rack: a board for each tier and a post at each end; the crates stand on it
  const lots = plan.lots ?? [];
  const crates = layout.rack?.crates ?? [];
  const mediums = crates.filter((c) => lots[c.index]?.kind !== "seed");
  const seeds = crates.filter((c) => lots[c.index]?.kind === "seed");
  const rack = layout.rack;
  if (rack) {
    const f = rack.footprint;
    const tiers = Math.ceil(lots.length / STORE.crateRow);
    const boards = add(box, standard(PALETTE.steel, 0.5, 0.2), tiers, false);
    for (let t = 0; t < tiers; t++) boards.setMatrixAt(t, placed(f.x + f.w / 2, STORE.rackBoard + t * STORE.tier - FRAME / 2, f.z + f.d / 2, f.w, FRAME, f.d));
    const posts = add(box, standard(PALETTE.steel, 0.5, 0.2), 2, false);
    for (const [k, x] of [f.x + FRAME / 2, f.x + f.w - FRAME / 2].entries()) posts.setMatrixAt(k, placed(x, f.h / 2, f.z + f.d / 2, FRAME, f.h, f.d));
  }
  const boxes = add(box, standard(0xd9c7a0, 0.8), mediums.length);
  for (const [k, c] of mediums.entries()) boxes.setMatrixAt(k, placed(c.x, STORE.rackBoard + c.tier * STORE.tier + CRATE.h / 2, c.z, CRATE.w, CRATE.h, CRATE.w));
  const jars = add(cylinder, standard(0xa9c4e0, 0.5), seeds.length);
  for (const [k, c] of seeds.entries()) jars.setMatrixAt(k, placed(c.x, STORE.rackBoard + c.tier * STORE.tier + CRATE.h / 2, c.z, CRATE.w / 2, CRATE.h, CRATE.w / 2));

  // the stations: a table top on four legs, and a tank on it
  const stations = layout.stations;
  const tops = add(box, standard(PALETTE.bench, 0.5), stations.length);
  const legs = add(box, standard(PALETTE.steel, 0.5, 0.2), 4 * stations.length, false);
  const tanks = add(cylinder, standard(0xf1f4f6, 0.4, 0.1), stations.length);
  for (const [i, s] of stations.entries()) {
    const cx = s.x + s.w / 2;
    const cz = s.z + s.d / 2;
    tops.setMatrixAt(i, placed(cx, STATION.top - FRAME / 2, cz, s.w, FRAME, s.d));
    for (const [k, [dx, dz]] of ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).entries()) legs.setMatrixAt(4 * i + k, placed(cx + dx * (s.w / 2 - FRAME), (STATION.top - FRAME) / 2, cz + dz * (s.d / 2 - FRAME), FRAME, STATION.top - FRAME, FRAME));
    tanks.setMatrixAt(i, placed(cx, STATION.top + STATION.tankHeight / 2, cz, STATION.tankRadius, STATION.tankHeight, STATION.tankRadius));
  }

  // the shelf: a board for each row of slots and a post at each end
  const shelf = layout.shelf;
  if (shelf) {
    const f = shelf.footprint;
    const rows = Math.max(1, Math.ceil(shelf.slots.length / STORE.slotsPerRow));
    const boards = add(box, standard(0xcbd8e2, 0.8), rows, false);
    for (let b = 0; b < rows; b++) boards.setMatrixAt(b, placed(f.x + f.w / 2, STORE.shelfBoard + b * STORE.shelfStep - FRAME / 2, f.z + f.d / 2, f.w, FRAME, f.d));
    const posts = add(box, standard(0x8fa3b5, 0.7), 2, false);
    for (const [k, x] of [f.x + FRAME / 2, f.x + f.w - FRAME / 2].entries()) posts.setMatrixAt(k, placed(x, f.h / 2, f.z + f.d / 2, FRAME, f.h, f.d));
  }

  for (const mesh of group.children as InstancedMesh[]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  // the ids: over each crate and each station
  labels.fixed([
    ...crates.map((c) => ({ text: lots[c.index]?.id ?? "", kind: "crate", x: c.x, y: STORE.rackBoard + c.tier * STORE.tier + CRATE.h + 0.1, z: c.z })),
    ...stations.map((s) => ({ text: plan.equipment?.[s.index]?.id ?? "", kind: "station", x: s.x + s.w / 2, y: s.h + 0.15, z: s.z + s.d / 2 })),
  ]);
  return { group, objects: { lot: crates.length, equipment: stations.length }, disposables };
};

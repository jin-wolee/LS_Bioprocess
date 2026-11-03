import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SphereGeometry } from "three";
import type { BufferGeometry, Material } from "three";
import { PLINTH } from "../dims.ts";
import { PALETTE } from "./floor.ts";

// The reader's figure and the three rings on the floor that go with it (docs/design/plant_ui.md sections 3.2 and 3.4): the mark where a click will walk to, the halo about an object the camera was
// brought to, and the ring about the object whose panel is open. Made once by the scene, which moves them.

/** The figure: a plain operator in a pale coat, with a head. No likeness of any product's character. */
export const buildAvatar = (disposables: (BufferGeometry | Material)[]): Group => {
  const figure = new Group();
  const coat = new MeshStandardMaterial({ color: 0x3d6fa5, roughness: 0.7 });
  const skin = new MeshStandardMaterial({ color: 0xf0c8a6, roughness: 0.8 });
  const body = new CapsuleGeometry(0.21, 0.72, 4, 12);
  const head = new SphereGeometry(0.17, 16, 12);
  disposables.push(coat, skin, body, head);
  const torso = new Mesh(body, coat);
  torso.position.y = 0.58;
  torso.castShadow = true;
  const face = new Mesh(head, skin);
  face.position.y = 1.24;
  face.castShadow = true;
  // a pale clipboard held in front (the figure faces -z), so that the way it faces can be seen
  const board = new BoxGeometry(0.3, 0.26, 0.04);
  const paper = new MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.6 });
  disposables.push(board, paper);
  const clip = new Mesh(board, paper);
  clip.position.set(0, 0.72, -0.25);
  figure.add(torso, face, clip);
  return figure;
};

/** The size of the ring on the floor about a picked object, in metres. */
export const RING = { reactor: 0.85, analyzer: 1.3, staff: 0.5, sample: 0.4, lot: 0.6, equipment: 0.9, confirm: 0.4 } as const;

/** How high the ring lies: 0.05 m above what the object stands on, which for a reactor is the plinth of its bay (a ring on the floor under it would show nothing, P8b). */
export const ringHeight = (kind: keyof typeof RING): number => (kind === "reactor" ? PLINTH : 0) + 0.05;

/** The rings, hidden until the scene places them: `marker` where a click walks to, `halo` about an object the camera was brought to, `ring` about the object the panel shows (it follows the object while it moves). */
export const buildRings = (disposables: (BufferGeometry | Material)[]): { marker: Mesh; halo: Mesh; ring: Mesh } => {
  const marker = new Mesh(new RingGeometry(0.24, 0.32, 28).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.accent }));
  marker.visible = false;
  marker.position.y = 0.03;
  const halo = new Mesh(new RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.accent }));
  halo.visible = false;
  halo.position.y = 0.04;
  const ring = new Mesh(new RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.accent }));
  ring.visible = false;
  disposables.push(marker.geometry, marker.material, halo.geometry, halo.material, ring.geometry, ring.material);
  return { marker, halo, ring };
};

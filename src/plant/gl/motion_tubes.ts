import { BoxGeometry, ConeGeometry, CylinderGeometry, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry } from "three";
import type { BufferGeometry, Group, Material } from "three";
import type { SceneState, TubePhase } from "../scene_at.ts";
import { makePool } from "./pool.ts";

// The tubes that follow the clock (docs/design/plant_ui.md sections 3.2 and 4.3): one tube for each sample on the floor, a carrier under it while it rides, a label glyph by method (handwritten, barcode,
// issued at the draw: each its own shape), a cue above it by phase (an arrowhead while it travels, a disc while it waits, a ring in the analyzer, a cube when it is done), a ring around the tube of a
// second attempt and a band on a diluted one. Shape carries the meaning and colour repeats it.

const TUBE = { radius: 0.1, height: 0.42 };
const CUE_Y = TUBE.height + 0.17; // above the tube's base
const CARRIER = 0.42;
const HELD = 0.32; // metres: how far in front of the operator a tube in the hand is held

export const buildTubeMotion = (capacity: number, group: Group, disposables: (BufferGeometry | Material)[]): ((state: SceneState) => void) => {
  const geometry = <G extends BufferGeometry>(g: G): G => {
    disposables.push(g);
    return g;
  };
  const basic = (color: number): MeshBasicMaterial => {
    const m = new MeshBasicMaterial({ color });
    disposables.push(m);
    return m;
  };
  const standard = (color: number): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ color, roughness: 0.4 });
    disposables.push(m);
    return m;
  };
  const bodies = makePool(geometry(new CylinderGeometry(TUBE.radius, TUBE.radius, TUBE.height, 10)), standard(0xeaf2f7), capacity, { cast: true });
  const carriers = makePool(geometry(new BoxGeometry(CARRIER, 0.06, CARRIER)), standard(0x9fb3c2), capacity);
  const handwritten = makePool(geometry(new BoxGeometry(0.035, 0.22, 0.01)), basic(0x2f4f8f), capacity);
  const barcode = makePool(geometry(new BoxGeometry(0.16, 0.1, 0.01)), basic(0x222222), capacity);
  const issued = makePool(geometry(new BoxGeometry(0.11, 0.11, 0.01)), basic(0xd9a23a), capacity);
  const travel = makePool(geometry(new ConeGeometry(0.1, 0.26, 8).rotateX(-Math.PI / 2)), basic(0x2f6fb0), capacity);
  const waiting = makePool(geometry(new CylinderGeometry(0.13, 0.13, 0.04, 14)), basic(0xd9a23a), capacity);
  const inside = makePool(geometry(new TorusGeometry(0.1, 0.03, 6, 16).rotateX(Math.PI / 2)), basic(0x2e9e5b), capacity);
  const done = makePool(geometry(new BoxGeometry(0.15, 0.15, 0.15)), basic(0x6b7a86), capacity);
  const rerun = makePool(geometry(new TorusGeometry(0.15, 0.025, 6, 16).rotateX(Math.PI / 2)), basic(0xd9372b), capacity);
  const diluted = makePool(geometry(new CylinderGeometry(TUBE.radius + 0.012, TUBE.radius + 0.012, 0.06, 10)), basic(0xe0a02e), capacity);
  const pools = [bodies, carriers, handwritten, barcode, issued, travel, waiting, inside, done, rerun, diluted];
  for (const p of pools) group.add(p.mesh);
  const cue = { hand: travel, transport: travel, wait: waiting, enter: inside, setup: inside, run: inside, leave: done } satisfies Record<TubePhase, ReturnType<typeof makePool>>;
  const glyph = { handwritten, preprinted_barcode: barcode, issued_at_draw: issued } as const;

  return (state) => {
    for (const p of pools) p.begin();
    for (const t of state.tubes) {
      // in the hand the tube is held out toward the vessel (north of the operator), not inside the figure
      const z = t.phase === "hand" ? t.z - HELD : t.z;
      bodies.put(t.x, t.y + TUBE.height / 2, z);
      if (t.phase === "transport") carriers.put(t.x, t.y - 0.03, z, 1, 1, 1, -t.heading);
      const mark = t.label ? glyph[t.label as keyof typeof glyph] : undefined;
      mark?.put(t.x, t.y + TUBE.height * 0.5, z + TUBE.radius + 0.005);
      cue[t.phase].put(t.x, t.y + CUE_Y, z, 1, 1, 1, t.phase === "transport" ? -t.heading : 0);
      if (t.rerun) rerun.put(t.x, t.y + TUBE.height * 0.72, z);
      if (t.diluted) diluted.put(t.x, t.y + TUBE.height * 0.2, z);
    }
    for (const p of pools) p.end();
  };
};

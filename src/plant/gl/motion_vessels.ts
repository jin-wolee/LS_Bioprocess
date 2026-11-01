import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, TorusGeometry } from "three";
import type { BufferGeometry, Group, Material } from "three";
import type { Layout } from "../layout.ts";
import type { SceneState } from "../scene_at.ts";
import type { ScenePlan } from "../../protocol.ts";
import { PALETTE } from "./floor.ts";
import { PLINTH, vesselShape } from "./shapes.ts";
import type { Built } from "./shapes.ts";
import { makePool } from "./pool.ts";

// The reactors that follow the clock (docs/design/plant_ui.md sections 3.2 and 4.3): the lamp on each vessel, the liquid that is there while it runs and gone when it is harvested, the tint of the jacket
// after a temperature shift, the feed line and its operator ring, the alarm and signal beacons, and the tags (stopped, deviation, volume cap). Shape carries the meaning and colour repeats it: a
// harvested vessel is empty, an alarm is a spike and a signal a ball, each tag has its own shape.

const LAMP = { idle: PALETTE.lampIdle, running: PALETTE.lampRunning, harvested: PALETTE.lampEnded, stopped: 0xb5483f } as const;
const LIQUID_LEVEL = 0.78; // of the height of the vessel
const FEED_TOP = 2.8; // metres: where the feed line comes from
const WARM = new Color(0xffc48a);
const PLAIN = new Color(0xffffff);

export const buildVesselMotion = (layout: Layout, plan: ScenePlan, group: Group, jackets: Built["jackets"], disposables: (BufferGeometry | Material)[]): ((state: SceneState) => void) => {
  const n = layout.vessels.length;
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
    const m = new MeshStandardMaterial({ color, roughness: 0.5 });
    disposables.push(m);
    return m;
  };
  const lamps = makePool(geometry(new SphereGeometry(0.09, 10, 8)), basic(0xffffff), n, { colored: true });
  const liquid = makePool(geometry(new CylinderGeometry(1, 1, 1, 18)), standard(0x7fc8c0), n);
  const alarms = makePool(geometry(new ConeGeometry(0.14, 0.5, 8)), basic(0xd9372b), n);
  const signals = makePool(geometry(new SphereGeometry(0.17, 12, 8)), basic(0xe0a02e), n);
  const feeds = makePool(geometry(new BoxGeometry(0.05, 1, 0.05)), basic(0xe0a02e), n);
  const rings = makePool(geometry(new TorusGeometry(1, 0.05, 6, 28).rotateX(Math.PI / 2)), basic(0x2f6fb0), n);
  const stopped = makePool(geometry(new BoxGeometry(0.34, 0.22, 0.03)), basic(0xb5483f), n);
  const deviations = makePool(geometry(new OctahedronGeometry(0.13)), basic(0xe0a02e), n);
  const caps = makePool(geometry(new CylinderGeometry(0.14, 0.14, 0.03, 14).rotateX(Math.PI / 2)), basic(0x6b4fa0), n);
  const pools = [lamps, liquid, alarms, signals, feeds, rings, stopped, deviations, caps];
  for (const p of pools) group.add(p.mesh);

  const shapes = layout.vessels.map((v) => vesselShape((layout.bays[v.bay] as { profile: string }).profile));
  let tinted = plan.units.map(() => false);

  return (state) => {
    for (const p of pools) p.begin();
    for (const [i, v] of layout.vessels.entries()) {
      const s = state.vessels[i];
      const { radius, height } = shapes[i] as { radius: number; height: number };
      if (!s) continue;
      lamps.put(v.x, PLINTH + height * 0.92, v.z + radius + 0.02, 1, 1, 1, 0, LAMP[s.lamp]);
      if (s.lamp === "running" || s.lamp === "stopped") liquid.put(v.x, PLINTH + (height * LIQUID_LEVEL) / 2 + 0.02, v.z, radius * 0.86, height * LIQUID_LEVEL, radius * 0.86);
      if (s.beacon === "alarm") alarms.put(v.x, PLINTH + height + 0.4, v.z);
      else if (s.beacon === "signal") signals.put(v.x, PLINTH + height + 0.35, v.z);
      if (s.feed) {
        const top = PLINTH + height;
        feeds.put(v.x, (top + FEED_TOP) / 2, v.z, 1, FEED_TOP - top, 1);
        if (s.feed.scripted) rings.put(v.x, PLINTH + 0.1, v.z, radius + 0.12, 1, radius + 0.12);
      }
      if (s.lamp === "stopped") stopped.put(v.x - 0.22, PLINTH + height + 0.18, v.z + radius + 0.05);
      if (s.deviation) deviations.put(v.x + 0.26, PLINTH + height * 0.6, v.z + radius + 0.1);
      if (s.capTag) caps.put(v.x, PLINTH + 0.3, v.z + radius + 0.22);
    }
    for (const p of pools) p.end();
    // the jacket: tinted from the temperature shift on
    const now = state.vessels.map((s) => s.shifted);
    for (const [i, j] of jackets.entries()) {
      if (tinted[i] === now[i]) continue;
      j.mesh.setColorAt(j.index, now[i] ? WARM : PLAIN);
      if (j.mesh.instanceColor) j.mesh.instanceColor.needsUpdate = true;
    }
    tinted = now;
  };
};

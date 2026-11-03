import { ConeGeometry, Group, MeshBasicMaterial, TorusGeometry } from "three";
import type { BufferGeometry, Material } from "three";
import { breakoutAt } from "../breakout_at.ts";
import type { BreakoutAt } from "../breakout_at.ts";
import { CRATE, PLINTH, STATION, vesselShape } from "../dims.ts";
import type { Layout } from "../layout.ts";
import { STORE } from "../layout_store.ts";
import { clockOf } from "../view.ts";
import type { BreakoutData } from "../scene_types.ts";
import type { ScenePlan } from "../../protocol.ts";
import type { Labels } from "./labels.ts";
import { fill, label } from "./overlay.ts";
import { makePool } from "./pool.ts";

// The truth overlay of a break-out case (docs/design/plant_ui.md section 3.3, "As built in P7c"): what the simulation knows of the event, drawn only when the reader's switch is on and the Worker has answered
// `{ breakout: true }`. The origin is a downward cone over the item the scenario names (a crate, a station, or a vessel), and each unit the event reached is a flat ring on the floor round its vessel with a
// cone over it, each from its instant (`breakoutAt`). Every element carries a DOM label with the short label "Simulation's view" (the whole sentence "Simulation's own view, not available to any record" is
// said once, by the switch: P8a) and is marked `data-overlay`; `set(null)` takes it all away, the labels' marks and text included. Shape carries the meaning (a cone and a ring, which no other object has) and colour only repeats it.

const INK = 0xa8326b;
const CONE = { radius: 0.28, height: 0.55, rise: 0.8 };
const RING = { pad: 0.4, tube: 0.05 };
const STAGGER = 0.6; // metres: how much higher every other unit's marker stands

export interface BreakoutOverlay {
  set(data: BreakoutData | null): void;
  /** Draws the markers for the clock reading `t` (when the origin or the units reached changed). */
  update(t: number): void;
}

export const buildBreakoutOverlay = (host: HTMLElement, layout: Layout, plan: ScenePlan, group: Group, labels: Labels, disposables: (BufferGeometry | Material)[]): BreakoutOverlay => {
  const units = plan.units.length;
  const material = new MeshBasicMaterial({ color: INK });
  const cone = new ConeGeometry(CONE.radius, CONE.height, 12).rotateX(Math.PI);
  const ring = new TorusGeometry(1, RING.tube, 8, 32).rotateX(Math.PI / 2);
  disposables.push(material, cone, ring);
  const cones = makePool(cone, material, 1 + units);
  const rings = makePool(ring, material, units);
  group.add(cones.mesh, rings.mesh);
  // one label for the origin and one for each unit: made once, filled and shown while the overlay is on
  const tags = labels.items(1 + units, "truth");
  let data: BreakoutData | null = null;
  let seen: string | null = null;

  const top = (at: NonNullable<BreakoutAt["origin"]>): { x: number; z: number; y: number } => {
    if (at.kind === "lot") {
      const c = layout.rack?.crates[at.index];
      return { x: c?.x ?? 0, z: c?.z ?? 0, y: STORE.rackBoard + (c?.tier ?? 0) * STORE.tier + CRATE.h };
    }
    if (at.kind === "equipment") {
      const s = layout.stations[at.index];
      return { x: (s?.x ?? 0) + (s?.w ?? 0) / 2, z: (s?.z ?? 0) + (s?.d ?? 0) / 2, y: STATION.top + STATION.tankHeight };
    }
    const v = layout.vessels[at.index];
    return { x: v?.x ?? 0, z: v?.z ?? 0, y: PLINTH + vesselShape((layout.bays[v?.bay ?? 0] as { profile: string }).profile).height };
  };

  const show = (k: number, text: Node[], place: { x: number; y: number; z: number }): void => {
    const tag = tags[k];
    if (!tag || !data) return;
    const own = document.createElement("small");
    own.className = "plant-overlay-label";
    own.textContent = data.captions.label;
    tag.el.replaceChildren(...text, document.createElement("br"), own);
    tag.el.setAttribute("data-overlay", "");
    tag.set(place);
  };
  const hide = (k: number): void => {
    const tag = tags[k];
    tag?.el.replaceChildren();
    tag?.el.removeAttribute("data-overlay");
    tag?.set(null);
  };
  const clockNode = (t: number): Node => {
    const c = clockOf(t);
    const span = document.createElement("span");
    span.append(...fill((data as BreakoutData).captions.clock, { day: label(String(c.day)), time: label(c.time) }));
    return span;
  };

  const draw = (t: number): void => {
    if (!data) return;
    const at = breakoutAt(plan, data.answer, t);
    const key = JSON.stringify(at);
    if (key === seen) return;
    seen = key;
    cones.begin();
    rings.begin();
    hide(0);
    if (at.origin) {
      const p = top(at.origin);
      cones.put(p.x, p.y + CONE.rise + (at.origin.kind === "unit" ? 0.5 : 0) + CONE.height / 2, p.z);
      show(0, fill(data.captions.origin, { item: label(at.origin.id) }), { x: p.x, y: p.y + CONE.rise + (at.origin.kind === "unit" ? 0.5 : 0) + CONE.height + 0.15, z: p.z });
    }
    for (let k = 0; k < units; k++) {
      const hit = at.reached.find((r) => r.unit === k);
      const v = layout.vessels[k];
      if (!hit || !v) {
        hide(1 + k);
        continue;
      }
      const { radius, height } = vesselShape((layout.bays[v.bay] as { profile: string }).profile);
      rings.put(v.x, 0.06, v.z, radius + RING.pad, 1, radius + RING.pad);
      cones.put(v.x, PLINTH + height + 0.3 + CONE.height / 2, v.z);
      // the markers of neighbouring vessels stand at two heights, so that two short labels side by side do not cover each other
      show(1 + k, fill(data.captions.reached, { unit: label((plan.units[k] as ScenePlan["units"][number]).id), clock: clockNode(hit.onset_s) }), { x: v.x, y: PLINTH + height + 0.3 + CONE.height + 0.15 + (k % 2) * STAGGER, z: v.z });
    }
    cones.end();
    rings.end();
    host.dataset.plantBreakout = JSON.stringify({ origin: at.origin?.id ?? null, reached: at.reached.map((r) => (plan.units[r.unit] as ScenePlan["units"][number]).id) });
  };

  return {
    set(next) {
      data = next;
      seen = null;
      if (next === null) {
        for (let k = 0; k <= units; k++) hide(k);
        cones.begin();
        rings.begin();
        cones.end();
        rings.end();
        delete host.dataset.plantBreakout;
      }
    },
    update: draw,
  };
};

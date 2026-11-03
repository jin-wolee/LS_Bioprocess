import type { ScenePlan } from "../protocol.ts";
import { HELD, PLINTH, BENCH_TOP, analyzerShape, vesselShape } from "./dims.ts";
import type { Layout } from "./layout.ts";
import { itemTargets } from "./pick_items.ts";
import type { SceneState } from "./scene_at.ts";
import type { Picked } from "./view.ts";

// Picking in the scene (docs/design/plant_ui.md sections 3.2 and 3.4): a click picks the nearest object along the ray among the vessels, the analyzers, the staff on duty and the tubes (the cards are
// the arithmetic of P5a, on the front face of a hall, and come in as hits of their own). Pure geometry on plain numbers: no three.js, so Vitest runs it without WebGL, and the nearest object is
// decided by the distance along the ray, never by the order the boxes are listed in. A box is axis-aligned, as everything on the floor is.

export type Vec = [number, number, number];
export interface Ray {
  origin: Vec;
  dir: Vec;
}
export interface Box {
  min: Vec;
  max: Vec;
}
export interface Target<T> {
  what: T;
  box: Box;
}
export interface Hit<T> {
  what: T;
  /** The distance along the ray, in units of its direction. */
  t: number;
}

/** The distance along the ray at which it enters the box (0 when it starts inside), or null when it misses or the box is behind it. */
export const rayBox = (ray: Ray, box: Box): number | null => {
  let enter = 0;
  let leave = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const o = ray.origin[k] as number;
    const d = ray.dir[k] as number;
    const lo = box.min[k] as number;
    const hi = box.max[k] as number;
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave ? enter : null;
};

/** The nearest of the boxes the ray meets and of the other hits (a card, from the shelves), or null. */
export const pickNearest = <T>(ray: Ray, targets: readonly Target<T>[], others: readonly Hit<T>[] = []): Hit<T> | null => {
  let best: Hit<T> | null = null;
  for (const hit of [...targets.map((x) => ({ what: x.what, t: rayBox(ray, x.box) })), ...others]) {
    if (hit.t !== null && (best === null || hit.t < best.t)) best = { what: hit.what, t: hit.t };
  }
  return best;
};

// What a click can reach, in metres. A figure is a 0.6 m square and 1.5 m tall about its feet; a tube, which is 0.2 m across, is picked from a 0.6 m square box from just under its base to 0.8 m over it
// (the cue above the tube included), so that it can be hit on a screen that shows the whole floor.
const FIGURE = { half: 0.3, height: 1.5 };
const TUBE = { half: 0.3, below: 0.05, above: 0.8 };

/** The boxes of the things a click can pick at the instant of `state`: the vessels and analyzers where the layout puts them, the staff on duty where they stand, the tubes on the floor where they are drawn. */
export const targetsAt = (plan: ScenePlan, layout: Layout, state: SceneState): Target<Picked>[] => {
  const out: Target<Picked>[] = [];
  for (const v of layout.vessels) {
    const { radius, height } = vesselShape((layout.bays[v.bay] as { profile: string }).profile);
    out.push({ what: { kind: "reactor", index: v.unit }, box: { min: [v.x - radius, 0, v.z - radius], max: [v.x + radius, PLINTH + height, v.z + radius] } });
  }
  for (const a of layout.analyzers) {
    const [w, h, d] = analyzerShape(a.profile);
    out.push({ what: { kind: "analyzer", index: a.index }, box: { min: [a.x - w / 2, BENCH_TOP, a.z - d / 2], max: [a.x + w / 2, BENCH_TOP + h, a.z + d / 2] } });
  }
  for (const [i, s] of state.staff.entries()) {
    if (s.on_duty) out.push({ what: { kind: "staff", index: i }, box: { min: [s.x - FIGURE.half, 0, s.z - FIGURE.half], max: [s.x + FIGURE.half, FIGURE.height, s.z + FIGURE.half] } });
  }
  for (const t of state.tubes) {
    const z = t.phase === "hand" ? t.z - HELD : t.z;
    out.push({ what: { kind: "sample", index: t.sample }, box: { min: [t.x - TUBE.half, t.y - TUBE.below, z - TUBE.half], max: [t.x + TUBE.half, t.y + TUBE.above, z + TUBE.half] } });
  }
  // a break-out case: the crates, the stations and the confirming tubes on the shelf (P7c)
  if (plan.lots !== undefined) out.push(...itemTargets(plan, layout, state.t));
  return out;
};

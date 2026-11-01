import { Plane, Vector3 } from "three";
import type { Ray } from "three";
import { hallsAt, hallsEpoch } from "../halls_at.ts";
import type { HallView } from "../halls_at.ts";
import { placeAt } from "../hall_shelves.ts";
import type { Layout } from "../layout.ts";
import type { ScenePlan } from "../../protocol.ts";
import type { Labels } from "./labels.ts";
import type { Motion } from "./motion.ts";

// The record halls of the scene (docs/design/plant_ui.md section 3.3): which halls have arrived, the hall the lens reads, the cards on the shelves at the clock instant, and which card a ray from the
// camera meets. The shelves are drawn again only when the record wrote something since the last frame (a new epoch of `hallsEpoch`), a hall arrived or the lens moved. The scene calls `update` once for
// each frame, `pick` for a click, and `setHalls` and `setLens` when the page says so; the page's attributes `data-plant-lens` and `data-plant-cards` are written here.

export interface PickedCard {
  architecture: string;
  /** The index into the plan's `samples`. */
  sample: number;
  /** The distance along the ray to the face of the hall the card is on: the scene compares it with the distance to the other things a click can reach. */
  distance: number;
}

export interface Shelves {
  /** Draws the shelves for the clock reading `t` when something on them changed. */
  update(t: number): void;
  setHalls(records: ScenePlan["records"]): void;
  setLens(architecture: string): void;
  /** The card the ray meets first on the front face of a hall: the nearest face it crosses inside the shelves, at a place that holds a card at the instant last drawn; null when it meets none. */
  pick(ray: Ray): PickedCard | null;
}

export const buildShelves = (host: HTMLElement, layout: Layout, plan: ScenePlan, motion: Motion, labels: Labels, initialLens: string): Shelves => {
  let shown: ScenePlan = plan;
  let lens = initialLens;
  let drawn = -1; // the epoch of the shelves that were drawn last
  let dirty = true;
  let views: HallView[] = [];
  const hit = new Vector3();
  host.dataset.plantLens = lens;
  labels.halls(plan.records, lens);

  return {
    update(t) {
      const epoch = hallsEpoch(shown, t);
      if (epoch === drawn && !dirty) return;
      drawn = epoch;
      dirty = false;
      views = hallsAt(shown, t);
      motion.halls(views, lens);
      const counts = JSON.stringify(Object.fromEntries(views.map((v) => [v.architecture, { shown: v.shown, knowable: v.knowable }])));
      if (host.dataset.plantCards !== counts) host.dataset.plantCards = counts;
    },
    setHalls(records) {
      shown = { ...plan, records: [...records] };
      labels.halls(records, lens);
      dirty = true;
    },
    setLens(architecture) {
      lens = architecture;
      host.dataset.plantLens = lens;
      labels.halls(shown.records, lens);
      dirty = true;
    },
    pick(ray) {
      let nearest = Number.POSITIVE_INFINITY;
      let picked: PickedCard | null = null;
      for (const h of layout.halls) {
        const f = h.footprint;
        if (!ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -(f.z + f.d)), hit)) continue;
        const view = views.find((v) => v.architecture === h.architecture);
        const place = view ? placeAt(f, view.total, hit.x, hit.y) : null;
        const card = place === null ? undefined : view?.cards[place];
        const distance = ray.origin.distanceTo(hit);
        if (card && distance < nearest) {
          nearest = distance;
          picked = { architecture: h.architecture, sample: card.sample, distance };
        }
      }
      return picked;
    },
  };
};

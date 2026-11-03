import type { BufferGeometry, Group, Material, Scene as ThreeScene } from "three";
import type { ScenePlan } from "../../protocol.ts";
import { itemsAt, itemsCounts } from "../items_at.ts";
import type { Layout } from "../layout.ts";
import type { BreakoutData } from "../scene_types.ts";
import type { Labels } from "./labels.ts";
import { buildItemsMotion } from "./motion_items.ts";
import { buildBreakoutOverlay } from "./overlay_breakout.ts";
import { buildStore } from "./store.ts";

// The break-out part of the scene (docs/design/plant_ui.md sections 3.2 and 3.3, "As built in P7c"), built only for a plan of a case: the store (the rack, the stations and the shelf), the items that follow
// the clock (links, tape, confirming tubes and their stamps) and the truth overlay of the event. `plant_scene.ts` calls `update` for each new clock reading and writes `data-plant-items`; a plan that is not a
// case builds none of it, so the draw calls and the host of every other run are what they were.

export interface Items {
  /** What was built, by kind: the lots, the stations and the confirming tubes the shelf can show. */
  objects: { lot: number; equipment: number; confirm: number };
  /** Draws the items for the clock reading `t`; written again only when the reading, the lens, the halls, the words or the overlay changed. */
  update(t: number): void;
  /** The halls that have arrived: the tape of a hall is its own holds, and a hall's holds come with it. */
  setHalls(records: ScenePlan["records"]): void;
  setLens(architecture: string): void;
  setWords(words: { detected: string; not_detected: string }): void;
  setBreakout(data: BreakoutData | null): void;
}

export const buildItems = (host: HTMLElement, layout: Layout, plan: ScenePlan, scene: ThreeScene, labels: Labels, lens: string, disposables: (BufferGeometry | Material)[]): Items | null => {
  if (plan.lots === undefined) return null;
  const store = buildStore(layout, plan, labels);
  disposables.push(...store.disposables);
  const group: Group = store.group;
  scene.add(group);
  const motion = buildItemsMotion(layout, plan, group, labels, disposables);
  const overlay = buildBreakoutOverlay(host, layout, plan, group, labels, disposables);
  let reading = lens;
  let current = plan;
  let counts = "";
  let drawn = Number.NaN;
  let dirty = true;
  return {
    objects: { ...store.objects, confirm: itemsAt(plan, Number.POSITIVE_INFINITY, "").shelf.length },
    update(t) {
      overlay.update(t);
      if (t === drawn && !dirty) return;
      drawn = t;
      dirty = false;
      const state = itemsAt(current, t, reading);
      motion.update(state);
      const written = JSON.stringify(itemsCounts(state));
      if (written !== counts) {
        counts = written;
        host.dataset.plantItems = written;
      }
    },
    setHalls(records) {
      current = { ...plan, records };
      dirty = true;
    },
    setLens(architecture) {
      reading = architecture;
      dirty = true;
    },
    setWords(words) {
      motion.setWords(words);
      dirty = true;
    },
    setBreakout(data) {
      overlay.set(data);
    },
  };
};

import type { ScenePlan } from "../protocol.ts";
import { CRATE } from "./dims.ts";
import { itemsAt, slotOfSample } from "./items_at.ts";
import type { Layout, Point } from "./layout.ts";
import { STORE } from "./layout_store.ts";
import type { Target } from "./pick.ts";
import type { Picked } from "./view.ts";

// What a click can reach in the store of a break-out case (docs/design/plant_ui.md section 3.2, "As built in P7c"): the crates of the rack, the stations and the confirming tubes on the shelf at the clock
// instant. Pure geometry on plain numbers, from the layout and the plan; the boxes are the sizes of dims.ts and layout_store.ts, so what is drawn and what is picked cannot disagree.

const TUBE = { half: 0.2, below: 0.05, above: 0.8 };

/** Where a picked lot, equipment item or confirming sample stands on the floor (the middle of its crate, its station or its slot), or null for any other pick or an item with no place. */
export const itemPoint = (plan: ScenePlan, layout: Layout, p: Picked): Point | null => {
  if (p.kind === "lot") return layout.rack?.crates[p.index] ?? null;
  if (p.kind === "equipment") {
    const s = layout.stations[p.index];
    return s ? { x: s.x + s.w / 2, z: s.z + s.d / 2 } : null;
  }
  if (p.kind === "confirm") {
    const slot = slotOfSample(plan, p.index);
    return (slot === null ? undefined : layout.shelf?.slots[slot]) ?? null;
  }
  return null;
};

export const itemTargets = (plan: ScenePlan, layout: Layout, t: number): Target<Picked>[] => {
  const out: Target<Picked>[] = [];
  for (const c of layout.rack?.crates ?? []) {
    const base = STORE.rackBoard + c.tier * STORE.tier;
    out.push({ what: { kind: "lot", index: c.index }, box: { min: [c.x - CRATE.w / 2, base, c.z - CRATE.w / 2], max: [c.x + CRATE.w / 2, base + CRATE.h, c.z + CRATE.w / 2] } });
  }
  for (const s of layout.stations) out.push({ what: { kind: "equipment", index: s.index }, box: { min: [s.x, 0, s.z], max: [s.x + s.w, s.h, s.z + s.d] } });
  for (const tube of itemsAt(plan, t, "").shelf) {
    const slot = layout.shelf?.slots[tube.slot];
    if (!slot) continue;
    const base = STORE.shelfBoard + slot.board * STORE.shelfStep;
    out.push({ what: { kind: "confirm", index: tube.sample }, box: { min: [slot.x - TUBE.half, base - TUBE.below, slot.z - TUBE.half], max: [slot.x + TUBE.half, base + TUBE.above, slot.z + TUBE.half] } });
  }
  return out;
};

import type { ScenePlan } from "../protocol.ts";
import { boardPoint } from "./dims.ts";
import { flagsFocus } from "./flags_board.ts";
import type { Layout, Point } from "./layout.ts";
import { pickedOfKey } from "./view.ts";
import type { Picked } from "./view.ts";

// Where the camera is brought to for an object named by its key (docs/design/plant_ui.md section 3.4): the point, how close the camera comes, and, for a hall, the level pitch that shows the cards.
// A function of the plan and the layout, with the position of the things that move passed in, so it needs neither three.js nor the clock.

/** The point the camera looks at, the radius of the halo about it (the camera stands about five times as far) and, for a hall, the pitch of the view. */
export interface FocusTarget {
  at: Point;
  radius: number;
  pitch?: number;
}

/** `where` is the position, at the clock reading last drawn, of a picked thing that moves (an operator on duty, a tube on the floor), or null. */
export const focusOf = (plan: ScenePlan, layout: Layout, key: string, where: (p: Picked) => Point | null): FocusTarget | null => {
  const [kind, id] = key.split(":", 2);
  if (kind === "staff" || kind === "sample") {
    // a thing that moves: where it stands at the clock reading last drawn
    const found = pickedOfKey(plan, key);
    const at = found === null ? null : where(found);
    return at ? { at, radius: kind === "staff" ? 0.9 : 0.7 } : null;
  }
  if (kind === "reactor") {
    const v = layout.vessels[plan.units.findIndex((u) => u.id === id)];
    return v ? { at: v, radius: 0.9 } : null;
  }
  if (kind === "analyzer") {
    const a = layout.analyzers[plan.analyzers.findIndex((x) => x.id === id)];
    return a ? { at: a, radius: 1.4 } : null;
  }
  if (kind === "board") {
    // the board of a bay stands at the west end of its north edge (dims.ts); `id` is `B1`, `B2` ...
    const bay = layout.bays[Number(id?.slice(1)) - 1];
    return bay ? { at: boardPoint(bay.footprint), radius: 1.2 } : null;
  }
  if (kind === "flags") {
    // the panel hangs on the north wall behind the halls: a high pitch sees over them to its lower rows
    return { at: flagsFocus(layout.width, plan.layout.architectures.length), radius: 1.8, pitch: 0.65 };
  }
  if (kind === "hall") {
    // close to the shelves and level with them: the cards are a few centimetres wide
    const h = layout.halls.find((x) => x.architecture === id);
    return h ? { at: { x: h.footprint.x + h.footprint.w / 2, z: h.footprint.z + h.footprint.d / 2 }, radius: 1.2, pitch: 0.2 } : null;
  }
  return null;
};

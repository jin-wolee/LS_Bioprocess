import type { ScenePlan } from "../protocol.ts";
import { DAY } from "./clock.ts";

// The sampling board of each bay (docs/design/plant_ui.md section 3.2, "As built in P6a"): the day's plan, the samples planned for the day of the clock instant that are not drawn yet at it. A pure
// function of the plan and the instant, with no clock of its own and no three.js. The board is the target of `move_draw`; which of its rows the Worker will let the reader move is the Worker's to say
// (a row whose planned instant has passed is still listed until it is drawn).

export interface BoardRow {
  /** The index into the plan's `samples`. */
  sample: number;
  id: string;
  /** The unit's id, as the plan names it. */
  unit: string;
  planned_s: number;
}

export interface Board {
  /** `B1`, `B2` ...: the board of the bay, in the order of the layout. */
  id: string;
  /** The index of the bay in the layout. */
  bay: number;
  rows: BoardRow[];
}

/** The id of the board of a bay. */
export const boardId = (bay: number): string => `B${bay + 1}`;

export const boardsAt = (plan: ScenePlan, t: number): Board[] => {
  const day = Math.floor(t / DAY);
  const boards: Board[] = plan.layout.bays.map((_, bay) => ({ id: boardId(bay), bay, rows: [] }));
  for (const [sample, s] of plan.samples.entries()) {
    if (Math.floor(s.planned_s / DAY) !== day || (s.drawn_s !== null && s.drawn_s <= t)) continue;
    const unit = plan.units[s.unit];
    boards[(unit?.bay ?? 1) - 1]?.rows.push({ sample, id: s.id, unit: unit?.id ?? "", planned_s: s.planned_s });
  }
  for (const b of boards) b.rows.sort((x, y) => x.planned_s - y.planned_s || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return boards;
};

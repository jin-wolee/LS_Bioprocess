import { boardsAt } from "../board.ts";
import { clockOf } from "../view.ts";
import type { ScenePlan } from "../../protocol.ts";
import type { Labels } from "./labels.ts";

// The rows on the sampling boards of the scene (docs/design/plant_ui.md section 3.2, "As built in P6a"): the plates and the posts are built with the other things (shapes.ts); the rows are labels on the sign
// of each board, written from `boardsAt` at the clock reading, and written again only when the minute changes (a row leaves the board at its draw, to the second, but a sign is read by the minute).

/** The rows shown on a sign before "+n": the first few of the day's plan. */
const SHOWN = 4;

export const buildBoards = (plan: ScenePlan, labels: Labels): { update(t: number): void } => {
  let minute = Number.NaN;
  return {
    update(t) {
      const m = Math.floor(t / 60);
      if (m === minute) return;
      minute = m;
      labels.boards(boardsAt(plan, t).map((b) => ({ rows: b.rows.slice(0, SHOWN).map((r) => `${r.unit} ${clockOf(r.planned_s).time}`), more: Math.max(0, b.rows.length - SHOWN) })));
    },
  };
};

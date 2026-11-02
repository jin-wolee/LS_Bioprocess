import { Label, T } from "../ui/T.tsx";
import type { ScenePlan } from "../protocol.ts";
import { boardsAt } from "./board.ts";
import type { Board, BoardRow } from "./board.ts";
import { clockOf } from "./view.ts";

// The sampling boards as DOM (docs/design/plant_ui.md section 3.2, "As built in P6a"): the rows to pick from in the form of `move_draw`, and the table of the text alternative. Both read `boardsAt`, so
// they say what the board in the scene says at the same clock instant. Every id and clock reading is a label.

const timeOf = (row: BoardRow): string => clockOf(row.planned_s).time;

/** The rows of the boards of the run, one group for each bay, the board asked for first; a row is a button and the picked one is pressed. */
export function BoardRows({ boards, sample, first, onPick }: { boards: readonly Board[]; sample: string | undefined; first: number | null; onPick: (row: BoardRow) => void }) {
  const ordered = first === null ? boards : [...boards.filter((b) => b.bay === first), ...boards.filter((b) => b.bay !== first)];
  if (boards.every((b) => b.rows.length === 0)) return <T as="p" k="plant.act.board.none" data-note="board-none" />;
  return (
    <div class="plant-board-rows" data-board-rows>
      {ordered
        .filter((b) => b.rows.length > 0)
        .map((b) => (
          <section key={b.id} data-board={b.id}>
            <T as="h4" k="plant.act.board.bay" parts={{ board: <Label>{b.id}</Label> }} />
            <ul class="plant-object-list">
              {b.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" aria-pressed={sample === r.id} data-board-row={r.id} onClick={() => onPick(r)}>
                    <T k="plant.act.board.row" parts={{ sample: <Label>{r.id}</Label>, unit: <Label>{r.unit}</Label>, planned: <Label>{timeOf(r)}</Label> }} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

/** The boards as a table of the text alternative: a row for each sample on a board at the instant. */
export function BoardTable({ plan, at }: { plan: ScenePlan; at: number }) {
  return (
    <div class="plant-table-wrap">
      <table class="plant-table" data-plant-table="boards">
        <T as="caption" k="plant.table.boards" />
        <thead>
          <tr>
            <T as="th" k="plant.col.board" />
            <T as="th" k="plant.col.sample" />
            <T as="th" k="plant.col.reactor" />
            <T as="th" k="plant.col.planned" />
          </tr>
        </thead>
        <tbody>
          {boardsAt(plan, at).flatMap((b) =>
            b.rows.map((r) => (
              <tr key={r.id} data-object-row={`board:${b.id}`}>
                <td>
                  <Label>{b.id}</Label>
                </td>
                <td>
                  <Label>{r.id}</Label>
                </td>
                <td>
                  <Label>{r.unit}</Label>
                </td>
                <td>
                  <Label>{timeOf(r)}</Label>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

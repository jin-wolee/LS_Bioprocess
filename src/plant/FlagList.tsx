import { text } from "../i18n/index.ts";
import type { Key, Lang } from "../i18n/index.ts";
import { Label, T } from "../ui/T.tsx";
import { stateOf } from "./flags_board.ts";
import type { FlagMatrix } from "./flags_board.ts";

// The flags board as DOM (docs/design/plant_ui.md section 3.2, "As built in P6b"): the matrix with a button for each cell in the objects list, which is the keyboard's way to the `set_flag` form, and the
// matrix as a table of words in the text alternative. Both read `flagMatrix`, so they say what the panel in the scene says. Every flag and hall id is a label; the state of a cell is a word, not colour.

const STATE: Record<"on" | "off" | "pending", Key> = { on: "plant.flags.state.on", off: "plant.flags.state.off", pending: "plant.flags.state.pending" };

/** The matrix with a button for each cell: pressing it asks for the `set_flag` form on that column (the index into the halls of the layout) and that flag. */
export function FlagCells({ matrix, onCell, lang }: { matrix: FlagMatrix; onCell: (hall: number, flag: string) => void; lang: Lang }) {
  return (
    <div class="plant-table-wrap">
      <table class="plant-table" data-flag-matrix>
        <T as="caption" k="plant.flags.cells" />
        <thead>
          <tr>
            <T as="th" k="plant.col.flag" />
            {matrix.halls.map((hall) => (
              <th key={hall} scope="col">
                <Label>{hall}</Label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.flags.map((flag, row) => (
            <tr key={flag}>
              <th scope="row">
                <Label>{flag}</Label>
              </th>
              {matrix.halls.map((hall, col) => {
                const state = stateOf(matrix.cells[row]?.[col] ?? null);
                const next = text(lang, state === "on" ? STATE.off : STATE.on);
                return (
                  <td key={hall}>
                    <button
                      type="button"
                      data-flag-cell={`${hall}:${flag}`}
                      data-flag-state={state}
                      aria-label={text(lang, "plant.flags.cell", { flag, hall, state: text(lang, STATE[state]), next })}
                      onClick={() => onCell(col, flag)}
                    >
                      <T k={STATE[state]} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The matrix as a table of words: the state of each flag in each hall. */
export function FlagsTable({ matrix }: { matrix: FlagMatrix }) {
  return (
    <div class="plant-table-wrap">
      <table class="plant-table" data-plant-table="flags">
        <T as="caption" k="plant.table.flags" />
        <thead>
          <tr>
            <T as="th" k="plant.col.flag" />
            {matrix.halls.map((hall) => (
              <th key={hall} scope="col">
                <Label>{hall}</Label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.flags.map((flag, row) => (
            <tr key={flag}>
              <th scope="row">
                <Label>{flag}</Label>
              </th>
              {matrix.halls.map((hall, col) => {
                const state = stateOf(matrix.cells[row]?.[col] ?? null);
                return (
                  <td key={hall} data-flag-state={state}>
                    <T k={STATE[state]} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

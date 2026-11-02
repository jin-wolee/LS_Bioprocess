import type { ScenePlan } from "../protocol.ts";
import type { Point } from "./layout.ts";

// The flags board (docs/design/plant_ui.md section 3.2, "As built in P6b"): a wall panel with a row for each flag of `ready.flags` and a column for each record hall of the run, each cell on or off as that
// hall's own record has the flag. It is the surface of the `set_flag` action. Pure functions of the plan, on plain numbers, with no three.js, so Vitest runs them without WebGL: the matrix, the
// geometry of the panel in metres, the cell a point on its face lies on, and where the camera is brought to. The constants are view constants, not domain numbers; the look is the author's to adjust.

/** Metres. The panel hangs on the north wall (whose inner face is at z = 0), centred on the floor, its top `top` above the floor; the plate is `thick` deep and its front face is at `z`. */
export const FLAGS_BOARD = { cellW: 0.5, cellH: 0.22, nameW: 2.6, head: 0.32, pad: 0.12, top: 2.95, z: 0.08, thick: 0.06 } as const;

export interface FlagMatrix {
  /** The rows, in the order of `ready.flags`. */
  flags: readonly string[];
  /** The columns, in the order of the layout: the ids the plan gives the halls (a hall a `set_flag` derived is named by its derived id). */
  halls: readonly string[];
  /** `cells[row][col]`: the flag is on in the hall's own record, or off, or null when the record of that hall has not arrived yet (the halls follow `plant_ready`, section 5.5). */
  cells: readonly (readonly (boolean | null)[])[];
}

export const flagMatrix = (plan: ScenePlan, flags: readonly string[]): FlagMatrix => {
  const halls = plan.layout.architectures;
  const recordOf = (hall: string) => plan.records.find((r) => r.architecture === hall);
  return { flags, halls, cells: flags.map((flag) => halls.map((hall) => recordOf(hall)?.flags_on.includes(flag) ?? null)) };
};

export type CellState = "on" | "off" | "pending";
export const stateOf = (cell: boolean | null): CellState => (cell === null ? "pending" : cell ? "on" : "off");

/**
 * The hall the plan shows for a record the run began with: the one at the same place. A `set_flag` names the record of the spec (`c_context`), never the derived id the plan shows it by
 * (`c_context_minus_audit_trail`), because the Worker looks the record up among the architectures of the request; `base` is `spec.run.architectures`.
 */
export const hallOf = (plan: ScenePlan, base: readonly string[], architecture: string): string => plan.layout.architectures[base.indexOf(architecture)] ?? architecture;

export interface FlagsGeometry {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The front face of the plate. */
  z: number;
  /** Where the cells begin: the left edge of the first column and the top of the first row. */
  cellsX0: number;
  cellsTop: number;
  rows: number;
  cols: number;
}

/** The panel for a floor `width` metres wide, `rows` flags and `cols` halls: centred on the floor, names on the left, the ids of the halls in a head over the columns. */
export const flagsGeometry = (width: number, rows: number, cols: number): FlagsGeometry => {
  const b = FLAGS_BOARD;
  const w = b.pad + b.nameW + cols * b.cellW + b.pad;
  const h = b.pad + b.head + rows * b.cellH + b.pad;
  const x0 = width / 2 - w / 2;
  return { x0, x1: x0 + w, y0: b.top - h, y1: b.top, z: b.z, cellsX0: x0 + b.pad + b.nameW, cellsTop: b.top - b.pad - b.head, rows, cols };
};

/** The centre of a cell on the front face. */
export const cellCentre = (g: FlagsGeometry, row: number, col: number): { x: number; y: number } => ({
  x: g.cellsX0 + (col + 0.5) * FLAGS_BOARD.cellW,
  y: g.cellsTop - (row + 0.5) * FLAGS_BOARD.cellH,
});

/** The cell a point of the front face lies on, or null for the names, the head, the margin and anywhere off the panel. */
export const cellAt = (g: FlagsGeometry, x: number, y: number): { row: number; col: number } | null => {
  const col = Math.floor((x - g.cellsX0) / FLAGS_BOARD.cellW);
  const row = Math.floor((g.cellsTop - y) / FLAGS_BOARD.cellH);
  return x >= g.cellsX0 && y <= g.cellsTop && col < g.cols && row < g.rows ? { row, col } : null;
};

/**
 * The floor point the camera is brought to: the middle of the columns of cells, at the wall. The camera looks at it from a high pitch and its line of sight goes on to the front face of the panel at the height of the
 * head (1.3 m, which is 5.5 rows below the first row of cells: the middle of the sixth), so the middle of the view meets a cell of the middle hall, not the names.
 */
export const flagsFocus = (width: number, halls: number): Point => {
  const g = flagsGeometry(width, 0, halls);
  return { x: g.cellsX0 + (halls * FLAGS_BOARD.cellW) / 2, z: FLAGS_BOARD.z };
};

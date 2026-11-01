// Where a card stands on the shelves of its hall (docs/design/plant_ui.md section 3.3). Pure: no three.js, no clock. A hall is a wall of shelves whose front is its south face (the footprint of
// `layoutOf`); a card is laid out for the number of cards the hall holds in the whole run, so its place never changes when another card arrives. Places are numbered from 0 in reading order: along
// the top board from the west end, then the board below. Metres are view constants, not domain numbers.

export const SHELF = {
  /** The boards of a hall: how many, the height of the first (lowest) from the floor, the distance between two, and the thickness of one. */
  rows: 8,
  board0: 0.2,
  step: 0.28,
  thick: 0.04,
  /** The margin at each end of a shelf, and how far a card stands behind the front face of the hall. */
  margin: 0.2,
  inset: 0.12,
  /** A card takes 0.8 of its pitch, is at most 0.053 m wide and 3.4 times its width tall, and at most 0.18 m tall: the top row stays under the 2.4 m of the hall and the pennants fit in the 0.06 m between a card and the board above. */
  fill: 0.8,
  maxWidth: 0.053,
  ratio: 3.4,
  maxHeight: 0.18,
  /** On the face of a card, as shares of its height: a square slot, the gap around the slots, and the bar for the knowable mark at the foot (4 slots, 5 gaps and the bar make 1). */
  slot: 0.18,
  gap: 0.042,
  bar: 0.07,
} as const;

/** The footprint of a hall: its corner of least x and z and its size (a `Rect` of layout.ts without the height). */
export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** The height of the top of board `k` (0 is the lowest) above the floor, where a card stands. */
export const boardTop = (k: number): number => SHELF.board0 + k * SHELF.step + SHELF.thick / 2;

/** How many cards a row holds in a hall that holds `total` in the run. */
export const perRow = (total: number): number => Math.max(1, Math.ceil(total / SHELF.rows));

const pitchOf = (hall: Footprint, total: number): number => (hall.w - 2 * SHELF.margin) / perRow(total);

/** The box of the card at `place`: the centre of its width `x`, the foot `y`, the plane of its face `z`, and its size. */
export interface CardBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}

export const cardBox = (hall: Footprint, total: number, place: number): CardBox => {
  const n = perRow(total);
  const row = Math.floor(place / n);
  const pitch = pitchOf(hall, total);
  const w = Math.min(SHELF.maxWidth, SHELF.fill * pitch);
  return { x: hall.x + SHELF.margin + ((place % n) + 0.5) * pitch, y: boardTop(SHELF.rows - 1 - row), z: hall.z + hall.d - SHELF.inset, w, h: Math.min(SHELF.maxHeight, SHELF.ratio * w) };
};

/**
 * The square slot `k` (0 is the top: unit, sampled_at, context, value) on the face of a card: its centre and its side; the plane is a little in front of the plate. The shader of gl/motion_halls.ts
 * draws these squares from the same shares of the card's height; this is their statement in metres, which the test checks by hand.
 */
export const slotBox = (card: CardBox, k: number): { x: number; y: number; z: number; size: number } => {
  const size = SHELF.slot * card.h;
  const top = card.y + card.h - SHELF.gap * card.h - size / 2;
  return { x: card.x, y: top - k * (size + SHELF.gap * card.h), z: card.z + 0.004, size };
};

/** The place whose cell holds the point (x, y) of the front face of a hall, or null: off the shelves, or in a column that no card fills. */
export const placeAt = (hall: Footprint, total: number, x: number, y: number): number | null => {
  const n = perRow(total);
  const col = Math.floor((x - hall.x - SHELF.margin) / pitchOf(hall, total));
  const k = Math.floor((y - boardTop(0)) / SHELF.step);
  if (col < 0 || col >= n || k < 0 || k >= SHELF.rows) return null;
  const place = (SHELF.rows - 1 - k) * n + col;
  return place < total ? place : null;
};

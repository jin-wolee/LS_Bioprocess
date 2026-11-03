import type { Point, Rect } from "./layout.ts";

// The store band of a break-out scene (docs/design/plant_ui.md section 3.1, "As built in P7c"): the lot rack, the confirmation shelf and the equipment stations, in a band of their own between the last row
// of bays and the bench. Pure: the width the three need, and the places they take for a given left edge and top of the band. Everything here depends on the ids of the lots and equipment items (how many,
// in what order) and on the number of vessels, and on nothing else: the layout cannot know which item is contaminated.

/** The metres of the store band; every position of `layout_store.test.ts` is hand arithmetic on them. */
export const STORE = {
  /** The depth of the band, and the distance between the pieces in it. */
  depth: 1.2,
  gap: 1,
  /** The rack: the pitch of two crates, the margin at each end, the crates in a row before the next tier, the height of a tier, the height of the board the first tier stands on. */
  cratePitch: 0.9,
  rackPad: 0.2,
  crateRow: 12,
  tier: 0.5,
  rackBoard: 0.5,
  rackDepth: 1,
  /** The shelf: the pitch of two slots, the margin, the slots in a row (a row is a board of the shelf), how many slots a vessel is given, the height of the first board and the step between boards. */
  slotPitch: 0.4,
  shelfPad: 0.2,
  slotsPerRow: 6,
  slotsPerVessel: 2,
  shelfBoard: 0.8,
  shelfStep: 0.45,
  shelfDepth: 0.8,
  /** A station: its width, its depth and the pitch of two. */
  stationWidth: 1.4,
  stationDepth: 1,
  stationPitch: 1.8,
  stationHeight: 1.5,
} as const;

/** A crate of the rack: the centre of its footprint, its lot (an index into `items.lots`) and the tier it stands on (0 is the first). */
export interface Crate extends Point {
  index: number;
  tier: number;
}
/** A slot of the confirmation shelf: the centre, its rank, and the board (0 is the lowest). */
export interface Slot extends Point {
  index: number;
  board: number;
}
export interface Station extends Rect {
  index: number;
}

export interface Store {
  rack: { footprint: Rect; crates: Crate[] } | null;
  shelf: { footprint: Rect; slots: Slot[] } | null;
  stations: Station[];
}

/** The slots of the shelf: two for each vessel, the most a unit can draw (a `<unit>-CONF` and a `<unit>-SIG-CONF`). */
export const slotCount = (vessels: number): number => STORE.slotsPerVessel * vessels;

const rackWidth = (lots: number): number => (lots === 0 ? 0 : Math.min(lots, STORE.crateRow) * STORE.cratePitch + 2 * STORE.rackPad);
const shelfWidth = (): number => STORE.slotsPerRow * STORE.slotPitch + 2 * STORE.shelfPad;
const stationsWidth = (n: number): number => (n === 0 ? 0 : n * STORE.stationPitch - (STORE.stationPitch - STORE.stationWidth));

/** The widths of the pieces that are there, in the order they stand from the west. */
const widths = (items: { lots: readonly string[]; equipment: readonly string[] }): number[] => [rackWidth(items.lots.length), shelfWidth(), stationsWidth(items.equipment.length)].filter((w) => w > 0);

/** The width the band needs: the pieces and the gaps between them. */
export const storeWidth = (items: { lots: readonly string[]; equipment: readonly string[] }): number => {
  const w = widths(items);
  return w.reduce((a, b) => a + b, 0) + STORE.gap * (w.length - 1);
};

/** The places of the pieces for a band whose pieces start at `x0` (the west edge of the first) and whose top is `top`. */
export const storeOf = (items: { lots: readonly string[]; equipment: readonly string[] }, vessels: number, x0: number, top: number): Store => {
  const s = STORE;
  const z = top + s.depth / 2;
  let x = x0;
  let rack: Store["rack"] = null;
  if (items.lots.length > 0) {
    const w = rackWidth(items.lots.length);
    const tiers = Math.ceil(items.lots.length / s.crateRow);
    const crates = items.lots.map((_, index): Crate => ({ index, tier: Math.floor(index / s.crateRow), x: x + s.rackPad + ((index % s.crateRow) + 0.5) * s.cratePitch, z }));
    rack = { footprint: { x, z: z - s.rackDepth / 2, w, d: s.rackDepth, h: s.rackBoard + tiers * s.tier }, crates };
    x += w + s.gap;
  }
  const slots = Array.from({ length: slotCount(vessels) }, (_, index): Slot => ({ index, board: Math.floor(index / s.slotsPerRow), x: x + s.shelfPad + ((index % s.slotsPerRow) + 0.5) * s.slotPitch, z }));
  const boards = Math.max(1, Math.ceil(slots.length / s.slotsPerRow));
  const shelf = { footprint: { x, z: z - s.shelfDepth / 2, w: shelfWidth(), d: s.shelfDepth, h: s.shelfBoard + boards * s.shelfStep }, slots };
  x += shelfWidth() + s.gap;
  const stations = items.equipment.map((_, index): Station => ({ index, x: x + index * s.stationPitch, z: z - s.stationDepth / 2, w: s.stationWidth, d: s.stationDepth, h: s.stationHeight }));
  return { rack, shelf, stations };
};

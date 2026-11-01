import type { ScenePlan, TruthPlaceholder } from "../protocol.ts";
import { SHELF } from "./hall_shelves.ts";
import type { Footprint } from "./hall_shelves.ts";

// Where the placeholders of the truth overlay stand (docs/design/plant_ui.md section 3.3, "As built in P5b"). A placeholder is a row the plant produced that a record does not hold; it is drawn only
// when the reader asks for the simulation's own view, never takes the place of a card (a card never moves), and so stands on a rail on top of the hall's wall: a row of tags in order of the instant
// the plant produced the row (the draw, `drawn_s` of the plan's sample), then by sample. The rail is laid out for the placeholders the hall has in the whole run, as the shelves are for the cards, so
// a tag never moves when another appears. Pure: no three.js, no clock. Metres are view constants, not domain numbers.

export const RAIL = {
  /** The height of a tag, and the gap between the top of the wall and its foot. */
  height: 0.25,
  gap: 0.05,
  /** A tag is 0.8 of its pitch wide, at most 0.14 m, and the pitch is at most 0.18 m. */
  fill: 0.8,
  maxWidth: 0.14,
  maxPitch: 0.18,
  /** The margin at each end of the rail, as the shelves have. */
  margin: SHELF.margin,
} as const;

export interface HallBox extends Footprint {
  /** The height of the wall. */
  h: number;
}

/** The box of the tag at `place` on the rail of a hall that has `total` tags: the centre of its width `x`, its foot `y`, the plane of its face `z` (that of the cards), and its size. */
export const tagBox = (hall: HallBox, total: number, place: number): { x: number; y: number; z: number; w: number; h: number } => {
  const pitch = Math.min(RAIL.maxPitch, (hall.w - 2 * RAIL.margin) / Math.max(1, total));
  return { x: hall.x + RAIL.margin + (place + 0.5) * pitch, y: hall.h + RAIL.gap, z: hall.z + hall.d - SHELF.inset, w: Math.min(RAIL.maxWidth, RAIL.fill * pitch), h: RAIL.height };
};

export interface RailTag {
  /** The place on the rail, 0 for the first in the order of the instants. Fixed for the run. */
  place: number;
  /** The index into the plan's `samples`. */
  sample: number;
  why: TruthPlaceholder["why"];
}

export interface RailView {
  architecture: string;
  /** The tags the hall has in the whole run: the rail is laid out for this many. */
  total: number;
  /** The tags present at the instant, in the order of their place. */
  shown: RailTag[];
}

const drawn = (plan: ScenePlan, sample: number): number => (plan.samples[sample] as ScenePlan["samples"][number]).drawn_s ?? Number.POSITIVE_INFINITY;

/** The rail of each hall of the answer at the instant `t`: the placeholders whose draw is not later than `t`, each at the place its rank by (draw, sample) gives it among all of the hall's. */
export const railsAt = (plan: ScenePlan, halls: readonly { architecture: string; placeholders: readonly TruthPlaceholder[] }[], t: number): RailView[] =>
  halls.map((h) => {
    const ordered = [...h.placeholders].sort((a, b) => drawn(plan, a.sample) - drawn(plan, b.sample) || a.sample - b.sample);
    return {
      architecture: h.architecture,
      total: ordered.length,
      shown: ordered.flatMap((p, place): RailTag[] => (drawn(plan, p.sample) <= t ? [{ place, sample: p.sample, why: p.why }] : [])),
    };
  });

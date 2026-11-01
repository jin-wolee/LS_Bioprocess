import type { CardView } from "./halls_at.ts";

// What the scene draws on a card (docs/design/plant_ui.md section 3.3), as the four numbers that go to the graphics card for each card. Pure: no three.js. The card itself is one instance of a quad with a
// small shader (gl/motion_halls.ts), because a card made of a plate, four slots, a bar, pennants and sheets as instances of their own cost the software renderer of the headless QA about 16 ms of
// frame time for each thousand instances; this is what the shader is told. A pennant is counted for each finding raised and a sheet for each version behind the card, up to `MAX_DRAWN` of each.

export const MAX_DRAWN = 4;

export interface CardLook {
  /** A bit for each slot, the unit first (bit 0 the unit, 1 sampled_at, 2 the context, 3 the value), set where the record stores the field. */
  stored: number;
  /** 1 where the result is knowable, else 0. */
  knowable: number;
  /** The sheets behind the card. */
  stack: number;
  /** The pennants on its top edge. */
  pennants: number;
}

export const lookOf = (c: CardView): CardLook => ({
  stored: c.slots.reduce((bits, s, k) => bits | (s.stored ? 1 << k : 0), 0),
  knowable: c.knowable ? 1 : 0,
  stack: Math.min(MAX_DRAWN, c.stack),
  pennants: Math.min(MAX_DRAWN, c.pennants.length),
});

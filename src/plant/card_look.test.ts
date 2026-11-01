import { describe, expect, it } from "vitest";
import { MAX_DRAWN, lookOf } from "./card_look.ts";
import type { CardView } from "./halls_at.ts";

// P5a (docs/design/plant_ui.md section 3.3): what the scene draws on a card, as four numbers that go to the graphics card for each card. `stored` is a bit for each slot, the unit first: bit 0 the unit,
// bit 1 sampled_at, bit 2 the context, bit 3 the value, set when the record stores the field. A card that has no sampled_at stored (A) is 1 + 4 + 8 = 13; one that stores all four is 15; one that
// stores nothing is 0. `knowable` is 1 or 0, and the version stack and the pennants are counted up to MAX_DRAWN. Expected values are typed by hand.

const slots = (stored: boolean[]): CardView["slots"] => (["unit", "sampled_at", "context", "value"] as const).map((name, k) => ({ name, stored: stored[k] as boolean }));
const card = (stored: boolean[], extra: Partial<CardView> = {}): CardView => ({ sample: 0, place: 0, slots: slots(stored), knowable: false, pennants: [], stack: 0, ...extra });

describe("What the scene draws on a card", () => {
  it("Given the slots of A (sampled_at not stored) Then the bits are 1, 4 and 8: 13", () => {
    expect(lookOf(card([true, false, true, true])).stored).toBe(13);
  });

  it("Given every slot stored Then 15, and given none Then 0", () => {
    expect(lookOf(card([true, true, true, true])).stored).toBe(15);
    expect(lookOf(card([false, false, false, false])).stored).toBe(0);
  });

  it("Given each slot alone Then its own bit: the unit 1, sampled_at 2, the context 4, the value 8", () => {
    expect([0, 1, 2, 3].map((k) => lookOf(card([0, 1, 2, 3].map((j) => j === k))).stored)).toEqual([1, 2, 4, 8]);
  });

  it("Given a card that is knowable, with two pennants and a stack of one Then 1, 2 and 1; given none of them Then 0, 0 and 0", () => {
    const look = lookOf(card([true, true, true, true], { knowable: true, pennants: ["VR-010", "VR-012"], stack: 1 }));
    expect([look.knowable, look.pennants, look.stack]).toEqual([1, 2, 1]);
    const plain = lookOf(card([true, true, true, true]));
    expect([plain.knowable, plain.pennants, plain.stack]).toEqual([0, 0, 0]);
  });

  it("Given more pennants and versions than the card has room for Then they are counted up to four", () => {
    expect(MAX_DRAWN).toBe(4);
    const look = lookOf(card([true, true, true, true], { pennants: ["a", "b", "c", "d", "e", "f"], stack: 9 }));
    expect([look.pennants, look.stack]).toEqual([4, 4]);
  });
});

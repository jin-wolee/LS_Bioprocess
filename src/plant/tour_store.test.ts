import { describe, expect, it } from "vitest";
import { TOUR_KEY, createOffer } from "./tour_store.ts";

// P8b (docs/design/plant_ui.md section 3.5, "How the reader enters"): the tour is offered once, on the first entry to the plant. The key is written when the offer first shows, a visit that finds it
// does not offer, and storage that is blocked means the offer is made once for the visit and the choice is not kept (as the hum's is not, hum.ts). Storage is a stub.

const store = (initial?: string) => {
  const kept = new Map<string, string>(initial === undefined ? [] : [[TOUR_KEY, initial]]);
  return { kept, storage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } };
};

describe("the offer of the tour", () => {
  it("Given a first visit Then the offer is made once, the key is written when it is made, and it is not made again in the visit", () => {
    const { storage, kept } = store();
    const offer = createOffer(storage);
    expect(kept.has(TOUR_KEY)).toBe(false);
    expect(offer.make()).toBe(true);
    expect(kept.get(TOUR_KEY)).toBe("seen");
    expect(offer.make()).toBe(false);
    expect(offer.make()).toBe(false);
  });

  it("Given a second visit (the key is there from the first) Then the offer is not made", () => {
    const { storage } = store();
    createOffer(storage).make();
    const second = createOffer(storage);
    expect(second.make()).toBe(false);
  });

  it("Given a key that an earlier visit left Then the offer is not made, whatever the value", () => {
    for (const saved of ["seen", "", "no"]) expect(createOffer(store(saved).storage).make()).toBe(false);
  });

  it("Given the reader starts the tour from the button of the HUD Then the key is written too, so the offer never comes after it", () => {
    const { storage, kept } = store();
    const offer = createOffer(storage);
    offer.remember();
    expect(kept.get(TOUR_KEY)).toBe("seen");
    expect(createOffer(storage).make()).toBe(false);
    expect(offer.make()).toBe(false);
  });

  it("Given storage that throws on every call, or none Then the offer is made once for the visit and nothing breaks", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    for (const storage of [broken, null]) {
      const offer = createOffer(storage);
      expect(offer.make()).toBe(true);
      expect(offer.make()).toBe(false);
      expect(() => offer.remember()).not.toThrow();
    }
  });
});

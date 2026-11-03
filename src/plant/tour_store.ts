// The offer of the guided scene (docs/design/plant_ui.md section 3.5, "How the reader enters"): made once, on the first entry to the plant. The key is written when the offer is first made (or when the
// reader starts the tour from the HUD), inside try/catch; a visit that finds it does not offer. Storage that is blocked only means the choice is not kept, and a flag of the visit keeps the offer from
// being made twice in it. Pure of the page: the storage is given, so Vitest runs it in Node with a stub.

/** The key of `localStorage` that says the offer has been made. */
export const TOUR_KEY = "plant.tour";

type Store = Pick<Storage, "getItem" | "setItem">;

export interface Offer {
  /** Whether to offer the tour now: true the first time ever (and writes the key), false after that and in every later visit. */
  make(): boolean;
  /** The reader started the tour by the button: the offer is never made after that. */
  remember(): void;
}

export const createOffer = (storage: Store | null): Offer => {
  let made = false;
  const seen = (): boolean => {
    try {
      return (storage?.getItem(TOUR_KEY) ?? null) !== null;
    } catch {
      return false;
    }
  };
  const write = (): void => {
    try {
      storage?.setItem(TOUR_KEY, "seen");
    } catch {
      // blocked storage: the choice is not kept, the offer is still made once in this visit
    }
  };
  return {
    make() {
      if (made || seen()) return false;
      made = true;
      write();
      return true;
    },
    remember() {
      made = true;
      write();
    },
  };
};

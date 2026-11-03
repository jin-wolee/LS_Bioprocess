import { hashOf } from "../ui/route.ts";
import { plantQuery } from "./link.ts";
import type { PlantAsk } from "./spec.ts";

// What the address holds of the plant (docs/design/plant_ui.md section 5.5, "As built in P6a"): the plant link of the spec, written with `history.replaceState` after a run has settled, so that a reload or
// a copied address reopens the same run with its actions. Entering the plant does not rewrite the address of a reader who has done nothing: it is written when the list is not empty or when the address
// already carries `actions` (the last action undone). The link has no instant.

/** The hash to write, or null when there is nothing to write (no action and none in the address, or the address already holds it). */
export const addressFor = (spec: PlantAsk, engine: string, current: string): string | null => {
  if (spec.actions.length === 0 && !/[?&]actions=/.test(current)) return null;
  const next = hashOf("plant", plantQuery(spec, { engine }));
  return next === current ? null : next;
};

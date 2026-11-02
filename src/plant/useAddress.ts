import { useEffect } from "preact/hooks";
import type { PlantSpec } from "../protocol.ts";
import { addressFor } from "./address.ts";

// The address holds the plant (docs/design/plant_ui.md section 5.5, "As built in P6a"): after a run has settled, the plant link of its spec is written with `history.replaceState`, never as a new entry of
// the history, so a reload or a copied address reopens the same run with its actions. `hashchange` does not fire for it, so the route the page holds stays as it was. The check runs after every render of
// the route, because the address can change under it without the spec changing (the navigation link of the plant, Home, Back) and must hold the spec again; `addressFor` writes nothing when it already does.

export function useAddress(spec: PlantSpec | null, settled: boolean, engine: string): void {
  useEffect(() => {
    if (spec === null || !settled) return;
    try {
      const next = addressFor(spec, engine, window.location.hash);
      if (next !== null) window.history.replaceState(window.history.state, "", next);
    } catch {
      // an address that cannot be written (a sandboxed frame): the plant works without it
    }
  });
}

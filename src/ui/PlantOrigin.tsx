import { backLink } from "../plant/drill.ts";
import { sameSpec } from "../plant/link.ts";
import { OriginBar } from "../plant/OriginBar.tsx";
import type { PlantState } from "../plant/plant_state.ts";
import type { Screen } from "./route.ts";
import type { Origin } from "./useOrigin.ts";

// The bar of a screen opened from the plant (docs/design/plant_ui.md section 7, "As built in P5c"), on the screens a drill-down opens. Back returns to the instant the reader left the plant at when the plant
// on screen is the one the screen came from, else to the instant of the link.

const SCREENS: readonly Screen[] = ["lineage", "setup", "results", "notes"];

export function PlantOrigin({ origin, plant, engine, screen }: { origin: Origin; plant: PlantState; engine: string; screen: Screen }) {
  if (!SCREENS.includes(screen)) return null;
  const { spec, t: linked } = origin.link;
  const t = sameSpec(plant.spec, spec) && plant.view ? plant.view.t : linked;
  return (
    <OriginBar
      scenario={spec.run.scenario}
      seed={spec.seed}
      actions={spec.actions.length}
      t={t}
      backHref={backLink(spec, engine, t)}
      results={screen === "setup" || screen === "results"}
      utilisation={origin.focus === "utilisation"}
    />
  );
}

import { useMemo } from "preact/hooks";
import type { ScenePlan } from "../protocol.ts";
import { Label, T } from "../ui/T.tsx";
import type { Playback } from "./playback.ts";
import { sceneAt } from "./scene_at.ts";
import { useSlowClock } from "./usePlayback.ts";
import type { Picked } from "./view.ts";

// The tubes on the floor as a list (docs/design/plant_ui.md sections 3.2 and 9): the way to open the panel of a sample without aiming at a 3D object, as the cards list is for a card. The samples whose
// tubes are on the floor at the clock instant, the newest draw first, each a button (Tab reaches it, Enter opens the panel, Escape closes it and the focus returns to the button).

/** How many tubes the list offers: the clock can be moved to reach any other. */
export const NEWEST = 12;

export function TubeList({ plan, playback, onOpen }: { plan: ScenePlan; playback: Playback; onOpen: (p: Picked) => void }) {
  const at = Math.floor(useSlowClock(playback, 1).t);
  const tubes = useMemo(
    () =>
      sceneAt(plan, at).tubes
        .map((t) => t.sample)
        .sort((a, b) => ((plan.samples[b] as ScenePlan["samples"][number]).drawn_s ?? 0) - ((plan.samples[a] as ScenePlan["samples"][number]).drawn_s ?? 0) || b - a)
        .slice(0, NEWEST),
    [plan, at],
  );
  return (
    <section id="plant-tubes" class="plant-tubes" aria-labelledby="plant-tubes-heading" data-plant-tubes-list>
      <T as="h2" k="plant.tubes.heading" id="plant-tubes-heading" />
      <T as="p" k="plant.tubes.lead" />
      {tubes.length === 0 ? (
        <T as="p" k="plant.tubes.none" />
      ) : (
        <ul class="plant-object-list">
          {tubes.map((index) => {
            const id = (plan.samples[index] as ScenePlan["samples"][number]).id;
            return (
              <li key={id}>
                <button type="button" data-tube-sample={id} onClick={() => onOpen({ kind: "sample", index })}>
                  <T k="plant.tubes.open" parts={{ sample: <Label>{id}</Label> }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

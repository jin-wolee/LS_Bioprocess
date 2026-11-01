import { useMemo } from "preact/hooks";
import type { ScenePlan } from "../protocol.ts";
import { Label, T } from "../ui/T.tsx";
import { hallsAt } from "./halls_at.ts";
import type { Playback } from "./playback.ts";
import { useSlowClock } from "./usePlayback.ts";

// The cards of the lens hall as a list (docs/design/plant_ui.md sections 3.3 and 9): the way to open a card without aiming at a 3D object. The newest cards on the shelves of the hall the lens
// reads, at the clock instant, each a button (Tab reaches it, Enter opens its record, Escape closes the record). The legend says how to read a card. Every id is a label; the sentence about the
// shapes carries no number.

/** How many of the newest cards the list offers: the clock can be moved to reach any other. */
export const NEWEST = 12;

export function CardList({ plan, playback, lens, onOpen }: { plan: ScenePlan; playback: Playback; lens: string; onOpen: (architecture: string, sample_id: string) => void }) {
  const at = Math.floor(useSlowClock(playback, 1).t);
  const cards = useMemo(() => (hallsAt(plan, at).find((h) => h.architecture === lens)?.cards ?? []).slice(-NEWEST).reverse(), [plan, lens, at]);
  return (
    <section id="plant-cards" class="plant-cards" aria-labelledby="plant-cards-heading" data-plant-cards-list={lens}>
      <T as="h2" k="plant.cards.heading" id="plant-cards-heading" />
      <T as="p" k="plant.cards.lead" />
      <T as="p" k="plant.cards.legend" class="plant-legend" />
      {cards.length === 0 ? (
        <T as="p" k="plant.cards.none" />
      ) : (
        <ul class="plant-object-list">
          {cards.map((c) => {
            const id = (plan.samples[c.sample] as ScenePlan["samples"][number]).id;
            return (
              <li key={id}>
                <button type="button" data-card-sample={id} data-card-architecture={lens} onClick={() => onOpen(lens, id)}>
                  <T k="plant.cards.open" parts={{ sample: <Label>{id}</Label> }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

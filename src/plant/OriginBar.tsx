import { Label, T } from "../ui/T.tsx";
import { clockOf } from "./view.ts";

// The bar at the head of a screen that was opened from the plant (docs/design/plant_ui.md section 7, "As built in P5c"): which run it came from, the link back to the plant at the instant the reader left, and,
// on Setup and Results, that Results over many seeds carries no plant action in this version. Shown on Lineage, Setup, Results and Notes until the reader enters the plant or Home.

export function OriginBar({ scenario, seed, actions, t, backHref, results, utilisation }: {
  scenario: string;
  seed: number;
  /** How many operator actions the plant had. */
  actions: number;
  /** The instant the reader left the plant at, or null when it is not known. */
  t: number | null;
  backHref: string;
  /** The screen is Setup or Results: say that Results carries no plant action. */
  results: boolean;
  /** The reader came for the utilisation block of Results. */
  utilisation: boolean;
}) {
  const at = t === null ? null : clockOf(t);
  const parts = { scenario: <Label>{scenario}</Label>, seed: <Label>{seed}</Label>, actions: <Label>{actions}</Label> };
  return (
    <aside class="plant-origin notice" role="note" aria-labelledby="plant-origin-label" data-plant-origin>
      <T as="h2" k="plant.origin.label" id="plant-origin-label" />
      <p>
        {at === null ? (
          <T k="plant.origin.run_open" parts={parts} />
        ) : (
          <T k="plant.origin.run" parts={{ ...parts, clock: <T k="plant.clock.reading" parts={{ day: <Label>{at.day}</Label>, time: <Label>{at.time}</Label> }} /> }} />
        )}{" "}
        <a id="back-to-plant" href={backHref} data-drill="plant">
          <T k="plant.origin.back" />
        </a>
      </p>
      {results && <T as="p" k="plant.origin.results" data-note="origin-results" />}
      {results && utilisation && <T as="p" k="plant.origin.utilisation" data-note="origin-utilisation" />}
    </aside>
  );
}

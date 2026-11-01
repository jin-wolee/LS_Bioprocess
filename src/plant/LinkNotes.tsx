import type { Key } from "../i18n/index.ts";
import { Label, T } from "../ui/T.tsx";
import type { LinkNote } from "./link.ts";

// What the page says about the plant link it was opened with (docs/design/plant_ui.md section 7, "As built in P5c"): each key it could not use and fell back on, an instant outside the run (known once the
// plan has arrived) and an engine version other than the build's. Nothing is said about a link that was read as it stood.

const KEY: Record<LinkNote["field"], Key> = {
  scenario: "plant.link.scenario",
  settings: "plant.link.settings",
  capture: "plant.link.capture",
  arch: "plant.link.arch",
  seed: "plant.link.seed",
  actions: "plant.link.actions",
  t: "plant.link.t",
  schema: "plant.link.schema",
};

export function LinkNotes({ notes, fallbackSeed, outside, horizon, engine }: {
  notes: readonly LinkNote[];
  /** The seed the page ran instead of a bad one. */
  fallbackSeed: number;
  /** The instant of the link when it lies outside the run, and the horizon of the run. */
  outside: string | null;
  horizon: number | null;
  /** The engine version the link was made with, and the build's. */
  engine: { made: string | null; current: string };
}) {
  const differs = engine.made !== null && engine.made !== engine.current;
  const range = outside !== null && horizon !== null;
  if (notes.length === 0 && !range && !differs) return null;
  return (
    <section class="plant-link-notes notice" role="note" aria-labelledby="plant-link-heading" data-plant-link-notes>
      <T as="h2" k="plant.link.heading" id="plant-link-heading" />
      <ul>
        {notes.map((n) => (
          <li key={n.field + n.given} data-link-note={n.field}>
            <T k={KEY[n.field]} parts={{ given: <Label>{n.given}</Label>, fallback: <Label>{fallbackSeed}</Label> }} />
          </li>
        ))}
        {range && (
          <li data-link-note="t_range">
            <T k="plant.link.t_range" parts={{ given: <Label>{outside}</Label>, horizon: <Label>{horizon}</Label> }} />
          </li>
        )}
        {differs && (
          <li data-link-note="engine">
            <T k="plant.link.engine" parts={{ made: <Label>{engine.made}</Label>, current: <Label>{engine.current}</Label> }} />
          </li>
        )}
      </ul>
    </section>
  );
}

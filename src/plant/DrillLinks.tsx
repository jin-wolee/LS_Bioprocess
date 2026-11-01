import type { ComponentChildren } from "preact";
import { T } from "../ui/T.tsx";
import type { Key } from "../i18n/index.ts";

// The links from a panel to the other screens of the lab (docs/design/plant_ui.md section 7, "As built in P5c"): plain links, so that they open in a new tab and show where they go. Each is marked
// `data-drill` for the end-to-end check, which follows them.

/** A group of links at the foot of a panel. */
export function DrillLinks({ children }: { children: ComponentChildren }) {
  return (
    <nav class="plant-drill" aria-labelledby="plant-drill-heading">
      <T as="h3" k="plant.drill.heading" id="plant-drill-heading" />
      <ul class="plant-object-list">{children}</ul>
    </nav>
  );
}

export function DrillLink({ name, href, k, parts }: { name: "lineage" | "results" | "notes"; href: string; k: Key; parts?: Record<string, ComponentChildren> }) {
  return (
    <li>
      <a class="plant-drill-link" href={href} data-drill={name}>
        <T k={k} {...(parts && { parts })} />
      </a>
    </li>
  );
}

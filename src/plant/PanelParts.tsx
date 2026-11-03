import type { ComponentChildren } from "preact";
import type { Key } from "../i18n/index.ts";
import { Label, T } from "../ui/T.tsx";
import { clockOf } from "./view.ts";

// The small parts the panels of the picked objects are made of (docs/design/plant_ui.md section 3.2, "As built in P5b" and "As built in P7c"): a time as a clock reading and a row of a panel. Every figure
// is a label and every time a clock reading (invariant 3).

export const Time = ({ t }: { t: number | null }) => {
  if (t === null) return <T k="plant.panel.not_yet" />;
  const c = clockOf(t);
  return <T k="plant.clock.reading" parts={{ day: <Label>{c.day}</Label>, time: <Label>{c.time}</Label> }} />;
};

/** A row of a panel: the name of a figure and the figure, which `field` names for the end-to-end check. */
export const Row = ({ name, field, children }: { name: Key; field?: string; children: ComponentChildren }) => (
  <>
    <T as="dt" k={name} />
    <dd {...(field && { "data-panel-field": field })}>{children}</dd>
  </>
);

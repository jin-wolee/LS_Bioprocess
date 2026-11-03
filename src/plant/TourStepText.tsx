import type { Key } from "../i18n/index.ts";
import type { ScenePlan } from "../protocol.ts";
import { Label, T } from "../ui/T.tsx";
import { Time } from "./PanelParts.tsx";
import type { TourSample, TourStep } from "./tour.ts";

// The title and the text of one step of the guided scene (docs/design/plant_ui.md section 3.5): the one place that fills the placeholders of `plant.tour.<step>.*`, for the box on the floor and for the text
// alternative, so the two say the same words. Every figure is a label and the instant is a clock reading (invariant 3).

/** The placeholders of the step texts: the sample, its reactor and analyzer (ids), and the clock reading of the step. Made fresh for each text: a vnode is drawn once. */
const partsOf = (plan: ScenePlan, sample: TourSample, step: TourStep) => ({
  sample: <Label>{sample.id}</Label>,
  unit: <Label>{plan.units[sample.unit]?.id ?? ""}</Label>,
  analyzer: <Label>{plan.analyzers[sample.analyzer]?.id ?? ""}</Label>,
  clock: <Time t={step.t} />,
});

export function StepText({ plan, sample, step, level }: { plan: ScenePlan; sample: TourSample; step: TourStep; level: "h2" | "h3" }) {
  return (
    <>
      <T as={level} k={`plant.tour.${step.id}.title` as Key} />
      <T as="p" k={`plant.tour.${step.id}.text` as Key} parts={partsOf(plan, sample, step)} />
    </>
  );
}

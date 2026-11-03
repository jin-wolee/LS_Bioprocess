import type { ScenePlan } from "../protocol.ts";
import { Label, T } from "../ui/T.tsx";
import { plantQuery, sameSpec } from "./link.ts";
import type { PlantAsk } from "./spec.ts";
import { TOUR_SPEC, tourSample, tourSteps } from "./tour.ts";
import { StepText } from "./TourStepText.tsx";

// The guided scene as text (docs/design/plant_ui.md section 3.5, "Reduced motion, a phone, WebGL off"): the same steps as the box on the floor, built by the same function and with the same dictionary texts,
// as an ordered list, each with its instant as a clock reading in its text. It is the whole tour when WebGL is missing. When the plant on screen is not the tour's run the steps wait for it, and the link
// opens it (the address changes and the route asks the Worker for the run, as any plant link does). `spec` is null while a request is in flight: the plan on screen is then the answer to an older one.

export function TourText({ plan, spec, engine }: { plan: ScenePlan; spec: PlantAsk | null; engine: string }) {
  const sample = sameSpec(spec, TOUR_SPEC) ? tourSample(plan) : null;
  const steps = sample ? tourSteps(plan) : [];
  return (
    <section id="plant-tour-text" class="plant-tour-text" aria-labelledby="plant-tour-text-heading" data-tour-text>
      <T as="h2" k="plant.tour.text.heading" id="plant-tour-text-heading" />
      {sample && steps.length > 0 ? (
        <>
          <T as="p" k="plant.tour.text.lead" parts={{ scenario: <Label>{TOUR_SPEC.run.scenario}</Label> }} />
          <ol>
            {steps.map((step) => (
              <li key={step.id} data-tour-text-step={step.id}>
                <StepText plan={plan} sample={sample} step={step} level="h3" />
                {step.optional && <T as="p" k="plant.tour.optional" class="plant-tour-optional" />}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <T as="p" k="plant.tour.text.other" />
          <p>
            <a href={`#/plant?${plantQuery(TOUR_SPEC, { engine })}`} data-tour-open-run>
              <T k="plant.tour.text.open" />
            </a>
          </p>
        </>
      )}
    </section>
  );
}

import { useContext, useEffect, useRef } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { ScenePlan, TruthOverlay } from "../protocol.ts";
import { Label, LangContext, T } from "../ui/T.tsx";
import { StepText } from "./TourStepText.tsx";
import { TourCards, TourVerdicts } from "./TourTables.tsx";
import type { Tour as TourState } from "./useTour.ts";
import { TOUR_SPEC } from "./tour.ts";
import "./plant_tour.css";

// The parts of the guided scene on the floor (docs/design/plant_ui.md section 3.5): the offer on the first entry, the button of the HUD, and the box that holds the steps. The state and the effects of the
// tour are useTour.ts's; this draws them. The box is a region that takes the focus when the tour starts, and the text of the step is in a polite live region that exists from then on, so a screen reader
// hears each step as it changes. Back, Next (Finish on the last step) and Skip are buttons; the arrow keys and Escape do the same from useTour.

/** The button of the HUD, under the browser-check chip. During a tour it begins the tour again. */
export function TourButton({ onStart }: { onStart: () => void }) {
  const lang = useContext(LangContext);
  return (
    <div class="plant-hud plant-hud-tour" data-plant-hud="tour">
      <button type="button" data-tour-start title={text(lang, "plant.tour.button.hint")} onClick={onStart}>
        <T k="plant.tour.button" />
      </button>
    </div>
  );
}

function Offer({ tour }: { tour: TourState }) {
  return (
    <section class="plant-tour" data-tour="offer" aria-labelledby="plant-tour-offer-heading">
      <T as="h2" k="plant.tour.offer.heading" id="plant-tour-offer-heading" />
      <T as="p" k="plant.tour.offer.text" />
      <div class="plant-tour-buttons">
        <button type="button" data-tour-take onClick={tour.start}>
          <T k="plant.tour.offer.take" />
        </button>
        <button type="button" data-tour-later onClick={tour.decline}>
          <T k="plant.tour.offer.later" />
        </button>
      </div>
    </section>
  );
}

function Box({ tour, plan, truth, onOpen }: { tour: TourState; plan: ScenePlan; truth: Extract<TruthOverlay, { kind: "sample" }> | null; onOpen: (architecture: string) => void }) {
  const lang = useContext(LangContext);
  const box = useRef<HTMLElement>(null);
  const step = tour.steps[tour.step ?? 0];
  const last = tour.step === tour.steps.length - 1;
  // the box takes the focus when the tour starts and gives it back, when the tour ends, to what had it (the button of the HUD), or to that button when what had it is gone (the offer)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    box.current?.focus();
    return () => (opener?.isConnected ? opener : document.querySelector<HTMLElement>("[data-tour-start]"))?.focus();
  }, []);
  return (
    <section ref={box} class="plant-tour" data-tour="step" data-tour-step={tour.waiting ? "waiting" : step?.id} tabIndex={-1} role="region" aria-label={text(lang, "plant.tour.region")}>
      {step && !tour.waiting && (
        <p class="plant-tour-progress" data-tour-progress>
          <T k="plant.tour.progress" parts={{ n: <Label>{(tour.step ?? 0) + 1}</Label>, total: <Label>{tour.steps.length}</Label> }} />
          {step.optional && (
            <>
              {" "}
              <T k="plant.tour.optional" class="plant-tour-optional" />
            </>
          )}
        </p>
      )}
      <div class="plant-tour-body">
        <div class="plant-tour-live" aria-live="polite" aria-atomic="true" data-tour-live>
          {tour.waiting || !step || !tour.sample ? <T as="p" k="plant.tour.waiting" /> : <StepText plan={plan} sample={tour.sample} step={step} level="h2" />}
        </div>
        {tour.step === 0 || tour.waiting ? (
          <>
            <T as="p" k="plant.tour.scenario" class="plant-tour-note" parts={{ scenario: <Label>{TOUR_SPEC.run.scenario}</Label> }} />
            <T as="p" k="plant.tour.keys" class="plant-tour-note" />
          </>
        ) : null}
        {!tour.waiting && tour.sample && step?.id === "records" && <TourCards plan={plan} sample={tour.sample} onOpen={onOpen} />}
        {!tour.waiting && tour.sample && step?.id === "truth" && <TourVerdicts sample={tour.sample} view={truth} />}
      </div>
      <div class="plant-tour-buttons">
        <button type="button" data-tour-back disabled={tour.waiting || tour.step === 0} onClick={() => tour.move(-1)}>
          <T k="plant.tour.back" />
        </button>
        <button type="button" data-tour-next disabled={tour.waiting} onClick={() => tour.move(1)}>
          <T k={last ? "plant.tour.finish" : "plant.tour.next"} />
        </button>
        <button type="button" data-tour-skip onClick={tour.skip}>
          <T k="plant.tour.skip" />
        </button>
      </div>
    </section>
  );
}

/** The offer, or the box, or nothing: the item of the grid of the route that the tour occupies. */
export function Tour({ tour, plan, truth, onOpen }: { tour: TourState; plan: ScenePlan; truth: Extract<TruthOverlay, { kind: "sample" }> | null; onOpen: (architecture: string) => void }) {
  if (tour.step !== null) return <Box tour={tour} plan={plan} truth={truth} onOpen={onOpen} />;
  return tour.offer ? <Offer tour={tour} /> : null;
}

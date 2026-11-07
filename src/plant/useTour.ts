import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ScenePlan } from "../protocol.ts";
import { sameSpec } from "./link.ts";
import type { Playback } from "./playback.ts";
import type { PlantAsk } from "./spec.ts";
import { TOUR_SPEC, stepAfter, tourEnds, tourKeyAction, tourSample, tourSteps, wantTruth } from "./tour.ts";
import type { TourSample, TourStep } from "./tour.ts";
import { createOffer } from "./tour_store.ts";
import type { Offer } from "./tour_store.ts";
import type { Picked } from "./view.ts";

// The state and the effects of the guided scene (docs/design/plant_ui.md section 3.5). The steps, their instants and the rule for the overlay are tour.ts's (pure); this hook holds the one number the page keeps
// (the step the tour is on, or null), asks for the tour's run when the plant on screen is another, applies a step (the clock to its instant and paused, the object picked, the record and the overlay as the step
// says, the camera brought to its frame), takes the keys, and puts everything back when the tour ends. Nothing is kept anywhere but the key of tour_store.ts.

export interface TourInput {
  /** The plan on screen with the halls that have arrived; null before the first answer. */
  plan: ScenePlan | null;
  playback: Playback | null;
  /** The spec of the newest request, and whether no request is in flight (then the plan on screen is the answer to that spec). */
  spec: PlantAsk;
  settled: boolean;
  epoch: number | null;
  sceneReady: boolean;
  /** A break-out case: no offer is made there (the tour is a different run). */
  inCase: boolean;
  truthOn: boolean;
  lens: string;
  frame: (key: string) => void;
  choose: (picked: Picked | null) => void;
  openRecord: (architecture: string, sample_id: string) => void;
  closeRecord: () => void;
  setTruth: (on: boolean) => void;
  ask: (spec: PlantAsk) => void;
}

export interface Tour {
  /** The offer is showing (the first entry to the plant). */
  offer: boolean;
  /** The step the tour is on, or null when there is no tour. */
  step: number | null;
  /** The tour's run is on its way: there is no step to show yet. */
  waiting: boolean;
  steps: TourStep[];
  sample: TourSample | null;
  start: () => void;
  decline: () => void;
  move: (direction: 1 | -1) => void;
  skip: () => void;
}

const storageOf = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked storage: the offer is made once for this visit and not remembered
  }
};

// one offer for the visit: the flag lives with the page, not with the route, so leaving the plant and coming back does not offer again
let visit: Offer | null = null;
const offerOf = (): Offer => (visit ??= createOffer(storageOf()));

/** The keys of the tour are not taken from a control that takes them itself: a text field, a select, a range (the scrubber). */
const takesKeys = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

export function useTour(input: TourInput): Tour {
  const { plan, playback, spec, settled, epoch, sceneReady, inCase, truthOn } = input;
  const [offer, setOffer] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const own = useRef(false); // the overlay as the reader had it when the tour began
  const asked = useRef(false); // the tour asked for its own run
  const sawBusy = useRef(false); // and saw the request in flight
  const began = useRef<number | null>(null); // the epoch of the plan the first step was applied to
  const steps = useMemo(() => (plan ? tourSteps(plan) : []), [plan]);
  const sample = useMemo(() => (plan ? tourSample(plan) : null), [plan]);
  const onRun = settled && sameSpec(spec, TOUR_SPEC);
  const live = useRef(input);
  live.current = input;

  // the offer, once, when the scene is drawn on a first entry
  useEffect(() => {
    if (sceneReady && !inCase && step === null && offerOf().make()) setOffer(true);
  }, [sceneReady]);

  const end = (): void => {
    if (step === null) return;
    setStep(null);
    began.current = null;
    asked.current = false;
    sawBusy.current = false;
    if (truthOn !== own.current) input.setTruth(own.current);
    input.choose(null);
    input.closeRecord();
  };
  const ending = useRef(end);
  ending.current = end;

  // a step: the clock to its instant and paused, the object picked, the record and the overlay as it says, the camera to its frame
  useEffect(() => {
    if (step === null || !onRun || !sceneReady || !playback) return;
    const s = steps[step];
    if (s === undefined || sample === null) return ending.current(); // the run has no such sample: there is no tour to give
    began.current ??= epoch;
    playback.seek(s.t);
    playback.pause();
    input.choose(s.pick);
    if (s.record) input.openRecord(input.lens, sample.id);
    else input.closeRecord();
    input.frame(s.frame);
  }, [step, onRun, sceneReady, playback]);

  // Parent state can settle after another step has rendered during rapid key presses.
  // Reconcile the overlay separately so a late off update cannot win at the truth step.
  useEffect(() => {
    if (step === null || !onRun || !sceneReady) return;
    const want = wantTruth(steps, step, own.current);
    if (want !== truthOn) input.setTruth(want);
  }, [step, onRun, sceneReady, truthOn, steps]);

  // the plan was replaced by anything but the tour's own run (an action, a link), or the run it asked for did not come: the tour is over
  useEffect(() => {
    if (step === null) return;
    if (!settled) sawBusy.current = true;
    if (tourEnds({ began: began.current, epoch, asked: asked.current, sawBusy: sawBusy.current, settled, onRun })) ending.current();
  }, [step, epoch, settled, onRun]);

  const move = (direction: 1 | -1): void => {
    if (step === null || !onRun || steps.length === 0) return; // no step to move from while the tour's own run is on its way
    const next = stepAfter(step, steps.length, direction);
    if (next === null) ending.current();
    else setStep(next);
  };
  const moving = useRef(move); // the key handler below is made once for the tour and must see the step of the latest render, not the one it was made in
  moving.current = move;

  // the arrow keys step, Escape skips; in the capture phase, so the arrow keys do not also walk the figure
  const touring = step !== null;
  useEffect(() => {
    if (!touring) return;
    const onKey = (e: KeyboardEvent): void => {
      const action = tourKeyAction(e.key);
      if (action === null || e.ctrlKey || e.metaKey || e.altKey || takesKeys(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === "skip") ending.current();
      else moving.current(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [touring]);

  // leaving the plant with the tour on puts the overlay back as the reader had it
  const active = useRef(false);
  active.current = step !== null;
  useEffect(
    () => () => {
      if (active.current && live.current.truthOn !== own.current) live.current.setTruth(own.current);
    },
    [],
  );

  return {
    offer,
    step,
    waiting: step !== null && (!onRun || steps.length === 0),
    steps,
    sample,
    start() {
      if (step !== null) return setStep(0); // a tour is on: begin it again
      offerOf().remember();
      setOffer(false);
      own.current = truthOn;
      began.current = null;
      asked.current = !onRun;
      sawBusy.current = false;
      if (!onRun) input.ask(TOUR_SPEC);
      setStep(0);
    },
    decline: () => setOffer(false),
    move,
    skip: end,
  };
}

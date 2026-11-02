import { useEffect, useRef } from "preact/hooks";
import type { PlantSpec, Request } from "../protocol.ts";
import type { Known, PlantLink } from "../plant/link.ts";
import { plantFromQuery } from "../plant/link.ts";
import { needsRun } from "../plant/plant_state.ts";
import { DEFAULT_PLANT } from "../plant/spec.ts";
import type { Route } from "./route.ts";
import type { Action, State } from "./state.ts";

// What the page asks of the Worker for the plant (docs/design/plant_ui.md sections 5.5, 6 and 7), the way App.tsx used to: the run when the route wants a spec the page has not asked for, the rows of
// one card or one sample, and the truth overlay. The plant asks for its plan under an epoch that grows with every request; the page drops an answer whose epoch is not the newest (section 6, rule 3).

export interface PlantWiring {
  /** The link the route was opened with, read against the build; null when the address has no query. */
  link: PlantLink | null;
  openCard(architecture: string, sample_id: string): void;
  closeCard(): void;
  openFields(architecture: string, sample_id: string): void;
  closeFields(): void;
  /** An operator action: the spec with the reader's list including it, and whether the clock was playing when they acted (plant_ui.md section 5.5). */
  act(spec: PlantSpec, play: boolean): void;
  closeRefusal(): void;
}

export function usePlant(
  { worker, state, dispatch, route, known, take }: { worker: Worker; state: State; dispatch: (action: Action) => void; route: Route; known: Known | null; take: () => number },
): PlantWiring {
  const epochs = useRef(0);
  const ready = state.ready;

  // entering the plant asks for its run when the route wants a spec the page has not asked for: the link's, or else the plant it already has, or else the default one. Back, the navigation and the same
  // link again want the spec of the newest request, so they ask for nothing (plant_ui.md section 7); a failed run is not asked for again under the same spec (no retry loop)
  const link: PlantLink | null = route.screen === "plant" && known && route.query !== "" ? plantFromQuery(route.query, known) : null;
  useEffect(() => {
    if (route.screen !== "plant" || !ready) return;
    const spec = link ? link.spec : (state.plant.spec ?? DEFAULT_PLANT);
    if (!needsRun(state.plant, spec)) return;
    const id = take();
    const epoch = ++epochs.current;
    dispatch({ type: "plant_started", id, epoch, spec });
    worker.postMessage({ type: "plant_run", id, epoch, spec } satisfies Request);
  }, [route.screen, route.query, ready !== null]);

  // a card of a record hall is opened: the Worker reads the rows of one sample from the run it keeps for the epoch of the plan on screen (plant_ui.md section 6); the sample panel asks the same for its
  // own sample, and the answer goes to a slot of its own (`role: "fields"`)
  const askRecord = (architecture: string, sample_id: string, role?: "fields"): void => {
    const epoch = state.plant.ready?.epoch;
    if (epoch === undefined) return;
    const id = take();
    dispatch({ type: "plant_record_started", id, epoch, architecture, sample_id, ...(role && { role }) });
    worker.postMessage({ type: "plant_record", id, epoch, architecture, sample_id } satisfies Request);
  };

  // the truth overlay (plant_ui.md section 3.3): nothing is asked of the Worker before the switch is on. Then, under the epoch of the plan on screen, the placeholders of the halls built so far (asked
  // again when another hall arrives) and the truth of the sample the record panel shows
  const plantEpoch = state.plant.ready?.epoch;
  const hallsBuilt = state.plant.ready ? state.plant.ready.plan.records.length + state.plant.halls.length : 0;
  const askTruth = (epoch: number, pick: { halls: true } | { sample_id: string }): void => {
    const id = take();
    dispatch({ type: "plant_truth_started", id, epoch, pick });
    worker.postMessage({ type: "plant_truth", id, epoch, pick } satisfies Request);
  };
  useEffect(() => {
    if (state.plant.truth.on && plantEpoch !== undefined) askTruth(plantEpoch, { halls: true });
  }, [state.plant.truth.on, plantEpoch, hallsBuilt]);
  const cardOpen = state.plant.record?.sample_id;
  useEffect(() => {
    if (state.plant.truth.on && plantEpoch !== undefined && cardOpen !== undefined) askTruth(plantEpoch, { sample_id: cardOpen });
  }, [state.plant.truth.on, plantEpoch, cardOpen]);

  // an operator action is a request of its own, under a new epoch, with the whole list (section 5.5)
  const act = (spec: PlantSpec, play: boolean): void => {
    const id = take();
    const epoch = ++epochs.current;
    dispatch({ type: "plant_acted", id, epoch, spec, play });
    worker.postMessage({ type: "plant_run", id, epoch, spec } satisfies Request);
  };

  return {
    link,
    act,
    closeRefusal: () => dispatch({ type: "plant_refusal_closed" }),
    openCard: (architecture, sample_id) => askRecord(architecture, sample_id),
    closeCard: () => dispatch({ type: "plant_record_closed" }),
    openFields: (architecture, sample_id) => askRecord(architecture, sample_id, "fields"),
    closeFields: () => dispatch({ type: "plant_record_closed", role: "fields" }),
  };
}

import type { ErrorCode, PlantSpec, RefusalReason, Response, SampleRecord, ScenePlan, TruthOverlay } from "../protocol.ts";
import { runKeyOf } from "../ui/run_key.ts";
import { sameSpec } from "./link.ts";

// What the page knows of the plant (docs/design/plant_ui.md sections 5.5 and 6, rule 3), folded from the Worker's messages by the reducer of ui/state.ts. The page asks for a plan under an epoch
// that grows with every request; an answer or an error whose epoch is not the newest asked for is dropped, so a slow older run can never replace a newer one. The plan on screen stays until the
// newer answer arrives.
//
// The plan of `plant_ready` holds the hall of the first architecture; the others arrive as `plant_halls` and are merged here as they come, beside the plan and not into it: the plan on screen stays
// the same object, so the clock and the scene are not rebuilt when a hall arrives. The record panel (P5a) asks the Worker for the rows of one card and keeps the answer of that request only.
//
// P5b adds the truth overlay (section 3.3): the switch, and the answers of the two requests the overlay makes (the placeholders of the halls, the truth of the sample the record panel shows), each
// kept for its own request only. Nothing of it is held while the switch is off. The sample panel reads the rows of its sample in a slot of its own (`fields`), beside the record panel's.
//
// P5c keeps the plant when the reader leaves it (docs/design/plant_ui.md section 7, "As built in P5c"): `spec` is the spec of the newest request, so that the plant is asked for again only when the route wants
// another one (`needsRun`); `view` is the clock instant and the lens at the moment the reader left, which Back returns to; and a challenge started on the run empties the overlay (`plant_run_locked`).

export type PlantReady = Omit<Extract<Response, { type: "plant_ready" }>, "type" | "id">;

export interface PlantProblem {
  code: ErrorCode;
  message: string;
  /** With `refused` only: the rule of section 5.6, and the index of the action in the list that was sent. */
  reason?: RefusalReason;
  index?: number;
}

/** The card the reader opened: the request, and its answer or its refusal. */
export interface PlantRecordState {
  id: number;
  epoch: number;
  architecture: string;
  sample_id: string;
  view: SampleRecord | null;
  problem: PlantProblem | null;
}

/** One request of the overlay and its answer or its refusal (`locked` is the refusal the switch says in words). */
export interface PlantTruthSlot<V> {
  id: number;
  epoch: number;
  view: V | null;
  problem: PlantProblem | null;
  /** A challenge was started on the run after this request was made: its answer, if it still comes, is not kept. */
  closed?: true;
}
export type HallsTruth = Extract<TruthOverlay, { kind: "halls" }>;
export type SampleTruth = Extract<TruthOverlay, { kind: "sample" }>;
export interface PlantTruthState {
  /** The switch "Show what the simulation knows". */
  on: boolean;
  /** The placeholders of the halls built when it was asked. */
  halls: PlantTruthSlot<HallsTruth> | null;
  /** The truth of the sample the record panel shows. */
  sample: (PlantTruthSlot<SampleTruth> & { sample_id: string }) | null;
}

/** Where the reader left the plant: the instant of the clock (whole seconds of the run) and the hall the lens reads. */
export interface PlantView {
  t: number;
  lens: string | null;
}

export interface PlantState {
  /** The newest epoch asked for; 0 before the first request. */
  epoch: number;
  /** The spec of the newest request; null before the first. */
  spec: PlantSpec | null;
  view: PlantView | null;
  /** The id of the request of that epoch while it is unanswered. */
  running: number | null;
  ready: PlantReady | null;
  /** The halls that came after `ready`, in the order they arrived. */
  halls: ScenePlan["records"];
  record: PlantRecordState | null;
  /** The rows the sample panel shows of its sample, from the lens hall. */
  fields: PlantRecordState | null;
  truth: PlantTruthState;
  problem: PlantProblem | null;
}

/** What the page itself says to the plant's state, besides the Worker's messages. */
export type PlantPageAction =
  | { type: "plant_started"; id: number; epoch: number; spec: PlantSpec }
  | { type: "plant_left"; t: number; lens: string | null }
  | { type: "plant_run_locked"; key: string }
  | { type: "plant_record_started"; id: number; epoch: number; architecture: string; sample_id: string; role?: "fields" }
  | { type: "plant_record_closed"; role?: "fields" }
  | { type: "plant_truth_switched"; on: boolean }
  | { type: "plant_truth_started"; id: number; epoch: number; pick: { halls: true } | { sample_id: string } };
export type PlantAction = Response | PlantPageAction;

export const NO_TRUTH: PlantTruthState = { on: false, halls: null, sample: null };
export const initialPlant: PlantState = { epoch: 0, spec: null, view: null, running: null, ready: null, halls: [], record: null, fields: null, truth: NO_TRUTH, problem: null };

const problemOf = (action: Extract<Response, { type: "error" }>): PlantProblem => ({ code: action.code, message: action.message, ...(action.reason && { reason: action.reason }), ...(action.index !== undefined && { index: action.index }) });

/** The halls of the plan on screen in the order of its layout: the first hall and the ones merged since (a hall that has not arrived is simply missing). */
export const hallsOfPlan = (plan: ScenePlan, halls: ScenePlan["records"]): ScenePlan["records"] => {
  const order = plan.layout.architectures;
  return [...plan.records, ...halls].sort((a, b) => order.indexOf(a.architecture) - order.indexOf(b.architecture));
};

/** The overlay with what was asked emptied: the requests stay as slots so that a late answer or error of one finds its place and is neither kept nor taken for the plant's. */
const emptied = (t: PlantTruthState): PlantTruthState => ({ on: t.on, halls: t.halls && { ...t.halls, view: null, problem: null }, sample: t.sample && { ...t.sample, view: null, problem: null } });

/** Whether the route wants a run the page has not asked for: nothing is asked again for the spec of the newest request, whether it is on its way, answered or failed (no retry loop). */
export const needsRun = (plant: PlantState, want: PlantSpec): boolean => !sameSpec(plant.spec, want);

/** The overlay after a challenge was started on its run: nothing is held of what the simulation knows, each slot says `locked` as a new request would, and a late answer is not kept. */
const closed = (t: PlantTruthState): PlantTruthState => {
  const locked: PlantProblem = { code: "locked", message: "a challenge was started on this run" };
  return { on: t.on, halls: t.halls && { ...t.halls, view: null, problem: locked, closed: true }, sample: t.sample && { ...t.sample, view: null, problem: locked, closed: true } };
};

const truthError = (t: PlantTruthState, action: Extract<Response, { type: "error" }>): PlantTruthState | null => {
  if (t.halls?.id === action.id) return { ...t, halls: { ...t.halls, problem: problemOf(action) } };
  if (t.sample?.id === action.id) return { ...t, sample: { ...t.sample, problem: problemOf(action) } };
  return null;
};

export const reducePlant = (state: PlantState, action: PlantAction): PlantState => {
  switch (action.type) {
    case "plant_started":
      return { ...state, epoch: action.epoch, spec: action.spec, view: sameSpec(state.spec, action.spec) ? state.view : null, running: action.id, problem: null };
    case "plant_left":
      return { ...state, view: { t: action.t, lens: action.lens }, record: null, fields: null };
    case "plant_run_locked":
      return state.spec !== null && runKeyOf(state.spec.run, state.spec.seed) === action.key && (state.truth.halls !== null || state.truth.sample !== null) ? { ...state, truth: closed(state.truth) } : state;
    case "plant_ready": {
      if (action.epoch !== state.epoch) return state;
      const ready: PlantReady = { epoch: action.epoch, plan: action.plan, resume_at: action.resume_at, hashes: action.hashes, checks: action.checks };
      // a new plan: the overlay of the old one goes with it (the switch stays as the reader left it)
      return { ...state, running: null, ready, halls: [], record: null, fields: null, truth: { on: state.truth.on, halls: null, sample: null }, problem: null };
    }
    case "plant_halls": {
      // a hall belongs to the plan of its own epoch: it is dropped when that is not the newest asked for, or not the one on screen, or when the hall is already there
      if (action.epoch !== state.epoch || state.ready === null || state.ready.epoch !== action.epoch) return state;
      const have = new Set([...state.ready.plan.records, ...state.halls].map((r) => r.architecture));
      const fresh = action.records.filter((r) => !have.has(r.architecture));
      if (fresh.length === 0) return state;
      return { ...state, halls: [...state.halls, ...fresh], ready: { ...state.ready, hashes: { ...state.ready.hashes, cells: { ...state.ready.hashes.cells, ...action.cells } } } };
    }
    case "plant_record_started": {
      const slot: PlantRecordState = { id: action.id, epoch: action.epoch, architecture: action.architecture, sample_id: action.sample_id, view: null, problem: null };
      return action.role === "fields" ? { ...state, fields: slot } : { ...state, record: slot };
    }
    case "plant_record_closed":
      return action.role === "fields" ? { ...state, fields: null } : { ...state, record: null };
    case "plant_record_view": {
      const answer = (r: PlantRecordState | null): PlantRecordState | null =>
        r !== null && action.id === r.id && action.epoch === state.epoch && r.epoch === action.epoch ? { ...r, view: action.sample, problem: null } : r;
      return { ...state, record: answer(state.record), fields: answer(state.fields) };
    }
    case "plant_truth_switched":
      return { ...state, truth: action.on ? { ...state.truth, on: true } : emptied({ ...state.truth, on: false }) };
    case "plant_truth_started": {
      const t = state.truth;
      if ("halls" in action.pick) return { ...state, truth: { ...t, halls: { id: action.id, epoch: action.epoch, view: null, problem: null } } };
      return { ...state, truth: { ...t, sample: { id: action.id, epoch: action.epoch, sample_id: action.pick.sample_id, view: null, problem: null } } };
    }
    case "plant_truth_view": {
      const t = state.truth;
      if (!t.on || action.epoch !== state.epoch) return state;
      if (action.view.kind === "halls" && t.halls?.id === action.id && t.halls.epoch === action.epoch && !t.halls.closed) return { ...state, truth: { ...t, halls: { ...t.halls, view: action.view, problem: null } } };
      if (action.view.kind === "sample" && t.sample?.id === action.id && t.sample.epoch === action.epoch && !t.sample.closed) return { ...state, truth: { ...t, sample: { ...t.sample, view: action.view, problem: null } } };
      return state;
    }
    case "error": {
      if (action.epoch === undefined || action.epoch !== state.epoch) return state;
      // an error about the open card is the record panel's problem, about the sample panel's rows that panel's, about an overlay request the overlay's; any other error of this epoch is the plant's
      if (state.record !== null && action.id === state.record.id) return { ...state, record: { ...state.record, problem: problemOf(action) } };
      if (state.fields !== null && action.id === state.fields.id) return { ...state, fields: { ...state.fields, problem: problemOf(action) } };
      const truth = truthError(state.truth, action);
      if (truth !== null) return { ...state, truth };
      return { ...state, running: null, problem: problemOf(action) };
    }
    default:
      return state;
  }
};

import type { ErrorCode, RefusalReason, Response, SampleRecord, ScenePlan } from "../protocol.ts";

// What the page knows of the plant (docs/design/plant_ui.md sections 5.5 and 6, rule 3), folded from the Worker's messages by the reducer of ui/state.ts. The page asks for a plan under an epoch
// that grows with every request; an answer or an error whose epoch is not the newest asked for is dropped, so a slow older run can never replace a newer one. The plan on screen stays until the
// newer answer arrives.
//
// The plan of `plant_ready` holds the hall of the first architecture; the others arrive as `plant_halls` and are merged here as they come, beside the plan and not into it: the plan on screen stays
// the same object, so the clock and the scene are not rebuilt when a hall arrives. The record panel (P5a) asks the Worker for the rows of one card and keeps the answer of that request only.

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

export interface PlantState {
  /** The newest epoch asked for; 0 before the first request. */
  epoch: number;
  /** The id of the request of that epoch while it is unanswered. */
  running: number | null;
  ready: PlantReady | null;
  /** The halls that came after `ready`, in the order they arrived. */
  halls: ScenePlan["records"];
  record: PlantRecordState | null;
  problem: PlantProblem | null;
}

/** What the page itself says to the plant's state, besides the Worker's messages. */
export type PlantPageAction =
  | { type: "plant_started"; id: number; epoch: number }
  | { type: "plant_record_started"; id: number; epoch: number; architecture: string; sample_id: string }
  | { type: "plant_record_closed" };
export type PlantAction = Response | PlantPageAction;

export const initialPlant: PlantState = { epoch: 0, running: null, ready: null, halls: [], record: null, problem: null };

const problemOf = (action: Extract<Response, { type: "error" }>): PlantProblem => ({ code: action.code, message: action.message, ...(action.reason && { reason: action.reason }), ...(action.index !== undefined && { index: action.index }) });

/** The halls of the plan on screen in the order of its layout: the first hall and the ones merged since (a hall that has not arrived is simply missing). */
export const hallsOfPlan = (plan: ScenePlan, halls: ScenePlan["records"]): ScenePlan["records"] => {
  const order = plan.layout.architectures;
  return [...plan.records, ...halls].sort((a, b) => order.indexOf(a.architecture) - order.indexOf(b.architecture));
};

export const reducePlant = (state: PlantState, action: PlantAction): PlantState => {
  switch (action.type) {
    case "plant_started":
      return { ...state, epoch: action.epoch, running: action.id, problem: null };
    case "plant_ready": {
      if (action.epoch !== state.epoch) return state;
      const ready: PlantReady = { epoch: action.epoch, plan: action.plan, resume_at: action.resume_at, hashes: action.hashes, checks: action.checks };
      return { ...state, running: null, ready, halls: [], record: null, problem: null };
    }
    case "plant_halls": {
      // a hall belongs to the plan of its own epoch: it is dropped when that is not the newest asked for, or not the one on screen, or when the hall is already there
      if (action.epoch !== state.epoch || state.ready === null || state.ready.epoch !== action.epoch) return state;
      const have = new Set([...state.ready.plan.records, ...state.halls].map((r) => r.architecture));
      const fresh = action.records.filter((r) => !have.has(r.architecture));
      if (fresh.length === 0) return state;
      return { ...state, halls: [...state.halls, ...fresh], ready: { ...state.ready, hashes: { ...state.ready.hashes, cells: { ...state.ready.hashes.cells, ...action.cells } } } };
    }
    case "plant_record_started":
      return { ...state, record: { id: action.id, epoch: action.epoch, architecture: action.architecture, sample_id: action.sample_id, view: null, problem: null } };
    case "plant_record_closed":
      return { ...state, record: null };
    case "plant_record_view": {
      const r = state.record;
      if (r === null || action.id !== r.id || action.epoch !== state.epoch || r.epoch !== action.epoch) return state;
      return { ...state, record: { ...r, view: action.sample, problem: null } };
    }
    case "error": {
      if (action.epoch === undefined || action.epoch !== state.epoch) return state;
      // an error about the open card is the record panel's problem; any other error of this epoch is the plant's
      if (state.record !== null && action.id === state.record.id) return { ...state, record: { ...state.record, problem: problemOf(action) } };
      return { ...state, running: null, problem: problemOf(action) };
    }
    default:
      return state;
  }
};

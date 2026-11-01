import type { ErrorCode, RefusalReason, Response } from "../protocol.ts";

// What the page knows of the plant (docs/design/plant_ui.md sections 5.5 and 6, rule 3), folded from the Worker's messages by the reducer of ui/state.ts. The page asks for a plan under an epoch
// that grows with every request; an answer or an error whose epoch is not the newest asked for is dropped, so a slow older run can never replace a newer one. The plan on screen stays until the
// newer answer arrives.

export type PlantReady = Omit<Extract<Response, { type: "plant_ready" }>, "type" | "id">;

export interface PlantProblem {
  code: ErrorCode;
  message: string;
  /** With `refused` only: the rule of section 5.6, and the index of the action in the list that was sent. */
  reason?: RefusalReason;
  index?: number;
}

export interface PlantState {
  /** The newest epoch asked for; 0 before the first request. */
  epoch: number;
  /** The id of the request of that epoch while it is unanswered. */
  running: number | null;
  ready: PlantReady | null;
  problem: PlantProblem | null;
}

export type PlantAction = Response | { type: "plant_started"; id: number; epoch: number };

export const initialPlant: PlantState = { epoch: 0, running: null, ready: null, problem: null };

export const reducePlant = (state: PlantState, action: PlantAction): PlantState => {
  switch (action.type) {
    case "plant_started":
      return { ...state, epoch: action.epoch, running: action.id, problem: null };
    case "plant_ready": {
      if (action.epoch !== state.epoch) return state;
      const ready: PlantReady = { epoch: action.epoch, plan: action.plan, resume_at: action.resume_at, hashes: action.hashes, checks: action.checks };
      return { ...state, running: null, ready, problem: null };
    }
    case "error": {
      if (action.epoch === undefined || action.epoch !== state.epoch) return state;
      const problem: PlantProblem = { code: action.code, message: action.message, ...(action.reason && { reason: action.reason }), ...(action.index !== undefined && { index: action.index }) };
      return { ...state, running: null, problem };
    }
    default:
      return state;
  }
};

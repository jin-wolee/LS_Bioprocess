import type { Response } from "../protocol.ts";
import { problemOf } from "./one_seed_state.ts";
import type { Problem } from "./one_seed_state.ts";
import type { Progress, ResultInfo } from "./state.ts";

// What the page knows of the card on Home (docs/design/lab_ui.md section 26): the run it asked for, folded from the Worker's messages about that request alone. The card's run has an id of its own,
// so its answer does not replace the last run of Setup and Results, and a run of Setup does not replace the card's answer.

export interface OneFlagState {
  /** The id of the run the reader started with the card and that has not ended. */
  running: number | null;
  progress: Progress | null;
  /** The answer to the last run that ended, until a new run starts. */
  result: ResultInfo | null;
  problem: Problem | null;
}

export const initialOneFlag: OneFlagState = { running: null, progress: null, result: null, problem: null };

export type OneFlagAction = { type: "one_flag_started"; id: number };

/** Whether a message is about the run in flight of the card: a progress, a result or an error that names its id. */
export const isAboutOneFlag = (state: OneFlagState, action: { type: string }): boolean => {
  const id = (action as { id?: unknown }).id;
  return (action.type === "progress" || action.type === "result" || action.type === "error") && typeof id === "number" && id === state.running;
};

export const reduceOneFlag = (state: OneFlagState, action: Response | OneFlagAction | { type: "worker_error"; message: string }): OneFlagState => {
  switch (action.type) {
    case "one_flag_started":
      return { running: action.id, progress: null, result: null, problem: null };
    case "progress":
      return action.id === state.running ? { ...state, progress: { id: action.id, done: action.done, total: action.total } } : state;
    case "result":
      return action.id === state.running && action.report ? { running: null, progress: null, result: { id: action.id, report: action.report, ...(action.utilisation && { utilisation: action.utilisation }), footer: action.footer }, problem: null } : state;
    case "error":
      return action.id !== null && action.id === state.running ? { running: null, progress: null, result: null, problem: problemOf(action) } : state;
    case "worker_error":
      return state.running === null ? state : { running: null, progress: null, result: null, problem: { id: null, code: "worker", message: action.message } };
    default:
      return state;
  }
};

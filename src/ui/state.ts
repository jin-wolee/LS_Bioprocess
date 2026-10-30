import type { CheckDetail, CheckState, ErrorCode, Response, ResultFooter, RunSummary, ScenarioInfo } from "../protocol.ts";

// What the page knows: the messages of the Worker folded into one state (docs/design/lab_ui.md section 2: hooks and one reducer).

export interface ReadyInfo {
  engine_version: string;
  schema_version: "1";
  flags: string[];
  scenarios: ScenarioInfo[];
}

export interface ResultInfo {
  id: number;
  summary?: RunSummary;
  footer: ResultFooter;
}

export interface Problem {
  code: ErrorCode | "worker";
  message: string;
}

export interface State {
  ready: ReadyInfo | null;
  check: { state: CheckState; detail: CheckDetail };
  result: ResultInfo | null;
  problem: Problem | null;
}

export type Action = Response | { type: "worker_error"; message: string };

export const initial: State = {
  ready: null,
  check: { state: "pending", detail: { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false } },
  result: null,
  problem: null,
};

export const reduce = (state: State, action: Action): State => {
  switch (action.type) {
    case "ready":
      return { ...state, ready: { engine_version: action.engine_version, schema_version: action.schema_version, flags: action.flags, scenarios: action.scenarios } };
    case "check":
      return { ...state, check: { state: action.state, detail: action.detail } };
    case "result":
      return { ...state, result: { id: action.id, ...(action.summary && { summary: action.summary }), footer: action.footer }, problem: null };
    case "error":
      return { ...state, problem: { code: action.code, message: action.message } };
    case "worker_error":
      return { ...state, problem: { code: "worker", message: action.message } };
  }
};

/** The state a result block shows: a result made while the check was pending is never dropped, and takes the check's state when that arrives (lab_ui.md section 7). */
export const displayedCheck = (atResult: CheckState, now: CheckState): CheckState => (atResult === "pending" ? now : atResult);

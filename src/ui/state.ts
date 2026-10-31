import type { CheckDetail, CheckState, Response, ResultFooter, RunSummary, UtilisationView } from "../protocol.ts";
import { initialBreakout, initialChallenge, initialLineage, reduceBreakout, reduceChallenge, reduceLineage } from "./one_seed_state.ts";
import type { BreakoutState, ChallengeState, LineageState, OneSeedAction, Problem } from "./one_seed_state.ts";

export type { Problem };

// What the page knows: the messages of the Worker folded into one state (docs/design/lab_ui.md section 2: hooks and one reducer).

/** The id of the request that the Home form sends at start-up; the runs the reader starts take the ids after it. */
export const HOME_ID = 1;

export type ReadyInfo = Omit<Extract<Response, { type: "ready" }>, "type">;

export interface ResultInfo {
  id: number;
  /** The Home form: the count of events of one run. */
  summary?: RunSummary;
  /** A full run: the report of the experiment, its utilisation by analyzer profile and what it was run with. */
  report?: NonNullable<Extract<Response, { type: "result" }>["report"]>;
  utilisation?: UtilisationView;
  footer: ResultFooter;
}

export interface Progress {
  id: number;
  done: number;
  total: number;
}

export interface State {
  ready: ReadyInfo | null;
  check: { state: CheckState; detail: CheckDetail };
  /** The result of the Home form (one run, counts of events). */
  home: ResultInfo | null;
  /** The result of the last full run. */
  results: ResultInfo | null;
  progress: Progress | null;
  /** The id of the run the reader started and that has not ended. */
  running: number | null;
  problem: Problem | null;
  /** S3e: the lineage view of the last request, and the challenge in progress (one_seed_state.ts). */
  lineage: LineageState;
  challenge: ChallengeState;
  /** S3g: the Break-out result of the last request. */
  breakout: BreakoutState;
}

export type Action = Response | OneSeedAction | { type: "worker_error"; message: string } | { type: "run_started"; id: number };

export const initial: State = {
  ready: null,
  check: { state: "pending", detail: { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false } },
  home: null,
  results: null,
  progress: null,
  running: null,
  problem: null,
  lineage: initialLineage,
  challenge: initialChallenge,
  breakout: initialBreakout,
};

/** The run in flight is over when a message about it ends it. */
const over = (state: State, id: number | null): Pick<State, "running" | "progress"> =>
  id !== null && id === state.running ? { running: null, progress: null } : { running: state.running, progress: state.progress };

/** A message about a request of the one-seed screens goes to their state, not to the run in flight. */
const forOneSeed = (state: State, id: number | null): boolean =>
  id !== null && (id === state.lineage.running || id === state.breakout.running || id === state.challenge.starting?.id || id === state.challenge.busy?.id);

export const reduce = (state: State, action: Action): State => {
  const withOneSeed = (next: State): State => ({ ...next, lineage: reduceLineage(state.lineage, action as Response | OneSeedAction), challenge: reduceChallenge(state.challenge, action as Response | OneSeedAction), breakout: reduceBreakout(state.breakout, action as Response | OneSeedAction) });
  switch (action.type) {
    case "lineage_started":
    case "breakout_started":
    case "breakout_result":
    case "challenge_starting":
    case "challenge_busy":
    case "challenge_reset":
    case "lineage":
    case "challenge_ready":
    case "sample_record":
    case "challenge_reveal":
      return withOneSeed(state);
    case "ready": {
      const { type, ...ready } = action;
      return type === "ready" ? { ...state, ready } : state;
    }
    case "check":
      return { ...state, check: { state: action.state, detail: action.detail } };
    case "run_started":
      return { ...state, results: null, running: action.id, progress: null, problem: null };
    case "progress":
      return action.id === state.running ? { ...state, progress: { id: action.id, done: action.done, total: action.total } } : withOneSeed(state);
    case "result": {
      const info: ResultInfo = { id: action.id, ...(action.summary && { summary: action.summary }), ...(action.report && { report: action.report }), ...(action.utilisation && { utilisation: action.utilisation }), footer: action.footer };
      return { ...state, ...(action.report ? { results: info } : { home: info }), ...over(state, action.id), problem: null };
    }
    case "error":
      if (forOneSeed(state, action.id)) return withOneSeed(state);
      return { ...state, problem: { id: action.id, code: action.code, message: action.message }, ...over(state, action.id) };
    case "worker_error":
      return { ...state, problem: { id: null, code: "worker", message: action.message }, running: null, progress: null };
  }
};

/** The state a result block shows: a result made while the check was pending is never dropped, and takes the check's state when that arrives (lab_ui.md section 7). */
export const displayedCheck = (atResult: CheckState, now: CheckState): CheckState => (atResult === "pending" ? now : atResult);

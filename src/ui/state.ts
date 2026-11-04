import type { CheckDetail, CheckState, FleetProblem, Response, ResultFooter, RunSummary, UtilisationView } from "../protocol.ts";
import { initialPlant, reducePlant } from "../plant/plant_state.ts";
import type { PlantPageAction, PlantState } from "../plant/plant_state.ts";
import { initialOneFlag, isAboutOneFlag, reduceOneFlag } from "./one_flag_state.ts";
import type { OneFlagAction, OneFlagState } from "./one_flag_state.ts";
import { initialBreakout, initialChallenge, initialLineage, problemOf, reduceBreakout, reduceChallenge, reduceLineage } from "./one_seed_state.ts";
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

/**
 * The check of the analyzer list (U2; lab_ui.md section 4, rule 6). `asked` is the newest request and what it asked about (`key`: the scenario and the picks, form.ts `fleetKey`); `verdict` is the answer
 * to that request, with the key it answers. An answer to an older request is dropped, so a slow answer to an old pick can never replace the one the reader is waiting for; Setup lets a run through only
 * when `verdict.key` is the key of the form in front of it and `verdict.problems` is empty (fleet_view.ts).
 */
export interface FleetState {
  asked: { id: number; key: string } | null;
  verdict: { key: string; problems: FleetProblem[] } | null;
}

export const initialFleet: FleetState = { asked: null, verdict: null };

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
  /** P3: the plant: the newest epoch asked for and the plan of the newest answer (plant/plant_state.ts). */
  plant: PlantState;
  /** U2: the check of the analyzer list of Setup. */
  fleet: FleetState;
  /** A3: the run of the card on Home, with a state of its own (one_flag_state.ts). */
  oneFlag: OneFlagState;
}

export type Action = Response | OneSeedAction | PlantPageAction | { type: "worker_error"; message: string } | { type: "run_started"; id: number } | { type: "fleet_asked"; id: number; key: string } | OneFlagAction;

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
  plant: initialPlant,
  fleet: initialFleet,
  oneFlag: initialOneFlag,
};

/** The run in flight is over when a message about it ends it. */
const over = (state: State, id: number | null): Pick<State, "running" | "progress"> =>
  id !== null && id === state.running ? { running: null, progress: null } : { running: state.running, progress: state.progress };

/** A message about a request of the one-seed screens goes to their state, not to the run in flight. */
const forOneSeed = (state: State, id: number | null): boolean =>
  id !== null && (id === state.lineage.running || id === state.breakout.running || id === state.challenge.starting?.id || id === state.challenge.busy?.id);

export const reduce = (state: State, action: Action): State => {
  const withOneSeed = (next: State): State => ({ ...next, lineage: reduceLineage(state.lineage, action as Response | OneSeedAction), challenge: reduceChallenge(state.challenge, action as Response | OneSeedAction), breakout: reduceBreakout(state.breakout, action as Response | OneSeedAction) });
  // A3: the card on Home has a run of its own: what is about its id is folded into its state and touches nothing else, and nothing about another request touches it
  if (action.type === "one_flag_started" || isAboutOneFlag(state.oneFlag, action)) return { ...state, oneFlag: reduceOneFlag(state.oneFlag, action as Parameters<typeof reduceOneFlag>[1]) };
  switch (action.type) {
    case "challenge_ready":
      // the lineage view and the truth overlay of a run with the key the challenge answered with go (lab_ui.md section 4, rule 2)
      return { ...withOneSeed(state), plant: reducePlant(state.plant, { type: "plant_run_locked", key: action.key }) };
    case "challenge_starting":
    case "lineage_started":
    case "breakout_started":
    case "breakout_result":
    case "challenge_busy":
    case "challenge_reset":
    case "lineage":
    case "sample_record":
    case "challenge_reveal":
      return withOneSeed(state);
    case "plant_started":
    case "plant_acted":
    case "plant_refusal_closed":
    case "plant_left":
    case "plant_run_locked":
    case "plant_ready":
    case "plant_halls":
    case "plant_record_started":
    case "plant_record_closed":
    case "plant_record_view":
    case "plant_truth_switched":
    case "plant_truth_started":
    case "plant_truth_view":
      return { ...state, plant: reducePlant(state.plant, action) };
    case "ready": {
      const { type, ...ready } = action;
      return type === "ready" ? { ...state, ready } : state;
    }
    case "check":
      return { ...state, check: { state: action.state, detail: action.detail } };
    case "fleet_asked":
      return { ...state, fleet: { ...state.fleet, asked: { id: action.id, key: action.key } } };
    case "fleet_checked":
      // only the answer to the newest request is kept: an older one that arrives last must not replace it
      return state.fleet.asked !== null && action.id === state.fleet.asked.id ? { ...state, fleet: { ...state.fleet, verdict: { key: state.fleet.asked.key, problems: action.problems } } } : state;
    case "run_started":
      return { ...state, results: null, running: action.id, progress: null, problem: null };
    case "progress":
      return action.id === state.running ? { ...state, progress: { id: action.id, done: action.done, total: action.total } } : withOneSeed(state);
    case "result": {
      const info: ResultInfo = { id: action.id, ...(action.summary && { summary: action.summary }), ...(action.report && { report: action.report }), ...(action.utilisation && { utilisation: action.utilisation }), footer: action.footer };
      return { ...state, ...(action.report ? { results: info } : { home: info }), ...over(state, action.id), problem: null };
    }
    case "error":
      // a check the Worker refused is no verdict about the picks (the page sends bundled ids, so this is a fault): the reader is not shut out of Run, the fault is shown, and the run says its own
      if (action.epoch === undefined && action.id !== null && state.fleet.asked !== null && action.id === state.fleet.asked.id) return { ...state, fleet: { ...state.fleet, verdict: { key: state.fleet.asked.key, problems: [] } }, problem: problemOf(action) };
      if (action.epoch !== undefined) return { ...state, plant: reducePlant(state.plant, action) }; // an error of a plant request: the plant's problem, or dropped when its epoch is not the newest
      if (forOneSeed(state, action.id)) return withOneSeed(state);
      return { ...state, problem: problemOf(action), ...over(state, action.id) };
    case "worker_error":
      return { ...state, problem: { id: null, code: "worker", message: action.message }, running: null, progress: null, oneFlag: reduceOneFlag(state.oneFlag, action) };
  }
};

/** The state a result block shows: a result made while the check was pending is never dropped, and takes the check's state when that arrives (lab_ui.md section 7). */
export const displayedCheck = (atResult: CheckState, now: CheckState): CheckState => (atResult === "pending" ? now : atResult);

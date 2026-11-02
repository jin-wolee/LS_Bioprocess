import type { BreakoutResult, ChallengeVariant, DecisionRecordView, ErrorCode, LineageView, RecordView, RefValue, RefusalReason, Response, Reveal, SampleRecord } from "../protocol.ts";

// What the page knows of the one-seed screens (lab_ui.md sections 8 and 9): the lineage view of the last request, and the challenge in progress. They are folded from the Worker's messages by
// the reducer of state.ts. S3g adds the Break-out result of the last request. A request is remembered with what it asked, because the answer carries no footer: the screen composes the result block from the request and the engine version.

export interface Problem {
  /** The request it answers; null for the Worker itself. */
  id: number | null;
  code: ErrorCode | "worker";
  message: string;
  /** Only with `refused` (an action a rule refuses, P5c and P6b): the rule, and the place of the action in the list that was sent. */
  reason?: RefusalReason;
  index?: number;
}

/** The problem an `error` message of the Worker is: its code and message, and for a refused action its reason and place. */
export const problemOf = (action: Extract<Response, { type: "error" }>): Problem => ({
  id: action.id,
  code: action.code,
  message: action.message,
  ...(action.reason && { reason: action.reason }),
  ...(action.index !== undefined && { index: action.index }),
});

export interface LineageAsked {
  scenario: string;
  seed: number;
  architectures: string[];
  /** The key of the run (`runKeyOf`): a challenge started on the same run empties the view (plant_ui.md section 7, "As built in P5c"). */
  key: string;
}

export interface LineageState {
  /** The id of the request in flight. */
  running: number | null;
  asked: LineageAsked | null;
  answer: { view: LineageView; sample_ids: string[] } | null;
  problem: Problem | null;
}

export interface ChallengeMeta {
  variant: ChallengeVariant;
  scenario: string;
  seed: number;
  shown: string;
}

export interface ActiveChallenge extends ChallengeMeta {
  /** The id the Worker gave the challenge. */
  challenge: string;
  announced_type: string;
  record: RecordView | DecisionRecordView;
  inputs: RefValue[];
  /** The drill-down of the last sample the reader opened. */
  opened: { sample_id: string; sample: SampleRecord } | null;
  /** Present only after the guess or the give-up. */
  reveal: Reveal | null;
}

export type Busy = { id: number; kind: "open"; sample_id: string } | { id: number; kind: "guess" | "giveup" };

export interface ChallengeState {
  starting: { id: number; meta: ChallengeMeta; done: number; total: number } | null;
  active: ActiveChallenge | null;
  busy: Busy | null;
  problem: Problem | null;
}

export interface BreakoutAsked {
  case: string;
  seed: number;
  architectures: string[];
}

export interface BreakoutState {
  /** The id of the request in flight. */
  running: number | null;
  asked: BreakoutAsked | null;
  result: BreakoutResult | null;
  problem: Problem | null;
}

export type OneSeedAction =
  | { type: "lineage_started"; id: number; asked: LineageAsked }
  | { type: "breakout_started"; id: number; asked: BreakoutAsked }
  /** `key` is the key of the run the challenge is on (`runKeyOf` of its spec and seed): what the page holds of that run's truth is emptied. */
  | { type: "challenge_starting"; id: number; meta: ChallengeMeta; key: string }
  | { type: "challenge_busy"; busy: Busy }
  | { type: "challenge_reset" };

export const initialLineage: LineageState = { running: null, asked: null, answer: null, problem: null };
export const initialChallenge: ChallengeState = { starting: null, active: null, busy: null, problem: null };
export const initialBreakout: BreakoutState = { running: null, asked: null, result: null, problem: null };

export const reduceBreakout = (state: BreakoutState, action: Response | OneSeedAction): BreakoutState => {
  switch (action.type) {
    case "breakout_started":
      return { running: action.id, asked: action.asked, result: null, problem: null };
    case "breakout_result":
      return action.id === state.running ? { ...state, running: null, result: action.result, problem: null } : state;
    case "error":
      return action.id !== null && action.id === state.running ? { ...state, running: null, problem: problemOf(action) } : state;
    default:
      return state;
  }
};

export const reduceLineage = (state: LineageState, action: Response | OneSeedAction): LineageState => {
  switch (action.type) {
    case "lineage_started":
      return { running: action.id, asked: action.asked, answer: null, problem: null };
    case "lineage":
      return action.id === state.running ? { ...state, running: null, answer: { view: action.view, sample_ids: action.sample_ids }, problem: null } : state;
    case "challenge_starting":
      // the run is a challenge now: the view on screen, and a request for it still in flight, are not kept (a new request is `locked`, as before)
      return state.asked !== null && state.asked.key === action.key ? { ...state, running: null, answer: null, problem: null } : state;
    case "error":
      return action.id !== null && action.id === state.running ? { ...state, running: null, problem: problemOf(action) } : state;
    default:
      return state;
  }
};

export const reduceChallenge = (state: ChallengeState, action: Response | OneSeedAction): ChallengeState => {
  switch (action.type) {
    case "challenge_starting":
      return { starting: { id: action.id, meta: action.meta, done: 0, total: 0 }, active: null, busy: null, problem: null };
    case "challenge_reset":
      return initialChallenge;
    case "challenge_busy":
      return { ...state, busy: action.busy, problem: null };
    case "progress":
      return state.starting && action.id === state.starting.id ? { ...state, starting: { ...state.starting, done: action.done, total: action.total } } : state;
    case "challenge_ready": {
      if (!state.starting || action.id !== state.starting.id) return state;
      const { meta } = state.starting;
      return { starting: null, busy: null, problem: null, active: { ...meta, challenge: action.challenge, announced_type: action.announced_type, record: action.record, inputs: action.inputs, opened: null, reveal: null } };
    }
    case "sample_record":
      return state.active && state.busy?.kind === "open" && state.busy.id === action.id
        ? { ...state, busy: null, active: { ...state.active, opened: { sample_id: state.busy.sample_id, sample: action.sample } } }
        : state;
    case "challenge_reveal":
      return state.active && state.busy && state.busy.id === action.id ? { ...state, busy: null, active: { ...state.active, reveal: action.reveal } } : state;
    case "error": {
      const mine = (state.starting && action.id === state.starting.id) || (state.busy && action.id === state.busy.id);
      return mine ? { ...state, starting: null, busy: null, problem: problemOf(action) } : state;
    }
    default:
      return state;
  }
};

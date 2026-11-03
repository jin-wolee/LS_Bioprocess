import type { PlanSlot, PlantSpec, ScenePlan } from "../protocol.ts";
import type { Picked } from "./view.ts";

// The guided scene as data (docs/design/plant_ui.md section 3.5): the run it opens, the sample it follows, its five steps and what each step asks of the page. Pure functions of the scene plan: no clock,
// no DOM, no three.js, so Vitest runs them and the page only applies what they return. Every instant is read off the plan; none is typed here.

/** The run the tour opens: the scenario SC3 at seed 1, the three presets as halls, no action. */
export const TOUR_SPEC: PlantSpec = {
  run: { schema_version: "1", scenario: "sc03_feed_in_gap", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: [1] },
  seed: 1,
  actions: [],
};

/** The sample of the lineage rule `sc3`, as the plan has it: indices into the plan's arrays, the instants in seconds of the run. */
export interface TourSample {
  index: number;
  id: string;
  unit: number;
  drawn_s: number;
  /** The feeds of the sample's own unit from its draw to the start of its first run, both ends counting, earliest first. */
  feeds_in_gap: number[];
  run_started_s: number;
  ended_s: number;
  analyzer: number;
}

/**
 * The rule `sc3` of the lineage view (lab_ui.md section 19, item 3; single_sample_trace.md): the lowest sample id, in plain string order, whose interval from the draw to the start of its first run
 * contains a feed of its own unit, both ends counting. The first run is the first attempt's earliest visit. A draw the volume budget skipped, a sample no analyzer visited and a confirming sample have
 * no such interval. Null when no sample of the plan has one.
 */
export const tourSample = (plan: ScenePlan): TourSample | null => {
  const feeds = plan.marks.filter((m) => m.kind === "feed");
  const found = plan.samples.flatMap((s, index): TourSample[] => {
    const first = [...s.visits].sort((a, b) => a.attempt - b.attempt || a.started_s - b.started_s)[0];
    if (s.kind !== "routine" || s.skipped || s.drawn_s === null || first === undefined) return [];
    const drawn = s.drawn_s;
    const gap = feeds.filter((f) => f.unit === s.unit && f.t >= drawn && f.t <= first.run_started_s).map((f) => f.t).sort((a, b) => a - b);
    return gap.length === 0 ? [] : [{ index, id: s.id, unit: s.unit, drawn_s: drawn, feeds_in_gap: gap, run_started_s: first.run_started_s, ended_s: first.ended_s, analyzer: first.analyzer }];
  });
  return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
};

export type StepId = "draw" | "feed" | "run" | "records" | "truth";

/** One step: the instant the clock is held at, the object picked (its panel opens), the key the camera is brought to, and whether the record of the sample is opened and the overlay is asked for. */
export interface TourStep {
  id: StepId;
  t: number;
  pick: Picked | null;
  frame: string;
  record: boolean;
  truth: boolean;
  optional: boolean;
}

/** The five steps for the plan's sample, or none when it has no such sample. */
export const tourSteps = (plan: ScenePlan): TourStep[] => {
  const s = tourSample(plan);
  const unit = plan.units[s?.unit ?? -1];
  if (s === null || unit === undefined) return [];
  const reactor: Picked = { kind: "reactor", index: s.unit };
  const at = (id: StepId, t: number, pick: Picked | null, frame: string, last = false): TourStep => ({ id, t, pick, frame, record: last, truth: last, optional: last });
  return [
    at("draw", s.drawn_s, reactor, `station:${unit.id}`),
    at("feed", s.feeds_in_gap[0] as number, reactor, `station:${unit.id}`),
    at("run", s.run_started_s, { kind: "sample", index: s.index }, `sample:${s.id}`),
    at("records", s.ended_s, null, "halls:all"),
    at("truth", s.ended_s, null, "halls:all", true),
  ];
};

/** Whether the truth overlay is wanted at a step: at the step that asks for it, and otherwise as the reader had it when the tour began (`own`); with no step (the tour is over) it is the reader's own. */
export const wantTruth = (steps: readonly TourStep[], step: number, own: boolean): boolean => steps[step]?.truth === true || own;

/** The step after a press of Next (1) or Back (-1): null when Next is pressed on the last step (the tour is over); Back on the first step stays on it. */
export const stepAfter = (step: number, count: number, direction: 1 | -1): number | null => {
  const next = step + direction;
  return next >= count ? null : Math.max(0, next);
};

/** What the page knows when it asks whether a tour that is on is over by itself (see `tourEnds`). */
export interface TourWatch {
  /** The epoch of the plan the first step was applied to; null before that. */
  began: number | null;
  /** The epoch of the plan on screen. */
  epoch: number | null;
  /** The tour asked for its own run, and has seen that request in flight. */
  asked: boolean;
  sawBusy: boolean;
  /** No request is in flight, and whether the plan on screen is the answer to the tour's own spec. */
  settled: boolean;
  onRun: boolean;
}

/**
 * Whether a tour that is on is over by itself: the plan it was applied to was replaced by an answer that is not its own (an operator action, a link), or the run it asked for has been answered and is not
 * the tour's (a refusal puts the old spec back). A request that has not been seen in flight does not count as answered: the page may draw once between asking and the request showing.
 */
export const tourEnds = ({ began, epoch, asked, sawBusy, settled, onRun }: TourWatch): boolean => (began !== null && epoch !== began) || (asked && sawBusy && settled && !onRun);

/** What a key means to the tour: 1 (on) for the right and down arrows, -1 (back) for the left and up arrows, `skip` for Escape; null for any other key, which is not the tour's. */
export const tourKeyAction = (key: string): 1 | -1 | "skip" | null =>
  key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : key === "Escape" ? "skip" : null;

/** The card of the sample in one hall: its four slots (what the record stores, and for the context the time it joined by), or `pending` while the hall's record has not arrived. */
export type HallCard = { architecture: string; state: "card"; slots: PlanSlot[] } | { architecture: string; state: "pending" };

/**
 * A row for each hall of the layout, in its order: the sample's card in that hall from the plan, or pending when the record has not arrived. A record that holds no card of the sample is left out: a record
 * hall never shows an absence (section 3.3).
 */
export const cardsOf = (plan: ScenePlan, sample: number): HallCard[] =>
  plan.layout.architectures.flatMap((architecture): HallCard[] => {
    const record = plan.records.find((r) => r.architecture === architecture);
    if (record === undefined) return [{ architecture, state: "pending" }];
    const card = record.cards.find((c) => c.sample === sample);
    return card === undefined ? [] : [{ architecture, state: "card", slots: card.slots }];
  });

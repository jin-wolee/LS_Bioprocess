import type { Event } from "../../../generated/event.schema";
import type { BreakoutMetrics } from "../../../evaluate/breakout_metrics.ts";
import type { Metrics } from "../../../generated/metrics.schema";
import type { MaterialisedError } from "../../../inject/types.ts";
import { loadScenario } from "../../../scenario.ts";
import type { ScenarioConfig } from "../../../scenario.ts";
import type { ScenarioRun } from "../../../run.ts";
import { observeEvents } from "../../../observe.ts";
import type { ObservableEvent } from "../../../observe.ts";
import { parseArchitecture } from "../../../record/architecture.ts";
import type { Architecture } from "../../../record/architecture.ts";
import type { RecordedDataset } from "../../../record/types.ts";
import { ACTION_CLASS, applyActions, canonicalActions, parseActions } from "./actions.ts";
import type { Action, PlantBase, PlantRefusal } from "./actions.ts";
import { checkBounds } from "./action_bounds.ts";
import type { BreakoutResult } from "./breakout.ts";
import { checkSeed } from "./challenges.ts";
import type { Challenges } from "./challenges.ts";
import { layoutSpec, plannedIds, scenePlan } from "./plant_plan.ts";
import type { ScenePlan } from "./plant_plan.ts";
import { recordsOf } from "./plant_records.ts";
import type { PlanRecord } from "./plant_records.ts";
import { runSeed } from "../run_seed.ts";
import type { SeedInput } from "../run_seed.ts";
import { architecturesNamed, labSeedOf, materialisedOf } from "./seed_setup.ts";
import { scenarioConfig, scenarioDocument, useCapturePath } from "./setup.ts";
import type { LabData } from "./setup.ts";
import { checkRunSpec } from "./spec.ts";
import type { RunSpec } from "./spec.ts";
import { canonicalJson, canonicalJsonl, logHash, sha256Hex } from "../../../trace.ts";

// The `plant_run` request (docs/design/plant_ui.md sections 5 and 6): the Worker checks the list of operator actions against the run, applies it to a copy of the scenario document and the record
// halls, runs the truth and the recorders for one seed, and answers a scene plan with the hashes that prove what ran. The run is recomputed from its start each time; what is kept between two answers
// (`PlantKept`) stays in the Worker: the truth log of the last one, for the two checks of section 5.5, and the record halls built so far, for `plant_record` (plant_record.ts). `runPlant` builds every
// architecture in one call; the progressive answer the Worker gives (plant_stage.ts) is proven byte-equal to it.

export interface PlantSpec {
  /** `run.architectures` is the set of record halls; `run.seeds` is ignored (a plant run is one seed). */
  run: RunSpec;
  seed: number;
  actions: Action[];
}

export interface PlantAnswer {
  plan: ScenePlan;
  /** The first instant at which the list of actions differs from the previous answer's (0 for the first answer). */
  resume_at: number;
  /** The strict log hash of the truth run and the digest of the metric cells of each hall, by hall id (lab_ui.md section 7). */
  hashes: { truth: string; cells: Record<string, string> };
  /** `prefix_equal`: the events before the first changed plant action equal the previous answer's; `truth_equal`: a change of lab settings only left the truth log as it was. Null when the check does not apply. */
  checks: { prefix_equal: boolean | null; truth_equal: boolean | null };
}

/**
 * A record hall the Worker has built: the recorded dataset, the ids of the samples it holds a card of (the only samples the record panel may ask it about) and the errors the injector
 * materialised on this record, which the truth overlay lists for a sample (plant_truth.ts). The injector is a keyed function of the run, so reading its plain output when the hall is built
 * changes nothing, and the overlay needs no second look at the run.
 */
export interface KeptHall {
  dataset: RecordedDataset;
  cards: ReadonlySet<string>;
  materialised: readonly MaterialisedError[];
}

/** What the Worker keeps of a break-out case (plant_ui.md section 6, rule 11): which case it was asked with and the event as the Break-out screen prints it, for the pick `{ breakout: true }`. */
export interface KeptCase {
  case: string;
  /** The architectures as the request named them. */
  architectures: string[];
  event: BreakoutResult["event"];
}

/**
 * What the Worker keeps for the next answer and for `plant_record`. It never leaves the Worker: the page gets a plan, hashes and, on request, the rows of one card. `events` is the truth log;
 * `halls` holds the halls built so far, by architecture id, which a progressive answer fills one at a time.
 */
export interface PlantKept {
  actions: Action[];
  events: readonly Event[];
  halls: Map<string, KeptHall>;
  /** The checked run and its seed: the lock of a challenge is asked of them at the moment of a truth request. Null for a break-out case, which no challenge can be opened on. */
  run: RunSpec | null;
  seed: number;
  /** Present for a break-out case only. */
  breakout?: KeptCase;
  /** The ids of the planned samples in the order of the plan's `samples` (the placeholders of the truth overlay point into this order). */
  samples: string[];
}

export type PlantRunResult = { ok: true; answer: PlantAnswer; kept: PlantKept } | PlantRefusal;

const KEYS = ["run", "seed", "actions"];

/** A `plant_run` spec as a link carries it: user input, checked as `RunSpec` is, with the seed of a one-seed request and the list of actions. */
export const checkPlantSpec = (raw: unknown, data: LabData): { ok: true; spec: PlantSpec } | PlantRefusal => {
  const invalid = (message: string): PlantRefusal => ({ ok: false, code: "invalid_spec", message });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalid("the plant spec must be an object");
  const doc = raw as Record<string, unknown>;
  for (const key of Object.keys(doc)) if (!KEYS.includes(key)) return invalid(`unknown key "${key}"`);
  const run = checkRunSpec(doc.run, data);
  if (!run.ok) return invalid(run.message);
  if (run.spec.architectures.length === 0) return invalid("the plant needs at least one record hall (architectures)");
  const seed = checkSeed(doc.seed);
  if (!seed.ok) return invalid(seed.message);
  const actions = parseActions(doc.actions ?? []);
  if (!actions.ok) return actions;
  return { ok: true, spec: { run: run.spec, seed: seed.seed, actions: actions.actions } };
};

const actionKey = (a: Action): string => canonicalJson(a);

/**
 * The queue's own ordinal: `seq` of a `request_queued` event is the tie-break number of the analyzer's event queue, which starts above the numbers of the requests and which the start and the end of every
 * window take two of before the run, so one more window moves the number of every request that is queued again, earlier in the run too. It is not something that happened: no time, type or id changes.
 */
const unnumbered = (e: Event): Event => (e.type === "request_queued" ? { ...e, seq: 0 } : e);

/** Compare two logs on the events before `before` (infinity: all of them); `labels` leaves out the `label_bound` events, which the labelling method itself writes (plant_ui.md section 5.3). */
const sameLog = (a: readonly Event[], b: readonly Event[], before: number, labels: boolean): boolean => {
  const part = (log: readonly Event[]): Event[] => log.filter((e) => e.t < before && (labels || e.type !== "label_bound")).map(unnumbered);
  return canonicalJsonl(part(a)) === canonicalJsonl(part(b));
};

/** The checks of section 5.5 against the previous answer, and the instant the view resumes at. */
export const compare = (previous: PlantKept | undefined, actions: readonly Action[], events: readonly Event[]): Pick<PlantAnswer, "resume_at" | "checks"> => {
  if (!previous) return { resume_at: 0, checks: { prefix_equal: null, truth_equal: null } };
  const before = new Set(previous.actions.map(actionKey));
  const now = new Set(actions.map(actionKey));
  const changed = [...previous.actions.filter((a) => !now.has(actionKey(a))), ...actions.filter((a) => !before.has(actionKey(a)))];
  const plant = changed.filter((a) => ACTION_CLASS[a.kind] === "plant");
  // set_labelling is the one lab setting in the truth log: the logs are compared without the label_bound events it writes
  const labels = changed.some((a) => a.kind === "set_labelling");
  return {
    resume_at: changed.length === 0 ? 0 : Math.min(...changed.map((a) => a.at)),
    checks: {
      prefix_equal: plant.length === 0 ? null : sameLog(previous.events, events, Math.min(...plant.map((a) => a.at)), !labels),
      truth_equal: changed.length === 0 || plant.length > 0 ? null : sameLog(previous.events, events, Number.POSITIVE_INFINITY, !labels),
    },
  };
};

/** The truth stage of a checked spec: the scenario with the actions applied, the truth run, and the input the recorders are given. Nothing of the records is built yet. */
export interface PlantTruth {
  spec: PlantSpec;
  config: ScenarioConfig;
  run: ScenarioRun;
  input: SeedInput;
  events: ObservableEvent[];
  architectures: Architecture[];
  /** The ids of the planned samples, in string order: the cards of every hall point into this list. */
  samples: string[];
}

/**
 * The truth run of a checked spec. A refusal of the plant's own (section 5.6) comes back as a refusal; an error of the engine (a value it rejects) is thrown with the engine's message, and the
 * Worker posts it as `engine_error`.
 */
export const truthOf = (data: LabData, spec: PlantSpec): { ok: true; truth: PlantTruth } | PlantRefusal => {
  const { run: runSpec, seed, actions } = spec;
  const extras = { ...(runSpec.bay_profiles && { bay_profiles: runSpec.bay_profiles }), ...(runSpec.analyzer_profiles && { analyzer_profiles: runSpec.analyzer_profiles }) };
  const seen = scenarioConfig(data, runSpec.scenario, runSpec.settings, seed, { ...extras, ...(runSpec.capture_path && { capture_path: runSpec.capture_path }) });
  const refusal = checkBounds(seen, seed, runSpec.architectures, actions);
  if (refusal) return refusal;

  const base: PlantBase = {
    scenario: scenarioDocument(data, runSpec.scenario, runSpec.settings, extras),
    capture_path: runSpec.capture_path,
    architectures: architecturesNamed(data, runSpec.architectures).map((a) => parseArchitecture(a)),
  };
  const applied = applyActions(base, actions);
  if (applied.capture_path) useCapturePath(data, applied.scenario, applied.capture_path);
  const config = { ...loadScenario(applied.scenario, data.lookup), seed };
  const { run, input } = labSeedOf(data, runSpec, config, applied.architectures);
  const events = observeEvents(run.events);
  return { ok: true, truth: { spec, config, run, input, events, architectures: applied.architectures, samples: plannedIds(events) } };
};

/** The scene plan of a truth run with the halls built so far (the records of the architectures that are ready, in the order of the spec). */
export const planOf = (data: LabData, t: PlantTruth, records: PlanRecord[]): ScenePlan =>
  scenePlan({
    seed: t.spec.seed, cfg: t.config, events: t.events, operators: t.run.operators.map((o) => o.operator_id), windows: t.run.l3Input.windows,
    layout: layoutSpec(data, t.spec.run, t.config, t.architectures.map((a) => a.id)), records,
  });

/** The digest of the metric cells of one hall (lab_ui.md section 7); for a break-out case the cell is the Break-out screen's `BreakoutMetrics`. */
export const cellsDigest = (cell: Metrics | BreakoutMetrics): Promise<string> => sha256Hex(canonicalJson(cell));

/** The answer a run is compared with: the previous one, unless that was a break-out case (a different kind of run, whose log a plant run has nothing to say about). */
export const previousRun = (previous: PlantKept | undefined): PlantKept | undefined => (previous?.breakout ? undefined : previous);

/** What the Worker keeps of a built hall: its dataset, the samples it holds a card of and the errors the injector materialised on it. */
export const keptHall = (dataset: RecordedDataset, record: PlanRecord, samples: readonly string[], materialised: readonly MaterialisedError[]): KeptHall =>
  ({ dataset, cards: new Set(record.cards.map((c) => samples[c.sample] as string)), materialised });

/** The kept state of an answer that has no halls yet; the answer adds them. */
export const keptOf = (t: PlantTruth): PlantKept =>
  ({ actions: canonicalActions(t.spec.actions).map((n) => n.action), events: t.run.events, halls: new Map(), run: t.spec.run, seed: t.spec.seed, samples: t.samples });

/**
 * Run a checked spec in one build: the truth run, then every architecture in one call of the recorders. This is the whole answer at once, and the reference that the progressive answer of
 * `plant_stage.ts` is proven equal to (docs/design/plant_ui.md section 5.5). `previous` is what the last answer kept.
 */
export const runPlant = async (data: LabData, spec: PlantSpec, previous?: PlantKept): Promise<PlantRunResult> => {
  const made = truthOf(data, spec);
  if (!made.ok) return made;
  const t = made.truth;
  const out = runSeed(t.input);
  const ids = t.architectures.map((a) => a.id);
  const datasets = t.architectures.map((a) => out.datasets[a.id] as RecordedDataset);
  const records = recordsOf(datasets, t.samples);
  const cells = Object.fromEntries(await Promise.all(out.cells.map(async (cell, i) => [ids[i] as string, await cellsDigest(cell)] as const)));
  const kept = keptOf(t);
  const materialised = materialisedOf(t.input);
  for (const [i, id] of ids.entries()) kept.halls.set(id, keptHall(datasets[i] as RecordedDataset, records[i] as PlanRecord, t.samples, materialised[id] as MaterialisedError[]));
  return {
    ok: true,
    answer: { plan: planOf(data, t, records), ...compare(previousRun(previous), spec.actions, t.run.events), hashes: { truth: await logHash(t.run.events), cells } },
    kept,
  };
};

/**
 * The `plant_run` request as the Worker receives it: the spec is user input and is checked; a run that is an unrevealed challenge is locked, so the plant cannot be used to read the truth of a
 * challenge in progress (lab_ui.md section 4, rule 2).
 */
export const checkPlantRequest = (data: LabData, challenges: Challenges, raw: { spec: unknown }): { ok: true; spec: PlantSpec } | PlantRefusal => {
  const checked = checkPlantSpec(raw.spec, data);
  if (!checked.ok) return checked;
  if (challenges.locked(checked.spec.run, checked.spec.seed)) return { ok: false, code: "locked", message: "this run is a challenge that has not been revealed; the plant of it opens after the guess or the give-up" };
  return checked;
};

/** `checkPlantRequest`, then the actions are checked against the run and the run is made in one build (`runPlant`). */
export const answerPlantRun = async (data: LabData, challenges: Challenges, raw: { spec: unknown }, previous?: PlantKept): Promise<PlantRunResult> => {
  const checked = checkPlantRequest(data, challenges, raw);
  return checked.ok ? runPlant(data, checked.spec, previous) : checked;
};

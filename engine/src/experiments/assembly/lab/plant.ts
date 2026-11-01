import type { Event } from "../../../generated/event.schema";
import { loadScenario } from "../../../scenario.ts";
import { observeEvents } from "../../../observe.ts";
import { parseArchitecture } from "../../../record/architecture.ts";
import type { RecordedDataset } from "../../../record/types.ts";
import { ACTION_CLASS, applyActions, canonicalActions, parseActions } from "./actions.ts";
import type { Action, PlantBase, PlantRefusal } from "./actions.ts";
import { checkBounds } from "./action_bounds.ts";
import { checkSeed } from "./challenges.ts";
import type { Challenges } from "./challenges.ts";
import { layoutSpec, plannedIds, scenePlan } from "./plant_plan.ts";
import type { ScenePlan } from "./plant_plan.ts";
import { recordsOf } from "./plant_records.ts";
import { runSeed } from "../run_seed.ts";
import { architecturesNamed, labSeedOf } from "./seed_setup.ts";
import { scenarioConfig, scenarioDocument, useCapturePath } from "./setup.ts";
import type { LabData } from "./setup.ts";
import { checkRunSpec } from "./spec.ts";
import type { RunSpec } from "./spec.ts";
import { canonicalJson, canonicalJsonl, logHash, sha256Hex } from "../../../trace.ts";

// The `plant_run` request (docs/design/plant_ui.md sections 5 and 6): the Worker checks the list of operator actions against the run, applies it to a copy of the scenario document and the record
// halls, runs the truth and the recorders for one seed, and answers a scene plan with the hashes that prove what ran. The run is recomputed from its start each time; the only thing kept between
// two answers is the truth log of the last one (`PlantKept`), which stays in the Worker and is used for the two checks of section 5.5.

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

/** What the Worker keeps for the next answer. Truth side: it is never sent. */
export interface PlantKept {
  actions: Action[];
  events: readonly Event[];
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

/** Compare two logs on the events before `before` (infinity: all of them); `labels` leaves out the `label_bound` events, which the labelling method itself writes (plant_ui.md section 5.3). */
const sameLog = (a: readonly Event[], b: readonly Event[], before: number, labels: boolean): boolean => {
  const part = (log: readonly Event[]): Event[] => log.filter((e) => e.t < before && (labels || e.type !== "label_bound"));
  return canonicalJsonl(part(a)) === canonicalJsonl(part(b));
};

/** The checks of section 5.5 against the previous answer, and the instant the view resumes at. */
const compare = (previous: PlantKept | undefined, actions: readonly Action[], events: readonly Event[]): Pick<PlantAnswer, "resume_at" | "checks"> => {
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

/**
 * Run a checked spec. A refusal of the plant's own (section 5.6) comes back as a refusal; an error of the engine (a value it rejects) is thrown with the engine's message, and the Worker
 * posts it as `engine_error`. `previous` is what the last answer kept.
 */
export const runPlant = async (data: LabData, spec: PlantSpec, previous?: PlantKept): Promise<PlantRunResult> => {
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
  const out = runSeed(input);

  const events = observeEvents(run.events);
  const datasets = applied.architectures.map((a) => out.datasets[a.id] as RecordedDataset);
  const ids = applied.architectures.map((a) => a.id);
  const plan = scenePlan({
    seed, cfg: config, events, operators: run.operators.map((o) => o.operator_id), windows: run.l3Input.windows,
    layout: layoutSpec(data, runSpec, config, ids), records: recordsOf(datasets, plannedIds(events)),
  });
  const cells = Object.fromEntries(await Promise.all(out.cells.map(async (cell, i) => [ids[i] as string, await sha256Hex(canonicalJson(cell))] as const)));
  return {
    ok: true,
    answer: { plan, ...compare(previous, actions, run.events), hashes: { truth: await logHash(run.events), cells } },
    kept: { actions: canonicalActions(actions).map((n) => n.action), events: run.events },
  };
};

/**
 * The `plant_run` request as the Worker receives it: the spec is user input and is checked; a run that is an unrevealed challenge is locked, so the plant cannot be used to read the truth of a
 * challenge in progress (lab_ui.md section 4, rule 2); then the actions are checked against the run and the run is made.
 */
export const answerPlantRun = async (data: LabData, challenges: Challenges, raw: { spec: unknown }, previous?: PlantKept): Promise<PlantRunResult> => {
  const checked = checkPlantSpec(raw.spec, data);
  if (!checked.ok) return checked;
  if (challenges.locked(checked.spec.run, checked.spec.seed)) return { ok: false, code: "locked", message: "this run is a challenge that has not been revealed; the plant of it opens after the guess or the give-up" };
  return runPlant(data, checked.spec, previous);
};

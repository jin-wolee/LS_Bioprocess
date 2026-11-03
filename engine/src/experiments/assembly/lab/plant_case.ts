import type { BreakoutMetrics } from "../../../evaluate/breakout_metrics.ts";
import type { MaterialisedError } from "../../../inject/types.ts";
import type { ObservableEvent } from "../../../observe.ts";
import { unitIdOf } from "../../../process.ts";
import type { Architecture } from "../../../record/architecture.ts";
import { blockOf, breakoutTruth, investigateArchitectures } from "../breakout.ts";
import type { ArchitectureRun, BreakoutCase, BreakoutTruth } from "../breakout.ts";
import { eventOf } from "../breakout_inputs.ts";
import { breakoutAsk, breakoutRunOf, eventsOf } from "./breakout.ts";
import type { BreakoutAsk } from "./breakout.ts";
import { canonicalActions } from "./actions.ts";
import type { Action, PlantRefusal } from "./actions.ts";
import { cellsDigest, compare, keptHall } from "./plant.ts";
import type { KeptHall, PlantAnswer, PlantKept, PlantRunResult } from "./plant.ts";
import { caseLayoutSpec, itemsOf, plannedIds, scenePlan } from "./plant_plan.ts";
import type { LayoutSpec, ScenePlan } from "./plant_plan.ts";
import { recordsOf } from "./plant_records.ts";
import type { PlanHold, PlanRecord } from "./plant_records.ts";
import type { PlantHall, PlantStaged } from "./plant_stage.ts";
import { materialisedOf } from "./seed_setup.ts";
import type { LabData, ScenarioDoc } from "./setup.ts";

// The break-out case as a plant run (docs/design/plant_ui.md section 6, rule 11; spec 11.8.14). A `plant_run` whose spec has a `case` is one of the five SC12 scenarios, run by the functions the
// Break-out screen runs: the truth once (`breakoutTruth`), then each architecture recorded, investigated from the first signal and scored (`investigateArchitectures`). So the truth hash is the
// screen's `truth_log_hash` and the digest of a hall's cell is the digest of the cell its rows are made from. The plan is built from the observable events (plant_plan.ts) and each hall adds the holds of
// its own investigation, which are a record's decisions and so differ from one architecture to the next. `stageCase` answers progressively as `stagePlant` does, and `runPlantCase` builds every
// architecture in one call and is the reference the progressive answer is proven equal to.

export interface PlantCaseSpec {
  case: string;
  /** The set of record halls, in the order of the list. */
  architectures: string[];
  seed: number;
  actions: Action[];
}

const KEYS = ["case", "architectures", "seed", "actions"];

/** A `plant_run` spec is a break-out case when it has a `case` key. */
export const isCaseSpec = (raw: unknown): boolean => typeof raw === "object" && raw !== null && !Array.isArray(raw) && "case" in raw;

export type CaseChecked = { ok: true; spec: PlantCaseSpec; ask: BreakoutAsk };

/** A case as a link carries it: user input, checked exactly as the `breakout` request is (`breakoutAsk`), so a build with no SC12 file refuses it with the same code and message. */
export const checkCaseSpec = (data: LabData, raw: unknown): CaseChecked | PlantRefusal => {
  const invalid = (message: string): PlantRefusal => ({ ok: false, code: "invalid_spec", message });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalid("the plant spec must be an object");
  const doc = raw as Record<string, unknown>;
  for (const key of Object.keys(doc)) if (!KEYS.includes(key)) return invalid(`unknown key "${key}"`);
  const asked = breakoutAsk(data, { case: doc.case, architectures: doc.architectures, seed: doc.seed, actions: doc.actions ?? [] });
  if (!asked.ok) return asked;
  return { ok: true, ask: asked.ask, spec: { case: asked.ask.case_id, architectures: doc.architectures as string[], seed: asked.ask.seed, actions: asked.ask.actions } };
};

/** The truth stage of a checked case: the shared truth run and everything the halls are made from. Nothing of the records is built yet. */
interface CaseTruth {
  spec: PlantCaseSpec;
  ask: BreakoutAsk;
  c: BreakoutCase;
  truth: BreakoutTruth;
  events: readonly ObservableEvent[];
  architectures: Architecture[];
  /** The ids of the planned samples, in string order: the cards of every hall point into this list, and the confirming samples follow them in the plan. */
  samples: string[];
  layout: LayoutSpec;
}

const caseTruthOf = async (data: LabData, checked: CaseChecked): Promise<CaseTruth> => {
  const { ask, spec } = checked;
  const { c, input, review } = breakoutRunOf(data, ask);
  const truth = await breakoutTruth(c, ask.seed, input, review);
  const events = truth.input.events;
  const architectures = ask.architectures;
  return { spec, ask, c, truth, events, architectures, samples: plannedIds(events), layout: caseLayoutSpec(ask.doc as unknown as ScenarioDoc, c.scenario, architectures.map((a) => a.id), events) };
};

/** The plan of a case with the halls built so far. */
const planOfCase = (t: CaseTruth, records: PlanRecord[]): ScenePlan =>
  scenePlan({
    seed: t.ask.seed, cfg: t.c.scenario, events: t.events, operators: t.truth.run.operators.map((o) => o.operator_id), windows: t.truth.run.l3Input.windows, layout: t.layout, records,
  });

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order in which the events of one instant are listed: a hold is placed, then decided, and the deviation is closed last. */
const EVENT_ORDER = ["hold_placed", "result_reflagged", "hold_quarantined", "hold_released", "hold_rejected", "deviation_closed"] as const;
const ON_ORDER = ["unit", "lot", "equipment", "sample"] as const;

/** What the investigation of a record did, as the plan lists it: the Break-out screen's own events, each hold on the index of the item in the plan, identical entries merged, in time order. */
const holdsOf = (t: CaseTruth, run: ArchitectureRun): PlanHold[] => {
  const units = new Map(Array.from({ length: t.c.scenario.process.reactors }, (_, i) => [unitIdOf(i), i] as const));
  const batchUnit = new Map(t.events.flatMap((e) => (e.type === "inoculation" ? [[e.batch_id, units.get(e.unit_id) as number] as const] : [])));
  const items = itemsOf(t.events);
  const lots = [...items.lots.keys()].sort(byText);
  const equipment = [...items.equipment.keys()].sort(byText);
  const planned = new Map(t.samples.map((id, i) => [id, i]));
  const requestOf = new Map(run.investigation.dataset.result.map((r) => [r.result_id, r.request_id]));
  const found = (what: string, i: number | undefined): number => i ?? ((): never => { throw new Error(`plant: ${what} is not in the plan`); })();
  const sampleOf = (result_id: string): number => found(`result ${result_id}`, planned.get(requestOf.get(result_id) as string));
  const holds = eventsOf(run.investigation).map((e): PlanHold => {
    if (e.type === "deviation_closed") return { t: e.t, event: e.type, on: null, target: null };
    if (e.type === "result_reflagged") return { t: e.t, event: e.type, on: "sample", target: sampleOf(e.result_id as string) };
    const id = e.target_id as string;
    switch (e.target_kind) {
      case "batch": return { t: e.t, event: e.type, on: "unit", target: found(`batch ${id}`, batchUnit.get(id)) };
      case "material_lot": return { t: e.t, event: e.type, on: "lot", target: found(`lot ${id}`, lots.indexOf(id) < 0 ? undefined : lots.indexOf(id)) };
      case "equipment": return { t: e.t, event: e.type, on: "equipment", target: found(`equipment ${id}`, equipment.indexOf(id) < 0 ? undefined : equipment.indexOf(id)) };
      default: return { t: e.t, event: e.type, on: "sample", target: sampleOf(id) };
    }
  });
  const seen = new Set<string>();
  return holds
    .filter((h) => {
      const key = JSON.stringify(h);
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .sort((a, b) => a.t - b.t || EVENT_ORDER.indexOf(a.event) - EVENT_ORDER.indexOf(b.event) || (a.on === null ? -1 : ON_ORDER.indexOf(a.on)) - (b.on === null ? -1 : ON_ORDER.indexOf(b.on)) || (a.target ?? -1) - (b.target ?? -1));
};

/** One hall of a case: its record for the plan (the cards of the dataset as recorded, and its holds), what the Worker keeps of it, and its scored cell. */
const hallOf = (t: CaseTruth, run: ArchitectureRun, architecture: Architecture): { record: PlanRecord; kept: KeptHall; cell: BreakoutMetrics } => {
  const [made] = recordsOf([run.dataset], t.samples);
  const record: PlanRecord = { ...(made as PlanRecord), holds: holdsOf(t, run) };
  const errors = materialisedOf({ ...t.truth.input, architectures: [architecture] })[architecture.id] as MaterialisedError[];
  return { record, kept: keptHall(run.dataset, record, t.samples, errors), cell: run.cell };
};

const keptOfCase = (t: CaseTruth): PlantKept => ({
  actions: canonicalActions(t.spec.actions).map((n) => n.action),
  events: t.truth.run.events,
  halls: new Map(),
  run: null,
  seed: t.ask.seed,
  samples: t.samples,
  breakout: { case: t.spec.case, architectures: t.spec.architectures, event: eventOf(t.c, blockOf(t.c)) },
});

/** The previous answer when it was this very case, seed and set of halls; any other answer says nothing about this one (both checks null, the view resumes from the start). */
const sameCase = (previous: PlantKept | undefined, spec: PlantCaseSpec): PlantKept | undefined => {
  const kept = previous?.breakout;
  return previous !== undefined && kept?.case === spec.case && previous.seed === spec.seed && kept.architectures.join() === spec.architectures.join() ? previous : undefined;
};

/** The progressive answer of a case (the model is `stagePlant`): the truth and the first hall at once, the others one at a time in the order of the list. */
export const stageCase = async (data: LabData, checked: CaseChecked, previous?: PlantKept): Promise<PlantStaged> => {
  const t = await caseTruthOf(data, checked);
  const kept = keptOfCase(t);
  const build = (k: number) => async (): Promise<PlantHall> => {
    const architecture = t.architectures[k] as Architecture;
    const [run] = investigateArchitectures(t.truth, [architecture]);
    const hall = hallOf(t, run as ArchitectureRun, architecture);
    kept.halls.set(architecture.id, hall.kept);
    return { records: [hall.record], cells: { [architecture.id]: await cellsDigest(hall.cell) } };
  };
  const first = await build(0)();
  return {
    ok: true,
    answer: { plan: planOfCase(t, first.records), ...compare(sameCase(previous, t.spec), t.spec.actions, t.truth.run.events), hashes: { truth: t.truth.truth_log_hash, cells: first.cells } },
    kept,
    halls: t.architectures.slice(1).map((_, k) => build(k + 1)),
  };
};

/** Every architecture in one call of `investigateArchitectures`: the reference that the progressive answer is proven byte-equal to. */
export const runPlantCase = async (data: LabData, checked: CaseChecked, previous?: PlantKept): Promise<PlantRunResult> => {
  const t = await caseTruthOf(data, checked);
  const kept = keptOfCase(t);
  const runs = investigateArchitectures(t.truth, t.architectures);
  const halls = runs.map((run, i) => hallOf(t, run, t.architectures[i] as Architecture));
  for (const [i, hall] of halls.entries()) kept.halls.set((t.architectures[i] as Architecture).id, hall.kept);
  const cells = Object.fromEntries(await Promise.all(halls.map(async (hall, i) => [(t.architectures[i] as Architecture).id, await cellsDigest(hall.cell)] as const)));
  const answer: PlantAnswer = { plan: planOfCase(t, halls.map((h) => h.record)), ...compare(sameCase(previous, t.spec), t.spec.actions, t.truth.run.events), hashes: { truth: t.truth.truth_log_hash, cells } };
  return { ok: true, answer, kept };
};

/** The `plant_run` request of a case: checked, then run in one build. */
export const answerPlantCase = async (data: LabData, raw: unknown, previous?: PlantKept): Promise<PlantRunResult> => {
  const checked = checkCaseSpec(data, raw);
  return checked.ok ? runPlantCase(data, checked, previous) : checked;
};

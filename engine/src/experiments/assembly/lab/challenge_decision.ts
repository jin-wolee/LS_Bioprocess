import { evaluationSettings } from "../../../evaluate/config.ts";
import type { EvaluationSettings } from "../../../evaluate/config.ts";
import { prevented } from "../../../inject/catalogue.ts";
import { DRAWN_TYPES } from "../../../inject/types.ts";
import type { ForcedError, MaterialisedError } from "../../../inject/types.ts";
import type { Architecture } from "../../../record/architecture.ts";
import { runScenario } from "../../../run.ts";
import type { ScenarioRun } from "../../../run.ts";
import type { ScenarioConfig } from "../../../scenario.ts";
import { recordedContext } from "../../arms/closed_loop.ts";
import { DECIDING_FLAG } from "./challenge_sample.ts";
import type { DecisionRecordView, Reveal, Score } from "./challenge_types.ts";
import { pickDecisionPlant } from "./decision_plant.ts";
import { decisionTruth, differingDecisions, recordOf, runDecisionLoop } from "./decisions.ts";
import type { DecisionLoop } from "./decisions.ts";
import { lineageView, sampleRecordOf } from "./lineage.ts";
import type { SampleRecord } from "./lineage.ts";
import { affectedOf, outcomeOf } from "./outcome.ts";
import { sampleTruth } from "./pick.ts";
import { findingRows, flagsOn, sampleRows } from "./record_view.ts";
import { architecturesNamed, comparedWith } from "./seed_setup.ts";
import { scenarioConfig } from "./setup.ts";
import type { LabData } from "./setup.ts";
import type { RunSpec } from "./spec.ts";

// 2026-10-30 S3e, the decision variant of the challenge (docs/design/lab_ui.md section 9, "The decision variant"; section 18). SC8, one seed, A or C without `system_issued_id`: the closed loop
// of the shown architecture runs twice, without and with a planted label error (S3d's functions), and the reader looks for the decision that was made on the wrong input. The page receives
// the decisions of the planted loop as the record holds them; the affected set, the truth of each row and the other architectures stay here until the guess.

/** The id of the scenario of the decision variant (SC8; it is not in the Setup picker): the one its bundled document carries, so that the engine names no scenario. Empty when the build has none. */
export const decisionScenarioId = (data: LabData): string => (data.decision?.scenario as { scenario_id?: string } | undefined)?.scenario_id ?? "";

export interface DecisionChallenge {
  variant: "decision";
  shown: string;
  plant: ForcedError;
  unplanted: DecisionLoop;
  planted: DecisionLoop;
  /** The decision ids of the affected set, in the order of the decision list. */
  affected: string[];
  /** The hold above which a value is known to be biased (A046). */
  hold_limit_s: number;
  /** What the reveal needs to run the other architectures on the same lab run. */
  scenario: ScenarioConfig;
  seed: number;
  evaluation: EvaluationSettings;
  run: ScenarioRun;
  compared: Architecture[];
}

export type DecisionStart = { ok: true; challenge: DecisionChallenge; announced_type: string; record: DecisionRecordView } | { ok: false; message: string };

/** The data with SC8 among its scenarios, so that the spec checks and `scenarioConfig` read it like any scenario. Null when the build does not bundle the decision variant. */
export const withDecisionScenario = (data: LabData): LabData | null => (data.decision ? { ...data, scenarios: { ...data.scenarios, [decisionScenarioId(data)]: data.decision.scenario } } : null);

/** The seed list of experiment 2 (the neutral integers the page offers for this variant). */
export const decisionSeeds = (data: LabData): number[] => ((data.decision?.experiment as { seeds?: number[] } | undefined)?.seeds ?? []).slice();

/**
 * The decisions of the planted loop that read a row of the planted sample or of the neighbour whose id it took (by the id the row is filed under or the sample it stands for), or whose
 * action or row differs from the same tick of the unplanted loop. Action and row are compared, not values (section 9).
 */
export const affectedDecisions = (planted: DecisionLoop, unplanted: DecisionLoop, plant: ForcedError): string[] => {
  const pair = new Set(affectedOf(plant));
  const differing = new Set(differingDecisions(unplanted.decisions, planted.decisions));
  return planted.decisions
    .filter((d) => differing.has(d.decision_id) || (d.read !== null && (pair.has(d.read.filed_under) || pair.has(decisionTruth(planted, d.decision_id)?.from_sample ?? ""))))
    .map((d) => d.decision_id);
};

/** The record view of the planted loop: its decisions as the record holds them, the samples with a pH result, the findings of the record's own rules. */
export const decisionRecordView = (loop: DecisionLoop): DecisionRecordView => {
  const ds = recordOf(loop);
  const withPh = new Set(ds.result.filter((r) => r.analyte === "ph").map((r) => r.request_id));
  const samples = sampleRows(ds).filter((s) => withPh.has(s.sample_id));
  return {
    architecture: loop.architecture,
    flags_on: flagsOn(ds),
    samples: samples.map((s) => {
      const context = recordedContext(ds, s.sample_id);
      return { ...s, container: context.container, hold_s: context.hold_time_s };
    }),
    decisions: loop.decisions.map((d) => ({
      decision_id: d.decision_id, unit_id: d.unit_id, t: d.t, action: d.action,
      read: d.read && { filed_under: d.read.filed_under, measured_at: d.read.measured_at, value: d.read.value, container: d.read.container, hold_s: d.read.hold_s, state: d.read.state },
      onto: d.onto, reason: d.reason,
    })),
    findings: findingRows(ds),
  };
};

/**
 * Run the closed loop of the shown architecture without and with the plant and pick the plant. The caller has checked the spec and the seed. `onProgress` is told after each of the two loops.
 * The spec's settings replace those of SC8; the architecture must not prevent the label error (`system_issued_id` off): A, or C without it.
 */
export const startDecisionChallenge = (data: LabData, spec: RunSpec, seed: number, shown: string, onProgress?: (done: number, total: number) => void): DecisionStart => {
  const withSc8 = withDecisionScenario(data);
  if (!withSc8) return { ok: false, message: "the decision variant is not offered by this build" };
  const [architecture] = architecturesNamed(withSc8, [shown]);
  if (!architecture) return { ok: false, message: `unknown architecture ${JSON.stringify(shown)}` };
  if (prevented("label_error", architecture.flags)) return { ok: false, message: `${shown} cannot be shown: system_issued_id is on, so a label error never arises in this record` };
  const scenario = scenarioConfig(withSc8, decisionScenarioId(data), spec.settings, seed);
  const evaluation = evaluationSettings(data.evaluation);
  const run = runScenario({ ...scenario, seed, feedback: false });
  const unplanted = runDecisionLoop({ scenario, seed, evaluation, architecture, run });
  onProgress?.(1, 2);
  const plant = pickDecisionPlant(seed, unplanted);
  if (plant === null) return { ok: false, message: "no decision of this run reads a sample that the planted error could be placed on" };
  const planted = runDecisionLoop({ scenario, seed, evaluation, architecture, run, forced: [plant] });
  onProgress?.(2, 2);
  const challenge: DecisionChallenge = {
    variant: "decision", shown, plant, unplanted, planted, affected: affectedDecisions(planted, unplanted, plant), hold_limit_s: evaluation.hold_limit_s,
    scenario, seed, evaluation, run, compared: comparedWith(data, shown),
  };
  return { ok: true, challenge, announced_type: plant.type, record: decisionRecordView(planted) };
};

/** The drill-down of section 8 for one sample of the shown record, without truth, verdicts, realised errors or pH values; null for an id the record does not hold. */
export const openDecisionSample = (c: DecisionChallenge, sample_id: string): SampleRecord | null => {
  const ds = recordOf(c.planted);
  return ds.sample.some((s) => s.sample_id === sample_id) ? sampleRecordOf(ds, sample_id, { hide_ph_values: true }) : null;
};

/** Whether the shown record holds a decision of this id (the page guesses among them). */
export const hasDecision = (c: DecisionChallenge, decision_id: string): boolean => c.planted.decisions.some((d) => d.decision_id === decision_id);

/** background: the decision rests on a sample with a structural error of the shown record, else on a value SC8 biases by construction (an open container, A064; a hold above A046). */
const scoreOf = (c: DecisionChallenge, decision_id: string): Score => {
  if (c.affected.includes(decision_id)) return { result: "hit" };
  const truth = decisionTruth(c.planted, decision_id);
  if (truth === null) return { result: "miss" };
  const structural = c.planted.materialised.find((m: MaterialisedError) => m.sample_id === truth.from_sample && !(DRAWN_TYPES as readonly string[]).includes(m.type));
  if (structural) return { result: "background", background_type: structural.type };
  if (truth.container === "open") return { result: "background", background_type: "technique_error" };
  if (truth.hold_s > c.hold_limit_s) return { result: "background", background_type: "hold_over_limit" };
  return { result: "miss" };
};

/**
 * The reveal: the planted error, the score (none after a give-up), the affected decisions with the row each read and the truth behind it, the outcome of the same label error in A, B, C and
 * the shown architecture (and whether the decision at the affected ticks is the same as in that architecture's unplanted loop), and the lineage of the planted sample.
 */
export const revealDecision = (c: DecisionChallenge, guess: string | null): Reveal => {
  const loops = c.compared.map((a) => {
    if (a.id === c.shown) return { architecture: a, unplanted: c.unplanted, planted: c.planted };
    const run = { scenario: c.scenario, seed: c.seed, evaluation: c.evaluation, architecture: a, run: c.run };
    return { architecture: a, unplanted: runDecisionLoop(run), planted: runDecisionLoop({ ...run, forced: [c.plant] }) };
  });
  const flag = DECIDING_FLAG.label_error;
  const truth = sampleTruth(c.run, c.plant.sample_id);
  if (truth === null) throw new Error(`challenge: the planted sample ${c.plant.sample_id} is not in the run`);
  const datasets = loops.map((l) => recordOf(l.planted));
  const materialised = Object.fromEntries(loops.map((l) => [l.architecture.id, l.planted.materialised]));
  const entry = c.planted.materialised.find((m) => m.type === c.plant.type && m.sample_id === c.plant.sample_id);
  return {
    planted: { type: c.plant.type, affected: affectedOf(c.plant), detail: { ...(entry?.detail ?? {}) } },
    score: guess === null ? null : scoreOf(c, guess),
    per_architecture: loops.map((l, i) => {
      const differing = new Set(differingDecisions(l.unplanted.decisions, l.planted.decisions));
      return {
        architecture: l.architecture.id,
        ...outcomeOf(c.plant, datasets[i] as (typeof datasets)[number], l.planted.materialised),
        reading: `flag.${flag}.${l.architecture.flags[flag] ? "on" : "off"}`,
        decision_same: !c.affected.some((id) => differing.has(id)),
      };
    }),
    lineage: lineageView(truth, "challenge", datasets, materialised, { hide_ph_values: true }),
    decisions: {
      affected: [...c.affected],
      rows: c.affected.flatMap((id) => {
        const read = c.planted.decisions.find((d) => d.decision_id === id)?.read;
        const real = decisionTruth(c.planted, id);
        return read && real
          ? [{ decision_id: id, read_as: read.filed_under, from_sample: real.from_sample, value: read.value, record: { container: read.container, hold_s: read.hold_s }, truth: { container: real.container, hold_s: real.hold_s } }]
          : [];
      }),
    },
  };
};

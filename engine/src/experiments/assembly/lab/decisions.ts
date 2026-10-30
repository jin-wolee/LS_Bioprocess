import type { EvaluationSettings } from "../../../evaluate/config.ts";
import type { ForcedError, MaterialisedError } from "../../../inject/types.ts";
import type { Architecture } from "../../../record/architecture.ts";
import { createRng } from "../../../rng.ts";
import { runScenario } from "../../../run.ts";
import type { ScenarioRun } from "../../../run.ts";
import type { ScenarioConfig } from "../../../scenario.ts";
import { runArm } from "../closed_loop_arm.ts";
import type { LoggedDecision } from "../closed_loop_log.ts";
import { buildShared } from "../closed_loop_shared.ts";
import type { Shared } from "../closed_loop_shared.ts";

// 2026-10-30 S3d (docs/design/lab_ui.md section 9, "The decision variant"): the closed loop of experiment 2 for one seed and one architecture, as the lab shows it. `runDecisionLoop` returns the
// decisions of the readjustment of the online pH probe in time order, each with the row it read as the record holds it, and what it did; `differingDecisions` says which decisions of a planted
// loop differ from the unplanted loop of the same seed (the action or the row, not the values). The truth side (which sample a row came from, its real container and hold time) is another
// function, `decisionTruth`, which the reveal calls after the guess: the loop object is plain data of the record and carries no truth, which sits beside it, out of the object's reach.

export type DecisionView = LoggedDecision;

export interface DecisionLoopInput {
  /** The parsed SC8 scenario (`feedback: true`). */
  scenario: ScenarioConfig;
  seed: number;
  evaluation: EvaluationSettings;
  architecture: Architecture;
  /** The plant: errors forced on named samples (the injector's forced mode). Absent: the unplanted loop. */
  forced?: readonly ForcedError[];
  /** The lab run of the seed, when the caller already holds it (the open-loop run of `scenario` with `feedback: false`); the unplanted and the planted loop of one seed share it. */
  run?: ScenarioRun;
}

export interface DecisionLoop {
  architecture: string;
  /** Time order, then reactor. The record view of the decisions: nothing of truth. */
  decisions: DecisionView[];
  /** The injector's realised errors of this architecture (plain data). */
  materialised: MaterialisedError[];
}

/** What the truth functions need and the record view must not carry: the shared lab run of the loop and the order of the draws in the stream. */
interface TruthSide {
  architecture: string;
  shared: Shared;
  drawn: string[];
}
const TRUTH = new WeakMap<DecisionLoop, TruthSide>();
const truthOf = (loop: DecisionLoop): TruthSide => {
  const side = TRUTH.get(loop);
  if (!side) throw new Error("decision loop: the truth side of this loop is not held (a loop that was copied, or not made by runDecisionLoop, has none)");
  return side;
};

export const runDecisionLoop = (input: DecisionLoopInput): DecisionLoop => {
  const { scenario, seed, evaluation, architecture } = input;
  if (!scenario.feedback) throw new Error("decision loop: the scenario must set feedback: true (SC8)");
  const run = input.run ?? runScenario({ ...scenario, seed, feedback: false });
  const shared = buildShared(run, scenario, seed, { architectures: [architecture], evaluation, rng: createRng(), ...(input.forced && { forced: input.forced }) });
  const arm = runArm(shared, { id: architecture.id, kind: "architecture", structure: architecture.id }, createRng(), { decisions: true });
  const loop: DecisionLoop = {
    architecture: architecture.id,
    decisions: [...(arm.decisions ?? [])].sort((a, b) => a.t - b.t || (a.unit_id < b.unit_id ? -1 : 1)),
    materialised: shared.structure[architecture.id]?.materialised ?? [],
  };
  TRUTH.set(loop, { architecture: architecture.id, shared, drawn: run.events.flatMap((e) => (e.type === "sample_drawn" ? [e.sample_id] : [])) });
  return loop;
};

/**
 * The decisions of the planted loop that differ from the same decision (the same reactor and tick) of the unplanted loop: another action, or another row read (the id it is filed under or its
 * `measured_at`). The values are not compared, nor the context: after the first changed decision the loop itself moves the later values, and nothing is marked for that (section 9).
 */
export const differingDecisions = (unplanted: readonly DecisionView[], planted: readonly DecisionView[]): string[] => {
  const before = new Map(unplanted.map((d) => [d.decision_id, d]));
  if (before.size !== planted.length || planted.some((d) => !before.has(d.decision_id))) throw new Error("decision loops: the two loops do not hold the same decisions (one per reactor and readjustment tick)");
  return planted
    .filter((d) => {
      const u = before.get(d.decision_id) as DecisionView;
      return u.action !== d.action || u.read?.filed_under !== d.read?.filed_under || u.read?.measured_at !== d.read?.measured_at;
    })
    .map((d) => d.decision_id);
};

/** The truth behind one decision: the sample its row stands for, and the container and hold that sample really had (the lab run's, not the record's). */
export interface DecisionTruth {
  decision_id: string;
  from_sample: string;
  container: "open" | "closed";
  hold_s: number;
}

/** Truth side, for the reveal only. Null for a decision that read no row (or an id the loop does not hold). */
export const decisionTruth = (loop: DecisionLoop, decision_id: string): DecisionTruth | null => {
  const read = loop.decisions.find((d) => d.decision_id === decision_id)?.read;
  if (!read) return null;
  const { shared } = truthOf(loop);
  let run_id: string | undefined;
  for (const rows of shared.structure[loop.architecture]?.ph.values() ?? []) {
    run_id = rows.find((x) => x.row.result_id === read.result_id && x.row.request_id === read.filed_under && x.row.measured_at === read.measured_at)?.run_id;
    if (run_id !== undefined) break;
  }
  if (run_id === undefined) throw new Error(`decision loop: the row ${read.result_id} read by ${decision_id} stands for no result of the lab run`);
  for (const reactor of shared.reactors) {
    for (const sample of reactor.samples) {
      const result = sample.results.find((x) => x.run_id === run_id);
      if (result) return { decision_id, from_sample: sample.sample_id, container: sample.container, hold_s: result.hold_s };
    }
  }
  throw new Error(`decision loop: the run ${run_id} of ${decision_id} is in no sample of the lab run`);
};

/**
 * Truth side. The id a label error would put on a sample: the next draw of the stream, else the previous one (the production content of a label error, `inject/inject.ts`); null when the
 * run drew no other sample.
 */
export const neighbourOf = (loop: DecisionLoop, sample_id: string): string | null => {
  const { drawn } = truthOf(loop);
  const i = drawn.indexOf(sample_id);
  return i < 0 ? null : (drawn[i + 1] ?? drawn[i - 1] ?? null);
};

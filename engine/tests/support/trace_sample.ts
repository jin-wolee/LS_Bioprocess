import { PICK_RULE, pickSample } from "../../src/experiments/assembly/lab/pick.ts";
import type { Context, Picked } from "../../src/experiments/assembly/lab/pick.ts";
import { askQuestions } from "../../src/experiments/assembly/lab/questions.ts";
import type { Answers, Verdict } from "../../src/experiments/assembly/lab/questions.ts";
import type { ProcessContext } from "../../src/record/asof.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { ENGINE_VERSION } from "../../src/trace.ts";
import { keyErrors } from "./sc_run.ts";

// The single-sample failure trace (docs/prompts/20 Step 10; docs/design/single_sample_trace.md). One sample of SC3, picked by a rule that reads the truth log only, and the
// real rows of A, B and C for it. Test-side: it reads truth (to pick, and to give the verdicts), as the evaluator does. The pick rule and the three questions moved to the lab folder in S3e
// (engine/src/experiments/assembly/lab/pick.ts and questions.ts, where the lineage view uses them); they are re-exported here, so the tests and the fixture generator are unchanged.

export const SCENARIO = { id: "sc03_feed_in_gap", seed: 1, days: 21 } as const;

export { PICK_RULE, pickSample };
export type { Context, Picked, Verdict };

export interface ArchitectureTrace {
  flags: RecordedDataset["architecture"]["flags"];
  labelling: string;
  tables: {
    sample: unknown[];
    analysis_request: unknown[];
    run: unknown[];
    result: unknown[];
    /** The view of data_model section 2, as of the end of the run, for the first result the record offers; null when none is available. */
    process_context: ProcessContext | null;
  };
  answers: Answers;
  /** The errors the injector materialised on this sample in this architecture (production rates), from the key file. */
  realised_errors: unknown[];
}

/** What the architecture's record says about the sample, as an analyst's query would read it after the end of the run (evaluate/query.ts: NOW), judged against truth. */
export const traceOf = (ds: RecordedDataset, p: Picked, keyText: string): ArchitectureTrace => {
  const mine = <T extends { request_id: string }>(rows: T[]): T[] => rows.filter((r) => r.request_id === p.sample_id);
  const sample = ds.sample.filter((s) => s.sample_id === p.sample_id);
  const { answers, process_context } = askQuestions(ds, p);
  return {
    flags: ds.architecture.flags, labelling: ds.architecture.labelling,
    tables: { sample, analysis_request: mine(ds.analysis_request), run: mine(ds.run), result: mine(ds.result), process_context },
    answers,
    realised_errors: keyErrors(keyText, ds.architecture.id).filter((e) => e.sample_id === p.sample_id),
  };
};

export interface SingleSampleTrace {
  fixture: string;
  engine_version: string;
  scenario: typeof SCENARIO;
  pick: { rule: string } & Picked;
  architectures: Record<string, ArchitectureTrace>;
}

export const buildTrace = (run: ScenarioRun, datasets: Record<string, RecordedDataset>, keyText: string): SingleSampleTrace => {
  const pick = pickSample(run);
  return {
    fixture: "single_sample_trace", engine_version: ENGINE_VERSION, scenario: SCENARIO, pick: { rule: PICK_RULE, ...pick },
    architectures: Object.fromEntries(Object.entries(datasets).map(([id, ds]) => [id, traceOf(ds, pick, keyText)])),
  };
};

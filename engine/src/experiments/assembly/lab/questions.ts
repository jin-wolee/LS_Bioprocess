import { contextAsOf, resultsAsOf } from "../../../record/asof.ts";
import type { ProcessContext } from "../../../record/asof.ts";
import type { RecordedDataset } from "../../../record/types.ts";
import type { Context, Picked } from "./pick.ts";

// 2026-10-30 S3e (docs/design/lab_ui.md section 5; single_sample_trace.md "The question"): the three questions an analyst asks of a record after the end of the run, moved here from
// engine/tests/support/trace_sample.ts. The record answers from its own rows (as the evaluator's analyst query reads them, evaluate/query.ts: NOW) and the answer is judged against truth.

export type Verdict = "correct" | "wrong" | "unanswerable";

export const verdict = (answer: unknown, truth: unknown): Verdict => (answer === null ? "unanswerable" : JSON.stringify(answer) === JSON.stringify(truth) ? "correct" : "wrong");

export interface Answers {
  unit: { answer: string | null; verdict: Verdict };
  sampled_at: { answer: number | null; verdict: Verdict };
  process_context: { answer: Context | null; verdict: Verdict };
}

/** What the truth says of the sample the three questions are about. */
export type SampleTruth = Pick<Picked, "sample_id" | "unit_id" | "sampled_at" | "context_at_draw">;

/** The view of data_model section 2 (process context) as of the end of the run for the first result the record offers for the sample; null when none is available. The record only: no truth. */
export const recordContext = (ds: RecordedDataset, sample_id: string): ProcessContext | null => {
  const row = resultsAsOf(ds, Number.MAX_SAFE_INTEGER).find((r) => r.request_id === sample_id);
  return row ? contextAsOf(ds, row, Number.MAX_SAFE_INTEGER) : null;
};

/** The answers of a record about the sample (judged against truth), and the process context they were read from. */
export const askQuestions = (ds: RecordedDataset, p: SampleTruth): { answers: Answers; process_context: ProcessContext | null } => {
  const sample = ds.sample.filter((s) => s.sample_id === p.sample_id);
  const ctx = recordContext(ds, p.sample_id);
  const unit = sample[0]?.unit_id ?? null;
  const answer = ctx ? { feed_epoch: ctx.feed_epoch, batch_phase: ctx.batch_phase } : null;
  return {
    answers: {
      unit: { answer: unit, verdict: verdict(unit, p.unit_id) },
      sampled_at: { answer: sample[0]?.sampled_at ?? null, verdict: verdict(sample[0]?.sampled_at ?? null, p.sampled_at) },
      process_context: { answer, verdict: verdict(answer, p.context_at_draw) },
    },
    process_context: ctx,
  };
};

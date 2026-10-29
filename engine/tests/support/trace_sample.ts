import { factsOf, truthFromRun } from "../../src/evaluate/truth.ts";
import { contextAsOf, resultsAsOf } from "../../src/record/asof.ts";
import type { ProcessContext } from "../../src/record/asof.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { ENGINE_VERSION } from "../../src/trace.ts";
import { eventsOf, keyErrors } from "./sc_run.ts";

// The single-sample failure trace (prompts/20 Step 10; docs/design/single_sample_trace.md). One sample of SC3, picked by a rule that reads the truth log only, and the
// real rows of A, B and C for it. Test-side: it reads truth (to pick, and to give the verdicts), as the evaluator does.

export const SCENARIO = { id: "sc03_feed_in_gap", seed: 1, days: 21 } as const;

export const PICK_RULE =
  "In SC3, the lowest sample_id (plain string order; the ids are zero-padded) whose interval [sampled_at, run.started_at] contains a feed of its own unit and batch. " +
  "run.started_at is the start of the first run of the request (attempt 1, visit 1), the instant hold_time is measured to (data_model section 5). Both ends count.";

export type Verdict = "correct" | "wrong" | "unanswerable";
export type Context = { feed_epoch: number; batch_phase: string };

export interface Picked {
  sample_id: string;
  unit_id: string;
  batch_id: string;
  sampled_at: number;
  arrived_at: number;
  run_started_at: number;
  measured_at: number;
  /** Feeds of the sample's batch with sampled_at <= t <= run_started_at. */
  feeds_in_interval: number[];
  feeds_of_batch: number[];
  context_at_draw: Context;
  context_at_measurement: Context;
}

/** The sample by the rule above, from the truth log alone. No recorded output is read, so the pick cannot depend on what a recorder did. */
export const pickSample = (run: ScenarioRun): Picked => {
  const facts = factsOf(truthFromRun(run));
  const feeds = eventsOf(run, "process_event").filter((e) => e.kind === "feed");
  const received = new Map(eventsOf(run, "sample_received").map((e) => [e.sample_id, e.t]));
  const measured = new Map<string, number>();
  for (const e of eventsOf(run, "result_measured")) if (!measured.has(e.request_id) || e.t < (measured.get(e.request_id) as number)) measured.set(e.request_id, e.t);
  const candidates = eventsOf(run, "sample_drawn").flatMap((d) => {
    const started = facts.get(d.sample_id)?.first_run?.started_at;
    if (started === undefined) return [];
    const own = feeds.filter((f) => f.unit_id === d.unit_id && f.batch_id === d.batch_id).map((f) => f.t);
    const inside = own.filter((t) => t >= d.t && t <= started);
    return inside.length === 0 ? [] : [{ d, started, own, inside }];
  });
  candidates.sort((a, b) => (a.d.sample_id < b.d.sample_id ? -1 : a.d.sample_id > b.d.sample_id ? 1 : 0));
  const first = candidates[0];
  if (!first) throw new Error("no sample of SC3 has a feed in [sampled_at, run.started_at]");
  const { d, started, own, inside } = first;
  const at = (t: number): Context => {
    const upTo = eventsOf(run, "process_event").filter((p) => p.unit_id === d.unit_id && p.batch_id === d.batch_id && p.t <= t);
    return { feed_epoch: upTo.filter((p) => p.kind === "feed").length, batch_phase: upTo.some((p) => p.kind === "harvest") ? "harvested" : upTo.some((p) => p.kind === "temperature_shift") ? "after_shift" : "before_shift" };
  };
  const m = measured.get(d.sample_id) as number;
  return {
    sample_id: d.sample_id, unit_id: d.unit_id, batch_id: d.batch_id, sampled_at: d.t, arrived_at: received.get(d.sample_id) as number, run_started_at: started, measured_at: m,
    feeds_in_interval: inside, feeds_of_batch: own, context_at_draw: at(d.t), context_at_measurement: at(m),
  };
};

const verdict = (answer: unknown, truth: unknown): Verdict => (answer === null ? "unanswerable" : JSON.stringify(answer) === JSON.stringify(truth) ? "correct" : "wrong");

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
  answers: {
    unit: { answer: string | null; verdict: Verdict };
    sampled_at: { answer: number | null; verdict: Verdict };
    process_context: { answer: Context | null; verdict: Verdict };
  };
  /** The errors the injector materialised on this sample in this architecture (production rates), from the key file. */
  realised_errors: unknown[];
}

/** What the architecture's record says about the sample, as an analyst's query would read it after the end of the run (evaluate/query.ts: NOW), judged against truth. */
export const traceOf = (ds: RecordedDataset, p: Picked, keyText: string): ArchitectureTrace => {
  const mine = <T extends { request_id: string }>(rows: T[]): T[] => rows.filter((r) => r.request_id === p.sample_id);
  const sample = ds.sample.filter((s) => s.sample_id === p.sample_id);
  const row = resultsAsOf(ds, Number.MAX_SAFE_INTEGER).find((r) => r.request_id === p.sample_id);
  const ctx = row ? contextAsOf(ds, row, Number.MAX_SAFE_INTEGER) : null;
  const unit = sample[0]?.unit_id ?? null;
  const answer = row && ctx ? { feed_epoch: ctx.feed_epoch, batch_phase: ctx.batch_phase } : null;
  return {
    flags: ds.architecture.flags, labelling: ds.architecture.labelling,
    tables: { sample, analysis_request: mine(ds.analysis_request), run: mine(ds.run), result: mine(ds.result), process_context: ctx },
    answers: {
      unit: { answer: unit, verdict: verdict(unit, p.unit_id) },
      sampled_at: { answer: sample[0]?.sampled_at ?? null, verdict: verdict(sample[0]?.sampled_at ?? null, p.sampled_at) },
      process_context: { answer, verdict: verdict(answer, p.context_at_draw) },
    },
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

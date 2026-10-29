import type { Metrics } from "../generated/metrics.schema";
import type { Lookup } from "./query.ts";
import { ALL_REQUESTS, ratio } from "./ratio.ts";
import { quantile } from "./stats.ts";
import { lotAt } from "./truth.ts";
import type { RequestFacts, Truth } from "./truth.ts";

type Out = Metrics["metrics"];

/** The reagent lot in force in the truth world at the run that produced the result the record holds (its run id ends in `attempt/visit`). */
const trueLot = (truth: Truth, f: RequestFacts, runId: string): string | null => {
  const run = f.runs.get(runId.split("/").slice(-2).join("/"));
  return run ? lotAt(truth, run.analyzer, run.started_at) : null;
};

/**
 * Exact reconstruction rate (spec section 8): the share of requests whose analyst-query answer equals truth on reactor (unit), batch,
 * `sampled_at`, process context (feed epoch and phase, at the true draw time) and instrument state (the reagent lot of the run). A missing
 * part (no stored `sampled_at`, no instrument link, no result, no batch) is unanswerable and counts as wrong. Denominator: ALL analysis requests.
 */
export const exactReconstruction = (truth: Truth, facts: ReadonlyMap<string, RequestFacts>, lookups: ReadonlyMap<string, Lookup>): Out["exact_reconstruction"] => {
  let exact = 0;
  for (const r of truth.requests) {
    const l = lookups.get(r.request_id) as Lookup;
    const f = facts.get(r.request_id) as RequestFacts;
    if (l.kind !== "answer" || r.sampled_at === null || f.context === null || l.context === null || l.reagent_lot === null) continue;
    if (
      l.unit_id === r.unit_id && l.batch_id === r.batch_id && l.sampled_at === r.sampled_at &&
      l.context.feed_epoch === f.context.feed_epoch && l.context.batch_phase === f.context.batch_phase && l.reagent_lot === trueLot(truth, f, l.row.run_id)
    ) exact += 1;
  }
  return ratio(exact, truth.requests.length, ALL_REQUESTS);
};

/**
 * Alignment error (spec section 8): seconds between the time the join used (the stored time: `sampled_at` where stored, else `measured_at`)
 * and the true `sampled_at`, absolute, median and p90 over the requests that could be joined (`joined` is the share), plus the resulting
 * context mismatch (the process context differs from the true one at the draw). Both shares have the denominator ALL analysis requests.
 */
export const alignmentError = (truth: Truth, facts: ReadonlyMap<string, RequestFacts>, lookups: ReadonlyMap<string, Lookup>): Out["alignment_error"] => {
  const errors: number[] = [];
  let mismatch = 0;
  for (const r of truth.requests) {
    const l = lookups.get(r.request_id) as Lookup;
    const f = facts.get(r.request_id) as RequestFacts;
    if (l.kind !== "answer" || l.join_time === null || r.sampled_at === null || f.context === null) continue;
    errors.push(Math.abs(l.join_time - r.sampled_at));
    if (l.context === null || l.context.feed_epoch !== f.context.feed_epoch || l.context.batch_phase !== f.context.batch_phase) mismatch += 1;
  }
  const n = truth.requests.length;
  return {
    joined: ratio(errors.length, n, ALL_REQUESTS),
    median_s: quantile(errors, 0.5),
    p90_s: quantile(errors, 0.9),
    context_mismatch: ratio(mismatch, n, `${ALL_REQUESTS}; a request that could not be joined has no context to mismatch (see joined)`),
  };
};

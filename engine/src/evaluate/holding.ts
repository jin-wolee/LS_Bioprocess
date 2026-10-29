import type { Metrics } from "../generated/metrics.schema";
import { ALL_REQUESTS, ratio } from "./ratio.ts";
import { quantile } from "./stats.ts";
import type { RequestFacts, Truth } from "./truth.ts";

type Out = Metrics["metrics"];

/**
 * Holding time (spec section 8; data_model section 5): `run_started_at` minus the true `sampled_at`, of the first run (attempt 1, visit 1).
 * Denominator of the exceedance share: ALL analysis requests; a request that never started counts as an exceedance. The median and p90 are over the
 * started requests, with the started share beside them (`started`). A truth quantity: it is the same in every architecture.
 */
export const holdingTime = (truth: Truth, facts: ReadonlyMap<string, RequestFacts>, slaS: number): Out["holding_time"] => {
  const n = truth.requests.length;
  const holds: number[] = [];
  for (const r of truth.requests) {
    const run = facts.get(r.request_id)?.first_run;
    if (run && r.sampled_at !== null) holds.push(run.started_at - r.sampled_at);
  }
  const neverStarted = n - holds.length;
  return {
    started: ratio(holds.length, n, ALL_REQUESTS),
    median_s: quantile(holds, 0.5),
    p90_s: quantile(holds, 0.9),
    sla_threshold_s: slaS,
    sla_exceedance: ratio(neverStarted + holds.filter((h) => h > slaS).length, n, `${ALL_REQUESTS}; a request that never started counts as an exceedance`),
  };
};

/**
 * Turnaround: the truth `available_at` (see `released_at` in truth.ts) minus the true `sampled_at`. Denominator of the released share: ALL analysis
 * requests; a request never released counts as not available. The median and p90 are over released requests.
 */
export const turnaround = (truth: Truth, facts: ReadonlyMap<string, RequestFacts>): Out["turnaround"] => {
  const n = truth.requests.length;
  const spans: number[] = [];
  for (const r of truth.requests) {
    const released = facts.get(r.request_id)?.released_at;
    if (released !== null && released !== undefined && r.sampled_at !== null) spans.push(released - r.sampled_at);
  }
  return { released: ratio(spans.length, n, ALL_REQUESTS), median_s: quantile(spans, 0.5), p90_s: quantile(spans, 0.9) };
};

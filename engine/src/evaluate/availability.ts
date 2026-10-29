import type { Metrics } from "../generated/metrics.schema";
import { resultsAsOf } from "../record/asof.ts";
import type { RecordedDataset } from "../record/types.ts";
import { recordedId } from "./answer_key.ts";
import type { ArchitectureKey } from "./answer_key.ts";
import { ALL_REQUESTS, ratio } from "./ratio.ts";
import type { RequestFacts, Truth } from "./truth.ts";

/**
 * Availability before a decision deadline (spec section 8): the share of requests for which the as-of read at the decision time (A050; the
 * rule of section 3) shows a result AND the truth world had released it by then. Denominator: ALL analysis requests; a draw refused by the
 * volume budget has no decision time and is not available. `leaked` counts, over the same denominator, the requests for which the read shows a
 * result that the truth world had not released yet: an architecture without `available_at` sees rows as of now, which must not read as availability.
 * A held, quarantined or rejected row is not shown.
 */
export const availability = (truth: Truth, facts: ReadonlyMap<string, RequestFacts>, ds: RecordedDataset, key: ArchitectureKey): Metrics["metrics"]["availability"] => {
  const reads = new Map<number, Set<string>>();
  const shown = (asOf: number): Set<string> => {
    if (!reads.has(asOf)) reads.set(asOf, new Set(resultsAsOf(ds, asOf).map((r) => r.request_id)));
    return reads.get(asOf) as Set<string>;
  };
  let available = 0;
  let leaked = 0;
  for (const r of truth.requests) {
    const deadline = truth.deadlines[r.request_id];
    if (deadline === undefined || !shown(deadline).has(recordedId(key, r.request_id))) continue;
    const released = facts.get(r.request_id)?.released_at;
    if (released !== null && released !== undefined && released <= deadline) available += 1;
    else leaked += 1;
  }
  const n = truth.requests.length;
  return { available: ratio(available, n, ALL_REQUESTS), leaked: ratio(leaked, n, `${ALL_REQUESTS}; shown by the read although not yet released in the truth world`) };
};

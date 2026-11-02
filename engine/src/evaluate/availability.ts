import type { Metrics } from "../generated/metrics.schema";
import { resultsAsOf } from "../record/asof.ts";
import { hasValue } from "../record/types.ts";
import type { RecordedDataset, ValuedResult } from "../record/types.ts";
import { recordedId } from "./answer_key.ts";
import type { ArchitectureKey } from "./answer_key.ts";
import { ALL_REQUESTS, ratio } from "./ratio.ts";
import { everyItem, visitOfRun } from "./truth.ts";
import type { RequestFacts, Truth } from "./truth.ts";

/**
 * Availability before a decision deadline (spec section 8): the share of requests for which the as-of read at the decision time (A050; the
 * rule of section 3) shows a value of every required item of every visit, each from a run of its own visit (audit A1, F1: "Request-level metrics"),
 * AND the truth world had released the request by then. Denominator: ALL analysis requests; a draw refused by the volume budget has no decision time
 * and is not available. `leaked` counts, over the same denominator, the requests for which the read shows all of them although the truth world had
 * not released the request yet: an architecture without `available_at` sees rows as of now, which must not read as availability. A held, quarantined
 * or rejected row is not shown, and a result with no value (over range at the last dilution, spec 2.3) is not a value.
 */
export const availability = (truth: Truth, facts: ReadonlyMap<string, RequestFacts>, ds: RecordedDataset, key: ArchitectureKey): Metrics["metrics"]["availability"] => {
  const reads = new Map<number, Map<string, Map<string, ValuedResult>>>();
  const shown = (asOf: number): Map<string, Map<string, ValuedResult>> => {
    const cached = reads.get(asOf);
    if (cached) return cached;
    const byRequest = new Map<string, Map<string, ValuedResult>>();
    for (const r of resultsAsOf(ds, asOf).filter(hasValue)) {
      const mine = byRequest.get(r.request_id) ?? new Map<string, ValuedResult>();
      if (!mine.has(r.analyte)) mine.set(r.analyte, r);
      byRequest.set(r.request_id, mine);
    }
    reads.set(asOf, byRequest);
    return byRequest;
  };
  let available = 0;
  let leaked = 0;
  for (const r of truth.requests) {
    const deadline = truth.deadlines[r.request_id];
    const f = facts.get(r.request_id);
    if (deadline === undefined || !f) continue;
    const rows = shown(deadline).get(recordedId(key, r.request_id));
    if (!rows || !everyItem(truth, f, (analyte, visit) => { const row = rows.get(analyte); return row !== undefined && visitOfRun(row.run_id) === visit; })) continue;
    if (f.released_at !== null && f.released_at <= deadline) available += 1;
    else leaked += 1;
  }
  const n = truth.requests.length;
  return { available: ratio(available, n, ALL_REQUESTS), leaked: ratio(leaked, n, `${ALL_REQUESTS}; shown by the read although not yet released in the truth world`) };
};

import type { Metrics } from "../generated/metrics.schema";
import type { RecordedDataset } from "../record/types.ts";
import { recordedId } from "./answer_key.ts";
import type { ArchitectureKey } from "./answer_key.ts";
import type { Lookup } from "./query.ts";
import { ALL_REQUESTS, ratio } from "./ratio.ts";
import type { Truth } from "./truth.ts";

type Out = Metrics["metrics"];

/**
 * Misattribution (spec section 8): the recorded reactor (unit) or batch differs from truth. `unattributed` is reported separately: the record
 * holds a result under an id with no sample row, or no batch is open at the stored time. `no_result` counts requests the record holds no
 * result for (never measured, held back, refused draw). All three over ALL analysis requests, so a hard request cannot be dropped to improve one.
 */
export const misattribution = (truth: Truth, lookups: ReadonlyMap<string, Lookup>): Out["misattribution"] => {
  let wrong = 0;
  let unattributed = 0;
  let none = 0;
  for (const r of truth.requests) {
    const l = lookups.get(r.request_id) as Lookup;
    if (l.kind === "no_result") none += 1;
    else if (l.kind === "orphan" || l.batch_id === null) unattributed += 1;
    else if (l.unit_id !== r.unit_id || l.batch_id !== r.batch_id) wrong += 1;
  }
  const n = truth.requests.length;
  return { misattributed: ratio(wrong, n, ALL_REQUESTS), unattributed: ratio(unattributed, n, ALL_REQUESTS), no_result: ratio(none, n, ALL_REQUESTS) };
};

/**
 * Attributable rate: the operator and the qualification are present AND correct for the sample the record holds under the request's id: the
 * operator is the true sampler and the qualification attests the true training status (A072, A073). Denominator: ALL analysis requests.
 */
export const attributable = (truth: Truth, ds: RecordedDataset, key: ArchitectureKey): Out["attributable"] => {
  const samples = new Map(ds.sample.map((s) => [s.sample_id, s]));
  const qualifications = new Map(ds.qualification.map((q) => [q.qualification_id, q]));
  const qualified = new Map(truth.operators.map((o) => [o.operator_id, o.qualified]));
  let ok = 0;
  for (const r of truth.requests) {
    const s = samples.get(recordedId(key, r.request_id));
    if (!s || r.operator_id === null || s.operator_id !== r.operator_id || s.qualification_id === null) continue;
    if (qualifications.get(s.qualification_id)?.qualified === (qualified.get(r.operator_id) ?? false)) ok += 1;
  }
  return ratio(ok, truth.requests.length, ALL_REQUESTS);
};

import { resultsAsOf } from "../../record/asof.ts";
import { hasValue } from "../../record/types.ts";
import type { RecordedDataset } from "../../record/types.ts";

// 2026-10-30 S2c3, experiment 2 (spec 6.2): the decision code of arms A, B and C. It sees a recorded dataset and a time, nothing else (eslint zone 3: no truth
// module, no oracle, no assembly, no evaluator, no answer key). The arm decides whether to readjust the online pH probe onto the newest offline pH value it holds
// and onto what. One rule serves every architecture, each applying it to the fields its record holds (orchestrator ruling R1, 2026-10-30): the container is recorded by
// every architecture (S2c1, no flag owns it), the hold time only where `two_clocks` stores `sampled_at`. A value taken in an open container is known to carry the
// open-sample offset (A041); a recorded hold above A046 is known to carry the hold drift. A field the record lacks marks nothing.

export interface ArmOptions {
  /** A recorded hold time above this marks a known bias (A046, 30 min). */
  hold_limit_s: number;
  /**
   * What to do with a value whose recorded context marks a known bias. `exclude` (the default rule) skips the readjustment. `model` (a sensitivity, reported only)
   * subtracts the open-sample offset of A041 from a value taken in an open container, in every architecture; a hold above the limit is still excluded, because no
   * correction is modelled for it.
   */
  bias_handling: "exclude" | "model";
  /** The open-sample pH offset of A041, subtracted by the modelled variant. */
  open_offset: number;
}

export type Decision =
  | { action: "readjust"; onto: number; sample_id: string; measured_at: number }
  | { action: "skip"; reason: "known_bias"; sample_id: string; measured_at: number }
  | { action: "none" };

/**
 * The recorded container and the recorded hold time of a sample, each null where the record does not hold it. The hold time is the first run's start minus
 * `sampled_at`, the definition of the evidence check `holdContext` (record/evidence.ts), which needs both fields and so cannot serve an architecture that stores only one.
 */
export const recordedContext = (ds: RecordedDataset, sampleId: string): { container: string | null; hold_time_s: number | null } => {
  const sample = ds.sample.find((s) => s.sample_id === sampleId);
  const start = ds.run.filter((r) => r.request_id === sampleId).map((r) => r.started_at).sort((a, b) => a - b)[0];
  return { container: sample?.container ?? null, hold_time_s: sample?.sampled_at != null && start !== undefined ? start - sample.sampled_at : null };
};

/**
 * The decision at time `t`. `since` is the `measured_at` of the newest value the arm looked at before (use -1 for none): a value is used once. A row that does not exist
 * yet at `t` (`measured_at` after `t`) is never read, whichever architecture holds the record; a held, quarantined or rejected row is not available (resultsAsOf).
 */
export const decideReadjust = (ds: RecordedDataset, t: number, since: number, opts: ArmOptions): Decision => {
  const newest = resultsAsOf(ds, t)
    .filter(hasValue)
    .filter((r) => r.analyte === "ph" && r.measured_at <= t && r.measured_at > since)
    .sort((a, b) => b.measured_at - a.measured_at || (a.result_id < b.result_id ? -1 : 1))[0];
  if (!newest) return { action: "none" };
  const seen = { sample_id: newest.request_id, measured_at: newest.measured_at };
  const context = recordedContext(ds, newest.request_id);
  const open = context.container === "open";
  const long = context.hold_time_s !== null && context.hold_time_s > opts.hold_limit_s;
  if (opts.bias_handling === "model" && open && !long) return { action: "readjust", onto: newest.value - opts.open_offset, ...seen };
  return open || long ? { action: "skip", reason: "known_bias", ...seen } : { action: "readjust", onto: newest.value, ...seen };
};

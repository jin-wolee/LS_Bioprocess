import { batchOf } from "../asof.ts";
import type { RecordedDataset } from "../types.ts";
import type { Signal } from "./types.ts";

// What the confirming samples say, and which hold waits for which sample (spec 11.8.2 rule S9). A confirming sample is a sample of the record with a confirmatory request (batch 3); its tests are
// the runs of that request and its findings the results with an `outcome`. Nothing here reads the truth: the outcome is what the test lab reported.
//   A hold is released "only when every test of its confirming sample is not_detected, at the last result plus d2"; "at a positive result, at result time plus d2" it becomes quarantine. The first
//   detected result decides at once: the other tests of the sample may still be open.

export interface Verdict {
  kind: "positive" | "negative";
  /** The instant the hold is decided: the first detected result, or the last result when none is detected, plus d2. */
  at: number;
}

export interface Confirming {
  sample_id: string;
  unit_id: string;
  /** The batch of the confirmed unit when the sample was drawn; null when the record cannot tell. */
  batch_id: string | null;
  /** Null while no result of the sample can decide a hold (a test is still open, or the draw was skipped and ran no test). */
  verdict: Verdict | null;
  /** When the last of its results is in, or null while a test is open. */
  complete_at: number | null;
}

export const confirmingOf = (ds: RecordedDataset, d2: number): Confirming[] =>
  ds.analysis_request.filter((q) => q.purpose === "confirmatory").flatMap((q): Confirming[] => {
    const sample = ds.sample.find((s) => s.sample_id === q.request_id);
    if (!sample) return [];
    const results = ds.result.filter((r) => r.request_id === q.request_id);
    const runs = ds.run.filter((r) => r.request_id === q.request_id);
    const first = results[0];
    const detected = results.filter((r) => r.outcome === "detected").map((r) => r.measured_at);
    const complete_at = runs.length > 0 && runs.every((r) => r.ended_at !== null) && results.length === runs.length ? Math.max(...results.map((r) => r.measured_at)) : null;
    const verdict: Verdict | null = detected.length > 0 ? { kind: "positive", at: Math.min(...detected) + d2 } : complete_at !== null ? { kind: "negative", at: complete_at + d2 } : null;
    return [{ sample_id: q.request_id, unit_id: sample.unit_id, batch_id: first ? batchOf(ds, first) : null, verdict, complete_at }];
  });

/**
 * The confirming sample a hold on an item waits for: that of the item's own batch when it has one (a clean sibling is released by its own negative result), else that of the signalling unit (a lot,
 * an equipment item, or a batch that was not confirmed follows the verdict of the unit whose walk-back reached it). Null when neither exists, and the hold then stays under test.
 */
export const governing = (confirming: readonly Confirming[], batch_id: string | null, signal: Signal): Confirming | null =>
  (batch_id === null ? undefined : confirming.find((c) => c.batch_id === batch_id)) ?? confirming.find((c) => c.unit_id === signal.unit_id) ?? null;

import { batchOf } from "../asof.ts";
import type { RecordedDataset } from "../types.ts";
import type { Signal } from "./types.ts";

// What the confirming samples say, and which hold waits for which sample (spec 11.8.2 rule S9). A confirming sample is a sample of the record with a confirmatory request (batch 3); its tests are
// the runs of that request and its findings the results with an `outcome`. Nothing here reads the truth: the outcome is what the test lab reported.
//   A hold is released "only when every test of its confirming sample is not_detected, at the last result plus d2"; "at a positive result, at result time plus d2" it becomes quarantine. The first
//   detected result decides at once: the other tests of the sample may still be open.
//   Each signal draws its own confirming samples at its decision (rule S2 as ruled on F8), and a hold waits for one of those (C22): the record tells which by the instant of the draw.

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
  /** The instant of the draw: the start of the runs of the sample, which the record stores in every architecture (each test starts at the draw, C5). */
  drawn_at: number;
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
    return [{ sample_id: q.request_id, unit_id: sample.unit_id, batch_id: first ? batchOf(ds, first) : null, drawn_at: Math.min(...runs.map((r) => r.started_at)), verdict, complete_at }];
  });

/**
 * The confirming sample a hold on an item waits for, among the samples the signal that placed it drew at its decision instant: that of the item's own batch when the signal drew one (a clean
 * sibling is released by its own negative result), else that of the signalling unit (a lot, an equipment item, or a batch the signal did not confirm follows the verdict of the unit whose
 * walk-back reached it). Null when neither exists (the draw was skipped for the budget), and the hold then stays under test.
 */
export const governing = (confirming: readonly Confirming[], batch_id: string | null, signal: Signal, decision_at: number): Confirming | null => {
  const drawn = confirming.filter((c) => c.drawn_at === decision_at);
  return (batch_id === null ? undefined : drawn.find((c) => c.batch_id === batch_id)) ?? drawn.find((c) => c.unit_id === signal.unit_id) ?? null;
};

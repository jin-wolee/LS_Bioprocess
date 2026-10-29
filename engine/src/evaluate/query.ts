import { batchOf, contextAsOf, resultsAsOf } from "../record/asof.ts";
import type { RecordedDataset, ResultRow } from "../record/types.ts";
import { recordedId } from "./answer_key.ts";
import type { ArchitectureKey } from "./answer_key.ts";
import type { Truth } from "./truth.ts";

// The analyst's query on a recorded dataset: what the record says about one analysis request. It reads the dataset through the public
// as-of reads (record/asof.ts), the same reads an analyst would run, never the recorder's internals.

/** Reconstruction queries run after the end of the run ("what can be reconstructed afterwards"); only availability uses the decision time. */
export const NOW = Number.MAX_SAFE_INTEGER;

export interface Answer {
  row: ResultRow;
  unit_id: string;
  /** Null when no batch is open at the stored time (the key could not be attributed). */
  batch_id: string | null;
  /** Null where the architecture stores no sampled_at. */
  sampled_at: number | null;
  context: { feed_epoch: number; batch_phase: string } | null;
  /** The reagent lot of the instrument state the run is linked to; null without the link. */
  reagent_lot: string | null;
  join_time: number | null;
}

export type Lookup = { kind: "no_result" } | { kind: "orphan"; row: ResultRow } | ({ kind: "answer" } & Answer);

/** For every truth request: the record's answer under the id the record holds its results by (the answer key says which id that is). */
export const lookupAll = (truth: Truth, ds: RecordedDataset, key: ArchitectureKey): Map<string, Lookup> => {
  const first = new Map<string, ResultRow>();
  for (const r of resultsAsOf(ds, NOW)) if (!first.has(r.request_id)) first.set(r.request_id, r);
  const samples = new Map(ds.sample.map((s) => [s.sample_id, s]));
  const states = new Map(ds.instrument_state.map((s) => [s.instrument_state_id, s]));
  const runs = new Map(ds.run.map((x) => [x.run_id, x]));
  return new Map(
    truth.requests.map((req): [string, Lookup] => {
      const row = first.get(recordedId(key, req.request_id));
      if (!row) return [req.request_id, { kind: "no_result" }];
      const sample = samples.get(row.request_id);
      if (!sample) return [req.request_id, { kind: "orphan", row }];
      const ctx = contextAsOf(ds, row, NOW);
      const linked = runs.get(row.run_id)?.instrument_state_id;
      return [
        req.request_id,
        {
          kind: "answer", row, unit_id: sample.unit_id, batch_id: batchOf(ds, row), sampled_at: sample.sampled_at,
          context: ctx ? { feed_epoch: ctx.feed_epoch, batch_phase: ctx.batch_phase } : null,
          reagent_lot: (linked ? states.get(linked)?.reagent_lot : undefined) ?? null, join_time: ctx ? ctx.join_time : null,
        },
      ];
    }),
  );
};

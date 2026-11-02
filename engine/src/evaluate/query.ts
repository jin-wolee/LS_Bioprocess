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
  /** Every item the record holds for the request, by analyte (the latest version as of now), with the reagent lot of the state its own run is linked to (spec section 8, "Request-level metrics"). */
  items: ReadonlyMap<string, { row: ResultRow; reagent_lot: string | null }>;
}

export type Lookup = { kind: "no_result" } | { kind: "orphan"; row: ResultRow } | ({ kind: "answer" } & Answer);

/** For every truth request: the record's answer under the id the record holds its results by (the answer key says which id that is). */
export const lookupAll = (truth: Truth, ds: RecordedDataset, key: ArchitectureKey): Map<string, Lookup> => {
  const byRequest = new Map<string, Map<string, ResultRow>>();
  for (const r of resultsAsOf(ds, NOW)) {
    const mine = byRequest.get(r.request_id) ?? new Map<string, ResultRow>();
    if (!mine.has(r.analyte)) mine.set(r.analyte, r);
    byRequest.set(r.request_id, mine);
  }
  const samples = new Map(ds.sample.map((s) => [s.sample_id, s]));
  const states = new Map(ds.instrument_state.map((s) => [s.instrument_state_id, s]));
  const runs = new Map(ds.run.map((x) => [x.run_id, x]));
  const lotOf = (row: ResultRow): string | null => {
    const linked = runs.get(row.run_id)?.instrument_state_id;
    return (linked ? states.get(linked)?.reagent_lot : undefined) ?? null;
  };
  return new Map(
    truth.requests.map((req): [string, Lookup] => {
      const mine = byRequest.get(recordedId(key, req.request_id));
      const row = mine?.values().next().value;
      if (!mine || !row) return [req.request_id, { kind: "no_result" }];
      const sample = samples.get(row.request_id);
      if (!sample) return [req.request_id, { kind: "orphan", row }];
      const ctx = contextAsOf(ds, row, NOW);
      return [
        req.request_id,
        {
          kind: "answer", row, unit_id: sample.unit_id, batch_id: batchOf(ds, row), sampled_at: sample.sampled_at,
          context: ctx ? { feed_epoch: ctx.feed_epoch, batch_phase: ctx.batch_phase } : null,
          reagent_lot: lotOf(row), join_time: ctx ? ctx.join_time : null,
          items: new Map([...mine].map(([analyte, r]) => [analyte, { row: r, reagent_lot: lotOf(r) }])),
        },
      ];
    }),
  );
};

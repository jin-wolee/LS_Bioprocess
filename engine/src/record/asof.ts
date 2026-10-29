import type { HistorianRow, ProcessEventRow, RecordedDataset, ResultRow, SampleRow } from "./types.ts";

// Reads of a recorded dataset "as of" a decision time (data_model section 5, "Bitemporal and as-of rule"; spec section 3 rule 5).
// Valid time (`sampled_at`, `measured_at`, `occurred_at`, `ts`) says when something was true in the lab; transaction time
// (`available_at`, `ingested_at`) says when the system knew it. With the flag `available_at` on, a read at t uses per logical key the
// latest result version with `available_at` at or before t, and only historian rows and process events with `ingested_at` at or
// before t. With it off the read sees everything as of now: a late correction leaks into an earlier decision.

/** The version that became knowable last: greatest `available_at`, then greatest version (with the flag off every `available_at` is null, so version alone decides). */
const newer = (a: ResultRow, b: ResultRow): number => (a.available_at ?? 0) - (b.available_at ?? 0) || a.version - b.version;

/** The latest version per (request, analyte) that was knowable at `asOf`. Rows tied on both (a double count) are all returned. */
export const resultsAsOf = (ds: RecordedDataset, asOf: number): ResultRow[] => {
  const strict = ds.architecture.flags.available_at;
  const best = new Map<string, ResultRow>();
  for (const r of ds.result) {
    if (strict && (r.available_at === null || r.available_at > asOf)) continue;
    const k = `${r.request_id}/${r.analyte}`;
    const cur = best.get(k);
    if (!cur || newer(r, cur) > 0) best.set(k, r);
  }
  return ds.result.filter((r) => {
    const cur = best.get(`${r.request_id}/${r.analyte}`);
    return cur !== undefined && newer(r, cur) === 0;
  });
};

export interface ProcessContext {
  /** The stored time the join uses: `sampled_at` where two_clocks stores it, else the measured time. */
  join_basis: "sampled_at" | "measured_at";
  join_time: number;
  unit_id: string;
  batch_id: string;
  /** Number of feeds of the batch with `occurred_at` at or before the join time. */
  feed_epoch: number;
  /** After a harvest event, else after a temperature shift event, else before it; events counted as for the feed epoch. */
  batch_phase: "before_shift" | "after_shift" | "harvested";
  /** The last historian value at or before the join time, per signal of the unit. A signal with no visible row is absent. */
  pv: Record<string, number>;
}

/** The last historian value of `unit.signal` at or before `t` among the rows known at `asOf`; for a repeated ts the latest ingested row wins. */
const historianAt = (ds: RecordedDataset, unit: string, signal: string, t: number, asOf: number): number | undefined => {
  const strict = ds.architecture.flags.available_at;
  const candidates: Pick<HistorianRow, "ts" | "value" | "ingested_at">[] = [];
  const s = ds.historian.series.find((x) => x.unit_id === unit && x.signal === signal);
  if (s) {
    const limit = strict ? Math.min(t, asOf) : t; // a tick is ingested at its own stamp
    const j = Math.min(Math.floor((limit - s.t0_s) / s.cadence_s), s.n - 1);
    if (j >= 0) candidates.push({ ts: s.t0_s + j * s.cadence_s, value: s.pv[j] as number, ingested_at: s.t0_s + j * s.cadence_s });
  }
  for (const r of ds.historian.late) if (r.tag === `${unit}.${signal}` && r.ts <= t && (!strict || r.ingested_at <= asOf)) candidates.push(r);
  candidates.sort((a, b) => b.ts - a.ts || b.ingested_at - a.ingested_at);
  return candidates[0]?.value;
};

/** The sample of a result, the time its join uses (the stored time) and what that time is. `sampled_at` whenever the architecture stores it, else the measured time. */
const joinOf = (ds: RecordedDataset, result: ResultRow): { sample: SampleRow; join_basis: "sampled_at" | "measured_at"; join_time: number } | null => {
  const sample = ds.sample.find((s) => s.sample_id === result.request_id);
  if (!sample) return null;
  return sample.sampled_at === null ? { sample, join_basis: "measured_at", join_time: result.measured_at } : { sample, join_basis: "sampled_at", join_time: sample.sampled_at };
};

/**
 * The batch of a result's sample. With write_time_keys on it was fixed at write. Off, it is derived here by a time join (spec section 5):
 * the batch of the sample's unit that is open at the stored time, `inoculated_at` <= t < `harvested_at`; null when none is open (the gross
 * case that VR-020 can see only where `sampled_at` is stored). The batch record is read by valid time.
 */
export const batchOf = (ds: RecordedDataset, result: ResultRow): string | null => {
  const j = joinOf(ds, result);
  if (!j) return null;
  if (j.sample.batch_id !== null) return j.sample.batch_id;
  const t = j.join_time;
  return ds.batch.find((b) => b.unit_id === j.sample.unit_id && b.inoculated_at <= t && (b.harvested_at === null || t < b.harvested_at))?.batch_id ?? null;
};

/**
 * The process context of a result as of a decision time: the as-of join of data_model section 5. The unit comes from the sample row, the
 * batch from `batchOf`, the join time from the stored time (the join basis), the state from the process events and the historian as known
 * at `asOf`. Null when the result has no sample row or no open batch.
 */
export const contextAsOf = (ds: RecordedDataset, result: ResultRow, asOf: number): ProcessContext | null => {
  const j = joinOf(ds, result);
  const batch_id = batchOf(ds, result);
  if (!j || batch_id === null) return null;
  const { sample, join_basis, join_time } = j;
  const strict = ds.architecture.flags.available_at;
  const events: ProcessEventRow[] = ds.process_event.filter(
    (e) => e.unit_id === sample.unit_id && e.batch_id === batch_id && e.occurred_at <= join_time && (!strict || e.ingested_at <= asOf),
  );
  const pv: Record<string, number> = {};
  for (const signal of new Set([...ds.historian.series.filter((x) => x.unit_id === sample.unit_id).map((x) => x.signal as string), ...ds.historian.late.filter((r) => r.tag.startsWith(`${sample.unit_id}.`)).map((r) => r.tag.slice(sample.unit_id.length + 1))])) {
    const v = historianAt(ds, sample.unit_id, signal, join_time, asOf);
    if (v !== undefined) pv[signal] = v;
  }
  return {
    join_basis, join_time, unit_id: sample.unit_id, batch_id,
    feed_epoch: events.filter((e) => e.kind === "feed").length,
    batch_phase: events.some((e) => e.kind === "harvest") ? "harvested" : events.some((e) => e.kind === "temperature_shift") ? "after_shift" : "before_shift",
    pv,
  };
};

import { lastRowAt } from "./tag_read.ts";
import type { HistorianRow, ProcessEventRow, RecordedDataset, ResultRow, SampleRow } from "./types.ts";

// Reads of a recorded dataset "as of" a decision time (data_model section 5, "Bitemporal and as-of rule"; spec section 3 rule 5).
// Valid time (`sampled_at`, `measured_at`, `occurred_at`, `ts`) says when something was true in the lab; transaction time
// (`available_at`, `ingested_at`) says when the system knew it. With the flag `available_at` on, a read at t uses per logical key the
// latest result version with `available_at` at or before t, and only historian rows and process events with `ingested_at` at or
// before t. With it off the read sees everything as of now: a late correction leaks into an earlier decision.
// A row the review step has released is read like an unheld one (from its `available_at`, the review point); a held, quarantined or rejected row is not read.

/**
 * The later version: greatest version, then greatest `available_at`. The version decides first (S2 review step): a version released at review after its successor
 * became available must not rise above it. Until then the two orders were equal, because a later attempt always carried a later stamp.
 */
const newer = (a: ResultRow, b: ResultRow): number => a.version - b.version || (a.available_at ?? 0) - (b.available_at ?? 0);

/** A held, quarantined or rejected row is not available until a reviewer resolves it (data_model sections 6 and 8); `released` and null rows are. */
const unavailable = (r: ResultRow): boolean => r.state === "held" || r.state === "quarantined" || r.state === "rejected";

/**
 * The versions that a retro-flag has superseded (data_model 15.3 item 5; break-out batch 4): version n is replaced by the existence of version n+1 (the row with a `hold_id`), whatever state n+1
 * is in. With available_at on the flag is seen from the instant it was written (`ingested_at` of n+1), so a read before it still sees version n as released. With it off nothing can cut by
 * transaction time and the flag is seen as of now: it leaks backwards. A dataset without a break-out block has no such row.
 */
const flaggedOver = (ds: RecordedDataset, asOf: number, strict: boolean): Set<string> => {
  const out = new Set<string>();
  for (const r of ds.result) if (r.hold_id != null && r.supersedes !== null && (!strict || (r.ingested_at ?? Number.POSITIVE_INFINITY) <= asOf)) out.add(r.supersedes);
  return out;
};

/** The latest version per (request, analyte) that was knowable at `asOf`. Rows tied on both (a double count) are all returned. */
export const resultsAsOf = (ds: RecordedDataset, asOf: number): ResultRow[] => {
  const strict = ds.architecture.flags.available_at;
  const over = flaggedOver(ds, asOf, strict);
  const best = new Map<string, ResultRow>();
  for (const r of ds.result) {
    if (unavailable(r) || over.has(r.result_id)) continue;
    if (strict && (r.available_at === null || r.available_at > asOf)) continue;
    const k = `${r.request_id}/${r.analyte}`;
    const cur = best.get(k);
    if (!cur || newer(r, cur) > 0) best.set(k, r);
  }
  return ds.result.filter((r) => {
    if (unavailable(r) || over.has(r.result_id)) return false;
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

/**
 * The late rows of a dataset by tag, in time order (S2e2: a parsed controller log has about fifty thousand rows, so a read must not scan them). The index is rebuilt when the list
 * grew, and it is keyed by the list itself, so a dataset that is copied with another list gets its own.
 */
const lateIndexes = new WeakMap<readonly HistorianRow[], { n: number; byTag: Map<string, HistorianRow[]> }>();
const lateByTag = (late: readonly HistorianRow[]): Map<string, HistorianRow[]> => {
  const cached = lateIndexes.get(late);
  if (cached && cached.n === late.length) return cached.byTag;
  const byTag = new Map<string, HistorianRow[]>();
  for (const r of late) {
    const rows = byTag.get(r.tag);
    if (rows) rows.push(r);
    else byTag.set(r.tag, [r]);
  }
  for (const rows of byTag.values()) rows.sort((a, b) => a.ts - b.ts || a.ingested_at - b.ingested_at);
  lateIndexes.set(late, { n: late.length, byTag });
  return byTag;
};

/** The signal a historian tag of the unit stands for, or null: `unit.signal` is the layer-off tag and `unit.signal.PV` the process value of the raw layer (data_model 16.4); a set point or an output is not a process value. */
const processSignalOf = (tag: string, unit: string): string | null => {
  if (!tag.startsWith(`${unit}.`)) return null;
  const rest = tag.slice(unit.length + 1);
  const signal = rest.endsWith(".PV") ? rest.slice(0, -3) : rest;
  return signal === "" || signal.includes(".") ? null : signal;
};

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
  const byTag = lateByTag(ds.historian.late);
  for (const tag of [`${unit}.${signal}`, `${unit}.${signal}.PV`]) {
    const row = lastRowAt(byTag.get(tag) ?? [], t, strict ? asOf : Number.POSITIVE_INFINITY);
    if (row) candidates.push(row);
  }
  candidates.sort((a, b) => b.ts - a.ts || b.ingested_at - a.ingested_at);
  return candidates[0]?.value;
};

/** The samples of a dataset by id, the first row of an id winning, as `find` would. Rebuilt when the list grew; keyed by the list itself, like the late rows above. */
const sampleIndexes = new WeakMap<readonly SampleRow[], { n: number; byId: Map<string, SampleRow> }>();
export const sampleById = (ds: RecordedDataset): Map<string, SampleRow> => {
  const cached = sampleIndexes.get(ds.sample);
  if (cached && cached.n === ds.sample.length) return cached.byId;
  const byId = new Map<string, SampleRow>();
  for (const s of ds.sample) if (!byId.has(s.sample_id)) byId.set(s.sample_id, s);
  sampleIndexes.set(ds.sample, { n: ds.sample.length, byId });
  return byId;
};

/** The sample of a result, the time its join uses (the stored time) and what that time is. `sampled_at` whenever the architecture stores it, else the measured time. */
const joinOf = (ds: RecordedDataset, result: ResultRow): { sample: SampleRow; join_basis: "sampled_at" | "measured_at"; join_time: number } | null => {
  const sample = sampleById(ds).get(result.request_id);
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
  const lateSignals = [...lateByTag(ds.historian.late).keys()].flatMap((tag) => processSignalOf(tag, sample.unit_id) ?? []);
  for (const signal of new Set([...ds.historian.series.filter((x) => x.unit_id === sample.unit_id).map((x) => x.signal as string), ...lateSignals])) {
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

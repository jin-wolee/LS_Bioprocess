import { batchOf, resultsAsOf, sampleById } from "../asof.ts";
import { hasValue } from "../types.ts";
import type { RecordedDataset, ResultRow } from "../types.ts";
import type { ItemKind, Reach, Signal, WalkBack, WalkItem } from "./types.ts";

// The walk-back of an investigation (spec 11.4 L5; 11.8.2 rule S8; data_model 15.4), directions 1 and 3. Direction 2 (harvests, pools, downstream lots) waits for genealogy in S4. Every read is AS OF the
// decision time D, through the rules of data_model section 5:
//   with available_at on a row exists at D when its `available_at` is at or before D; with it off nothing can cut by transaction time and only the valid time is left (`occurred_at` of an edge,
//   `measured_at` of a result), so a record entered late about something that happened before D is read as if it had been there (the leak of 15.3 item 5).
// Direction 1: the batch of the signal and its results whose stored time (`sampled_at`, else the measured time) is at or after the estimated onset. Direction 3: exactly one step back from the batch
// along consumed_in, seeded_from and used_in to its lots, its seed parent and its equipment items, then forward along the same relations to the other batches that used them, and for each of those
// the results at or after its first use of a shared item. No step goes further: a batch that shares something only with a sibling is not reached. A kind whose flag is off is not reachable and
// its edges are not read, even if the dataset holds some.

interface Use {
  kind: "material_lot" | "equipment";
  id: string;
  batch: string;
  at: number;
  relation: string;
}
interface Known {
  r: ResultRow;
  batch: string | null;
  stored: number;
}

/** The edges the architecture stores for the kinds it links, known at D. */
const usesAt = (ds: RecordedDataset, D: number): Use[] => {
  const flags = ds.architecture.flags;
  const eventBatch = new Map(ds.process_event.map((p) => [p.event_id, p.batch_id]));
  return (ds.lineage_edge ?? []).flatMap((e) => {
    const linked = e.relation === "used_in" ? flags.equipment_links : flags.material_lot_links;
    const known = flags.available_at ? e.available_at !== null && e.available_at <= D : e.occurred_at <= D;
    const batch = e.to_kind === "batch" ? e.to_id : eventBatch.get(e.to_id);
    return linked && known && batch !== undefined ? [{ kind: e.from_kind, id: e.from_id, batch, at: e.occurred_at, relation: e.relation }] : [];
  });
};

/** The routine results known at D, the latest version of each key, with their batch and their stored time. */
const resultsAt = (ds: RecordedDataset, D: number): Known[] => {
  const samples = sampleById(ds);
  return resultsAsOf(ds, D).filter((r) => hasValue(r) && r.measured_at <= D).map((r) => ({ r, batch: batchOf(ds, r), stored: samples.get(r.request_id)?.sampled_at ?? r.measured_at }));
};

const sorted = <T>(xs: Iterable<T>, key: (x: T) => string): T[] => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const unique = <T extends { id: string }>(xs: T[]): T[] => sorted(new Map(xs.map((x) => [x.id, x])).values(), (x) => x.id);

export const walkBack = (ds: RecordedDataset, signal: Signal, decision_at: number, assumed_lag_s: number): WalkBack => {
  const flags = ds.architecture.flags;
  const estimated_onset = signal.at - assumed_lag_s;
  const reachable: Reach = { lots: flags.material_lot_links, equipment: flags.equipment_links, direction3: flags.material_lot_links || flags.equipment_links };
  const known = resultsAt(ds, decision_at);
  const item = (direction: 1 | 3, kind: ItemKind, id: string, batch: string | null, path: string): WalkItem => ({ direction, kind, id, batch, path });
  /** The results of a batch at or after a stored time, oldest first. */
  const resultsOf = (direction: 1 | 3, batch: string, since: number, path: string): WalkItem[] =>
    known.filter((k) => k.batch === batch && k.stored >= since).sort((a, b) => a.stored - b.stored || (a.r.result_id < b.r.result_id ? -1 : 1)).map((k) => item(direction, "result", k.r.result_id, batch, path));

  // direction 1
  const items: WalkItem[] = [];
  if (ds.batch.some((b) => b.batch_id === signal.batch_id && b.inoculated_at <= decision_at)) items.push(item(1, "batch", signal.batch_id, signal.batch_id, `the signalling batch of ${signal.unit_id}`));
  items.push(...resultsOf(1, signal.batch_id, estimated_onset, `of ${signal.batch_id}, at or after the estimated onset`));
  if (!reachable.direction3) return { signal, decision_at, estimated_onset, reachable, items };

  // direction 3: one step back to what the batch used, one step forward to who else used it
  const uses = usesAt(ds, decision_at);
  const mine = uses.filter((u) => u.batch === signal.batch_id);
  const carried = new Set(mine.map((u) => `${u.kind}|${u.id}`));
  for (const u of unique(mine.filter((x) => x.kind === "material_lot"))) items.push(item(3, "material_lot", u.id, null, `${u.relation} of ${signal.batch_id}`));
  for (const u of unique(mine.filter((x) => x.kind === "equipment"))) items.push(item(3, "equipment", u.id, null, `${u.relation} of ${signal.batch_id}`));
  const siblings = new Map<string, { since: number; via: Set<string> }>();
  for (const u of uses) {
    if (u.batch === signal.batch_id || !carried.has(`${u.kind}|${u.id}`)) continue;
    const s = siblings.get(u.batch) ?? { since: Number.POSITIVE_INFINITY, via: new Set<string>() };
    siblings.set(u.batch, { since: Math.min(s.since, u.at), via: s.via.add(u.id) });
  }
  for (const [batch, s] of sorted(siblings, ([b]) => b)) {
    items.push(item(3, "batch", batch, batch, `shares ${[...s.via].sort().join(", ")} with ${signal.batch_id}`));
    items.push(...resultsOf(3, batch, s.since, `of ${batch}, at or after its first use of a shared item`));
  }
  return { signal, decision_at, estimated_onset, reachable, items };
};

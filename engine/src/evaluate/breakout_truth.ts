import type { Event } from "../generated/event.schema";
import { factsOf } from "./truth.ts";
import type { Truth } from "./truth.ts";

// `T`, the set of items a break-out event truly touched (spec 11.6 and rule S10 of 11.8.2), computed from the truth log. Item kinds are result, batch, material lot and equipment. `T` is: the routine
// results of an affected unit drawn at or after its onset (not the confirming samples, and not the sample of a sampling origin, which is taken before the organism enters), the affected batches, and
// the origin lot or equipment item. Direction 1 is the first signalling unit (its batch and its results); direction 3 is the origin lot or equipment item, the other affected batches and their results.
// The search universe of the false-alarm rate is, for direction 1, the signalling batch and its routine results; for direction 3 all lots and equipment items of the run, all other batches and their
// routine results. Only the evaluator reads this (section 3, rule 2): the recorded side never sees an onset, an origin or an affected unit.

export type ItemKind = "batch" | "material_lot" | "equipment" | "result";
export type Direction = 1 | 3;

/** The key of an item: its kind and its id. A result is `<request>/<analyte>`, the request being the id the record holds the sample under (so a label error does not hide a result). */
export const itemKey = (kind: ItemKind, id: string): string => `${kind}:${id}`;

export interface TruthItem {
  kind: ItemKind;
  direction: Direction;
  /** In hand at the first signal (rule S10): a batch still running, a lot or equipment item that exists (nothing is quarantined yet), a result drawn and not yet released. */
  in_hand: boolean;
  /**
   * A result only: the instant the truth world released it (the last passing QC of its request), null if it never was. It decides what is in hand at the first signal (C38); whether a result
   * stood released before containment is what the record showed, read by the metrics (C39, F3).
   */
  released_at: number | null;
}

export interface BreakoutTruth {
  /** The first signal of the log: the investigation walks back from it, and time to containment starts at it. */
  signal: { unit_id: string; batch_id: string; at: number };
  /** `T` by item key. */
  touched: ReadonlyMap<string, TruthItem>;
  /** The search universe of each direction by item key; it contains the items of `T` of that direction. */
  universe: Readonly<Record<Direction, ReadonlySet<string>>>;
}

type Ev<T extends Event["type"]> = Extract<Event, { type: T }>;
const of = <T extends Event["type"]>(events: readonly Event[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);

/**
 * `held` maps a physical sample id to the id the record holds it under (the error answer key says which: a label error makes the record hold it under another id). The default is the sample's own id.
 * Throws on a truth without a break-out event or without the topology: the break-out metrics are only defined on that path.
 */
export const breakoutTruth = (truth: Truth, held: (sample_id: string) => string = (s) => s): BreakoutTruth => {
  const topology = truth.breakout;
  if (topology === undefined) throw new Error("break-out truth: the truth has no topology (the assembly hands it the lots and the equipment items of the break-out block)");
  const onsets = of(truth.events, "contamination_onset");
  const first = of(truth.events, "signal_observed")[0];
  if (onsets.length === 0 || first === undefined) throw new Error("break-out truth: the truth log has no contamination onset or no first signal");
  const signal = { unit_id: first.unit_id, batch_id: first.batch_id, at: first.t };
  const origin = { kind: onsets[0]?.origin_kind, id: onsets[0]?.origin_id };
  const onsetOf = new Map(onsets.map((o) => [o.unit_id, o.t]));
  const directionOf = (unit_id: string): Direction => (unit_id === signal.unit_id ? 1 : 3);

  // the routine results of the run: one per (request, analyte), with the instant the truth released it
  const analytes = new Map<string, Set<string>>();
  for (const e of of(truth.events, "result_measured")) analytes.set(e.request_id, (analytes.get(e.request_id) ?? new Set()).add(e.analyte));
  const facts = factsOf(truth);
  const results = truth.requests.flatMap((r) =>
    r.sampled_at === null ? [] : [...(analytes.get(r.request_id) ?? [])].sort().map((analyte) => ({ r, key: itemKey("result", `${held(r.request_id)}/${analyte}`), released_at: facts.get(r.request_id)?.released_at ?? null })),
  );

  // a batch is in hand while it is running: inoculated at or before the signal and not yet harvested or stopped
  const inoculated = new Map(of(truth.events, "inoculation").map((e) => [e.batch_id, e.t]));
  const ended = new Map<string, number>();
  for (const e of of(truth.events, "process_event")) if ((e.kind === "harvest" || e.kind === "unit_stopped") && !ended.has(e.batch_id)) ended.set(e.batch_id, e.t);
  const running = (batch_id: string): boolean => (inoculated.get(batch_id) ?? Infinity) <= signal.at && (ended.get(batch_id) ?? Infinity) > signal.at;
  const lotPrepared = new Map(topology.lots.map((l) => [l.lot_id, l.prepared_at]));

  const touched = new Map<string, TruthItem>();
  for (const o of onsets) touched.set(itemKey("batch", o.batch_id), { kind: "batch", direction: directionOf(o.unit_id), in_hand: running(o.batch_id), released_at: null });
  if (origin.kind === "seed_lot" || origin.kind === "medium_lot") touched.set(itemKey("material_lot", origin.id as string), { kind: "material_lot", direction: 3, in_hand: (lotPrepared.get(origin.id as string) ?? 0) <= signal.at, released_at: null });
  if (origin.kind === "shared_equipment") touched.set(itemKey("equipment", origin.id as string), { kind: "equipment", direction: 3, in_hand: true, released_at: null });
  for (const x of results) {
    const onset = onsetOf.get(x.r.unit_id);
    if (onset === undefined || (x.r.sampled_at as number) < onset || (origin.kind === "sampling" && x.r.request_id === origin.id)) continue;
    const in_hand = (x.r.sampled_at as number) <= signal.at && (x.released_at === null || x.released_at > signal.at);
    touched.set(x.key, { kind: "result", direction: directionOf(x.r.unit_id), in_hand, released_at: x.released_at });
  }

  const batches = new Set(of(truth.events, "inoculation").map((e) => e.batch_id));
  const universe: Record<Direction, Set<string>> = {
    1: new Set([itemKey("batch", signal.batch_id), ...results.filter((x) => x.r.batch_id === signal.batch_id).map((x) => x.key)]),
    3: new Set([
      ...topology.lots.map((l) => itemKey("material_lot", l.lot_id)), ...topology.equipment.map((e) => itemKey("equipment", e.equipment_id)),
      ...[...batches].filter((b) => b !== signal.batch_id).map((b) => itemKey("batch", b)), ...results.filter((x) => x.r.batch_id !== signal.batch_id).map((x) => x.key),
    ]),
  };
  return { signal, touched, universe };
};

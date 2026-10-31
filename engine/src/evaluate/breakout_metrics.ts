import type { WalkBack } from "../record/investigate/types.ts";
import type { RecordedDataset } from "../record/types.ts";
import { parseKey, recordedId } from "./answer_key.ts";
import { breakoutTruth, itemKey } from "./breakout_truth.ts";
import type { BreakoutTruth, Direction, ItemKind } from "./breakout_truth.ts";
import { ratio } from "./ratio.ts";
import type { Ratio } from "./ratio.ts";
import { quantile } from "./stats.ts";
import type { Truth } from "./truth.ts";

// The six extension metrics of S3 (spec 11.6, resolved by rule S10 of 11.8.2): time to containment, identification recall, precision and false-alarm rate by direction, released-before-containment share
// and retro-flag completeness. "Draws beyond the port limit" needs perfusion (S4). Every ratio carries its denominator in words, and a ratio with a zero denominator has the value null, never 0 or 1
// (`ratio`). Recall is never shown without precision and false alarm (section 8, anti-gaming rule 3). There is no composite score and no ordering. Identification is scored on the walk-back of the first
// signal; time to containment on the first hold from any signal.

export const KINDS = ["batch", "material_lot", "equipment", "result"] as const satisfies readonly ItemKind[];

export interface Containment {
  /** Items of `T` of the kind that were in hand at the first signal and were held (numerator) over all of them (denominator); an item never held counts as not contained. */
  contained: Ratio;
  /** Over the held items only, in seconds from the first signal to the first hold, nearest rank; null when none was held. */
  median_s: number | null;
  p90_s: number | null;
  /** The time of each held item, ascending. */
  times_s: number[];
}

export interface Identification {
  recall: Ratio;
  precision: Ratio;
  false_alarm: Ratio;
}

export interface BreakoutMetrics {
  architecture: string;
  /** The first signal: the investigation starts from it. */
  signal: BreakoutTruth["signal"];
  /** What direction 3 can read from this record (rule S8): lots and the seed parent need `material_lot_links`, equipment needs `equipment_links`. A direction that cannot be read returns nothing because it cannot look, not because nothing is there. */
  reach: { direction3: boolean; lots: boolean; equipment: boolean };
  containment: Record<ItemKind, Containment>;
  identification: { direction_1: Identification; direction_3: Identification };
  released_before_containment: Ratio;
  retro_flag_completeness: Ratio;
}

/** What the evaluator reads of an investigation: the recorded dataset after it (holds, versions, audit events) and the walk-back of each signal. The `Investigation` of record/investigate has more and fits. */
export interface InvestigatedRecord {
  dataset: RecordedDataset;
  walks: readonly WalkBack[];
}

export interface BreakoutEvalInput {
  /** The truth with the topology of the break-out block (`truth.breakout`). */
  truth: Truth;
  /** The recorded dataset of one architecture after the investigation, with the walk-backs. */
  investigation: InvestigatedRecord;
  /** The text of the answer key file written by the assembly; this function reads it only to learn under which id the record holds each sample. */
  key_text: string;
  architecture: string;
}

const DIRECTION_WORDS: Record<Direction, string> = { 1: "direction 1 (the signalling unit)", 3: "direction 3 (other batches that share a lot, the seed or equipment)" };

/** The key of the item a hold or a walk-back names, as the record holds it: a result by its request and analyte (the id is the result id of a version). */
const recordedKey = (ds: RecordedDataset): ((kind: ItemKind, id: string) => string) => {
  const byId = new Map(ds.result.map((r) => [r.result_id, r]));
  return (kind, id) => {
    if (kind !== "result") return itemKey(kind, id);
    const r = byId.get(id);
    return itemKey("result", r === undefined ? id : `${r.request_id}/${r.analyte}`);
  };
};

const identification = (t: BreakoutTruth, returned: ReadonlySet<string>, d: Direction): Identification => {
  const inT = [...t.touched].filter(([, x]) => x.direction === d).map(([k]) => k);
  const hit = [...returned].filter((k) => t.touched.get(k)?.direction === d).length;
  const clean = [...t.universe[d]].filter((k) => !t.touched.has(k));
  const false_alarms = [...returned].filter((k) => t.universe[d].has(k) && !t.touched.has(k)).length;
  return {
    recall: ratio(hit, inT.length, `items of T in ${DIRECTION_WORDS[d]}`),
    precision: ratio(hit, returned.size, `items the walk-back returned in ${DIRECTION_WORDS[d]}`),
    false_alarm: ratio(false_alarms, clean.length, `items of the search universe of ${DIRECTION_WORDS[d]} that are not in T`),
  };
};

export const breakoutMetrics = (input: BreakoutEvalInput): BreakoutMetrics => {
  const { investigation: inv } = input;
  const ds = inv.dataset;
  const key = parseKey(input.key_text, input.architecture);
  const t = breakoutTruth(input.truth, (sample) => recordedId(key, sample));
  const walk = inv.walks[0];
  if (walk === undefined) throw new Error("break-out metrics: the investigation made no walk-back (no signal)");
  const keyOf = recordedKey(ds);

  // identification: the walk-back of the first signal
  const returned = (d: Direction): Set<string> => new Set(walk.items.filter((i) => i.direction === d).map((i) => keyOf(i.kind, i.id)));

  // containment: the first hold on each item, from any signal
  const firstHold = new Map<string, number>();
  for (const h of ds.quality_hold ?? []) {
    const k = keyOf(h.target_kind, h.target_id);
    firstHold.set(k, Math.min(firstHold.get(k) ?? Infinity, h.placed_at));
  }
  const containment = Object.fromEntries(
    KINDS.map((kind): [ItemKind, Containment] => {
      const inHand = [...t.touched].filter(([, x]) => x.kind === kind && x.in_hand).map(([k]) => k);
      const times = inHand.flatMap((k) => (firstHold.has(k) ? [(firstHold.get(k) as number) - t.signal.at] : [])).sort((a, b) => a - b);
      return [kind, { contained: ratio(times.length, inHand.length, `items of T of kind ${kind} in hand at the first signal`), median_s: quantile(times, 0.5), p90_s: quantile(times, 0.9), times_s: times }];
    }),
  ) as Record<ItemKind, Containment>;

  // released before containment: a result of T the truth released at or before its first hold (the investigation runs after the review of an instant, so a release at the instant of the hold stood first, C25), or never held
  const results = [...t.touched].filter(([, x]) => x.kind === "result");
  const before = results.filter(([k, x]) => x.released_at !== null && x.released_at <= (firstHold.get(k) ?? Infinity));

  // retro-flag completeness: a later version with the hold reference beside the version it supersedes, and the person and the reason stored
  const present = new Set(ds.result.map((r) => r.result_id));
  const holds = new Set((ds.quality_hold ?? []).map((h) => h.hold_id));
  const complete = new Set(
    ds.result.flatMap((v) => {
      const audit = ds.audit_event.some((a) => a.hold_id === v.hold_id && a.new_version === v.version && a.placed_by != null && a.reason != null);
      return v.hold_id != null && v.supersedes !== null && present.has(v.supersedes) && holds.has(v.hold_id) && audit ? [keyOf("result", v.result_id)] : [];
    }),
  );

  return {
    architecture: input.architecture,
    signal: t.signal,
    reach: { ...walk.reachable },
    containment,
    identification: { direction_1: identification(t, returned(1), 1), direction_3: identification(t, returned(3), 3) },
    released_before_containment: ratio(before.length, results.length, "results in T"),
    retro_flag_completeness: ratio(before.filter(([k]) => complete.has(k)).length, before.length, "results in T released before containment"),
  };
};

import type { ReviewConfig } from "../review.ts";

// The shapes of the investigation (spec 11.4 L5 and 11.8.2 rules S8 and S9; data_model 15.4). It is a step after recording, on the recorded side: it reads a recorded dataset and plain data from the
// observable stream, and it knows nothing of the truth world.

/** A first process signal of a unit: plain data from the assembly, taken from the observable event `signal_observed` (the recorded tables hold no row for it). */
export interface Signal {
  unit_id: string;
  batch_id: string;
  at: number;
}

/** The decision settings. The delays are scenario inputs without defaults (A176); the assumed lag is a decision setting, not truth (11.4). All in seconds. */
export interface InvestigationConfig {
  /** d1: from a signal to the decision, the walk-back and the holds. */
  decision_delay_s: number;
  /** d2: from a positive confirming result to the quarantine, and from the last negative one to the release of a hold (its use for a release is assumed). */
  conclusion_delay_s: number;
  /** Signal minus this is the estimated onset: the default is the lag of the suspected type (A139, A138), swept over its range. */
  assumed_lag_s: number;
  /** The review points of the versions that a hold quarantines (A215). */
  review: ReviewConfig;
}

export type ItemKind = "batch" | "material_lot" | "equipment" | "result";

/** One item the walk-back returns, with the direction that reached it and the path (data_model 15.4 item 4). */
export interface WalkItem {
  direction: 1 | 3;
  kind: ItemKind;
  /** The batch id, lot id, equipment id or result id of the latest version known at the decision time. */
  id: string;
  /** The batch the item belongs to (a batch or a result of it); null for a lot or an equipment item. It tells which confirming sample the hold on the item waits for. */
  batch: string | null;
  path: string;
}

/** What direction 3 can read from this record: a kind whose flag is off is `false` and returns no item, which is not the same as an empty set (rule S8). */
export interface Reach {
  direction3: boolean;
  lots: boolean;
  equipment: boolean;
}

export interface WalkBack {
  signal: Signal;
  decision_at: number;
  estimated_onset: number;
  reachable: Reach;
  items: WalkItem[];
}

/** What the investigation did, in time order. The events of spec 11.4 that belong to the per-architecture step, with the quarantine and the rejection of a hold named too. */
export type InvestigationEvent =
  | { type: "hold_placed" | "hold_quarantined" | "hold_released" | "hold_rejected"; t: number; hold_id: string }
  | { type: "result_reflagged"; t: number; result_id: string; hold_id: string }
  | { type: "deviation_closed"; t: number; deviation_id: string };

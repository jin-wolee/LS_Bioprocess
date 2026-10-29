import type { ObservableEvent } from "../observe.ts";
import type { Architecture } from "../record/architecture.ts";

// The error injector (S2b, prompts/20 Step 2). It works on the observable stream only, receives everything it needs as plain data from the
// experiment assembly, and returns plain data; the assembly writes the answer key. Types: the rows of the hypothesis matrix of spec section 5
// that an injector can materialise, plus planned-versus-actual time (a structural limit of preset B, not a random error).

/** In the order of the matrix, then planned-versus-actual time. */
export const ERROR_TYPES = ["label_error", "feed_in_gap", "unit_rekey", "clock_offset", "duplicate_replay", "lost_rerun", "unattributable_record", "planned_vs_actual"] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

/** The types with a random opportunity per sample: a keyed draw `u`, materialised when u < rate. The others follow from the stream and the flags. */
export const DRAWN_TYPES = ["label_error", "unit_rekey", "duplicate_replay"] as const;
export type DrawnType = (typeof DRAWN_TYPES)[number];
/** The types that can have no ledger rate: a drawn type other than the label error, and the clock error (A049 gives an example offset, no frequency). */
export type NotModelled = Exclude<DrawnType, "label_error"> | "clock_offset";

/** Matrix rows that are not injected, with the reason: the effect sits in the truth world or has no source in the layer-off stream. */
export const NOT_INJECTED = {
  instrument_effect: "truth-side: the bias of an instrument is part of the L3 measurement (A032); the injector has nothing to materialise",
  late_correction: "no late correction exists in the layer-off observable stream (the historian late list is empty until the raw layer); no ledger rate",
  technique_error: "truth-side: a technique error changes the sample itself (A064), so it belongs to the truth world and experiment 2",
} as const;

export interface Opportunity {
  type: DrawnType;
  /** Uniform in [0, 1), independent of architecture and detection. */
  u: number;
}

export type Detail = Record<string, string | number>;

/** One realised error: what the answer key lists. Plain data. */
export interface MaterialisedError {
  type: ErrorType;
  /** The physical sample the error sits on (its true id). */
  sample_id: string;
  detail: Detail;
}

/** Forced mode: an error to materialise whatever the rate. `detail` gives the content (the id the label reads, the unit it names). */
export interface ForcedError {
  type: DrawnType;
  sample_id: string;
  detail?: { as_id?: string; to_unit?: string };
}

export interface InjectInput {
  /** The run seed of the canonical key tuple. */
  seed: number;
  architecture: { id: string; flags: Architecture["flags"] };
  events: readonly ObservableEvent[];
  /** Production: the probability of a label error per sample, by sampler (plain data from the assembly, derived from the staff profile). */
  label_rate_by_operator?: Readonly<Record<string, number>>;
  /** Seconds each analyzer clock runs ahead of the host (negative: behind), by analyzer id (A049; +5 h = 18000 s in fixtures). */
  clock_offsets?: Readonly<Record<string, number>>;
  /** When present the injector runs in forced mode: these errors are materialised (where a mechanism exists) and no rate is read. */
  forced?: readonly ForcedError[];
}

export interface InjectResult {
  /** The stream this architecture's recorder sees. */
  events: ObservableEvent[];
  /** The host's receipt time of each result whose instrument stamp was moved, by source event id. */
  received_at: Record<string, number>;
  materialised: MaterialisedError[];
  /** Production only: types that have no ledger rate and were therefore not materialised (a clock error only where the scenario names no offset). */
  not_modelled: NotModelled[];
}

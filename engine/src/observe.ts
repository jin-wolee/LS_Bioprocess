import type { Event } from "./generated/event.schema";
import type { SensorSeries } from "./sensors.ts";

// Truth log to observable stream (spec section 3). Recorders see observable events only. Hidden fields carry
// "x-visibility": "hidden" in data/schemas/event.schema.json; this table mirrors those annotations and a test compares the two.
const HIDDEN = {
  result_measured: ["true_value", "noise", "stability_kind", "stability_delta", "extrapolated"],
  sample_drawn: ["true_state"],
  sensor_tick: ["true_value"],
  calibration_recorded: ["drift_before_pct"],
} as const;
export const HIDDEN_FIELDS: Record<string, readonly string[]> = HIDDEN;
/** Event types that exist in the truth log only (data/schemas/event.schema.json marks the whole definition `x-visibility: hidden`; spec 11.8.2 rule S6): `observe` drops them, a recorder never meets them. */
export const TRUTH_ONLY_TYPES = ["contamination_onset"] as const;
type TruthOnly = (typeof TRUTH_ONLY_TYPES)[number];

type Visible<E> = E extends { type: infer T } ? (T extends TruthOnly ? never : T extends keyof typeof HIDDEN ? Omit<E, (typeof HIDDEN)[T][number]> : E) : never;
/** One event as a recorder sees it: the generated event type with the fields of HIDDEN_FIELDS removed from its type, not only from its value. */
export type ObservableEvent = Visible<Event>;

/** The events a person or an instrument could see: the truth events with every hidden field removed. */
export const observe = (events: readonly Event[]): Record<string, unknown>[] =>
  events.filter((e) => !(TRUTH_ONLY_TYPES as readonly string[]).includes(e.type)).map((e) => {
    const hidden = HIDDEN_FIELDS[e.type];
    if (!hidden) return { ...e };
    const copy: Record<string, unknown> = { ...e };
    for (const field of hidden) delete copy[field];
    return copy;
  });

/** `observe`, typed: the same projection of the truth log, as the type a recorder takes. */
export const observeEvents = (events: readonly Event[]): ObservableEvent[] => observe(events) as unknown as ObservableEvent[];

/** What a recorder sees of one online sensor series: the process value only. The truth array of the engine's series is not part of this type. */
export interface ObservableSensorSeries extends Pick<SensorSeries, "unit_id" | "signal" | "t0_s" | "cadence_s" | "n"> {
  /** Process values at `t0_s + j * cadence_s`, read-only (the array is the engine's own, not a copy). */
  readonly pv: Readonly<ArrayLike<number>>;
}

/** S2a: the observable view of the sensor series. Fields are listed one by one, so a field added to SensorSeries later stays hidden until it is named here. */
export const observeSensors = (series: readonly SensorSeries[]): ObservableSensorSeries[] =>
  series.map((s) => ({ unit_id: s.unit_id, signal: s.signal, t0_s: s.t0_s, cadence_s: s.cadence_s, n: s.n, pv: s.pv }));

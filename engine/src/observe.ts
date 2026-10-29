import type { Event } from "./generated/event.schema";

// Truth log to observable stream (spec section 3). Recorders see observable events only. Hidden fields carry
// "x-visibility": "hidden" in schemas/event.schema.json; this table mirrors those annotations and a test compares the two.
export const HIDDEN_FIELDS: Record<string, readonly string[]> = {
  result_measured: ["true_value", "noise", "stability_kind", "stability_delta", "extrapolated"],
  sample_drawn: ["true_state"],
  sensor_tick: ["true_value"],
  calibration_recorded: ["drift_before_pct"],
};

/** The events a person or an instrument could see: the truth events with every hidden field removed. */
export const observe = (events: readonly Event[]): Record<string, unknown>[] =>
  events.map((e) => {
    const hidden = HIDDEN_FIELDS[e.type];
    if (!hidden) return { ...e };
    const copy: Record<string, unknown> = { ...e };
    for (const field of hidden) delete copy[field];
    return copy;
  });

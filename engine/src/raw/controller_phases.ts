import type { ObservableEvent } from "../observe.ts";
import type { PhaseTransition } from "./controller_types.ts";

// RQ11 (spec 2.4.3), the production mapping of observable events to ISA-88 phases (data_model section 7, S2e2 table). One unit procedure per batch with two phases that mirror the
// batch phases of the process context (data_model 5): `before_shift` runs from the inoculation to the temperature shift (or to the harvest when there is none) and `after_shift`
// from the shift to the harvest. A phase goes idle -> running when it starts and running -> complete when it ends. A feed is a bolus at an instant and a scripted alarm is an
// alarm event: neither starts a phase. A batch still open at the end of the horizon has no end transition. Holds, pauses and aborts have no source in the stream (no operator
// command is modelled), so a production run writes none; they are tested on hand-given transitions.

export const BEFORE_SHIFT = "before_shift";
export const AFTER_SHIFT = "after_shift";

export const phaseTransitions = (events: readonly ObservableEvent[]): PhaseTransition[] => {
  const out: PhaseTransition[] = [];
  for (const e of events) {
    if (e.type !== "inoculation") continue;
    const own = events.filter((x): x is Extract<ObservableEvent, { type: "process_event" }> => x.type === "process_event" && x.batch_id === e.batch_id);
    const shift = own.find((x) => x.kind === "temperature_shift");
    const harvest = own.find((x) => x.kind === "harvest");
    const step = (phase: string, from: string, to: string, ts: number): void => {
      out.push({ unit: e.unit_id, batch: e.batch_id, phase, from, to, ts });
    };
    step(BEFORE_SHIFT, "idle", "running", e.t);
    if (shift && (!harvest || shift.t < harvest.t)) {
      step(BEFORE_SHIFT, "running", "complete", shift.t);
      step(AFTER_SHIFT, "idle", "running", shift.t);
      if (harvest) step(AFTER_SHIFT, "running", "complete", harvest.t);
    } else if (harvest) step(BEFORE_SHIFT, "running", "complete", harvest.t);
  }
  return out.sort((a, b) => a.ts - b.ts);
};

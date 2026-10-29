import type { ObservableEvent, ObservableSensorSeries } from "../observe.ts";
import type { TagSeries } from "./controller_types.ts";

// The tag series a controller logs, built from observable data only (spec 2.4.1, rule 1): the process value is the observable sensor series, the set point is the scenario's set
// point (A198) and, for the temperature, the set point of the observable shift event (A195). OUT is not modelled: the generic controller rule that computes it has no ledger entry
// (spec 2.4.8). The L1 signals of spec 2.4.4 that are not in A100 (agitation, gas flows, pumps, off-gas CO2) are absent too: they would have to come from the truth run.

export interface SetPoints {
  pH: number;
  DO: number;
  temperature: number;
}

type ProcessEvent = Extract<ObservableEvent, { type: "process_event" }>;

/** All process values first (in the order of the sensor series), then the set points of the same signals. The temperature set point steps to the shift value from the tick at or after the shift. */
export const tagSeries = (sensors: readonly ObservableSensorSeries[], events: readonly ObservableEvent[], sp: SetPoints): TagSeries[] => {
  const shifts = new Map<string, ProcessEvent>();
  for (const e of events) if (e.type === "process_event" && e.kind === "temperature_shift") shifts.set(e.unit_id, e);
  const pv: TagSeries[] = sensors.map((s) => ({ unit: s.unit_id, signal: s.signal, role: "PV", t0_s: s.t0_s, cadence_s: s.cadence_s, n: s.n, at: (j) => s.pv[j] as number }));
  const setPoint = (s: ObservableSensorSeries): ((j: number) => number) => {
    if (s.signal !== "temperature") return () => sp[s.signal];
    const shift = shifts.get(s.unit_id);
    if (!shift || shift.amount === undefined) return () => sp.temperature;
    const { t, amount } = shift;
    return (j) => (s.t0_s + j * s.cadence_s >= t ? amount : sp.temperature);
  };
  const spSeries: TagSeries[] = sensors.map((s) => ({ unit: s.unit_id, signal: s.signal, role: "SP", t0_s: s.t0_s, cadence_s: s.cadence_s, n: s.n, at: setPoint(s) }));
  return [...pv, ...spSeries];
};

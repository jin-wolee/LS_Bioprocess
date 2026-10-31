import type { BreakoutConfig } from "../../breakout/config.ts";
import type { BreakoutReport } from "../../generated/breakout_report.schema";
import type { BreakoutCase } from "./breakout.ts";

// What the SC12 report prints of a case besides its numbers (spec 11.7, 11.8.1): every input the ledger gives no number for, the topology (A177), and what the scenario injects. They are inputs
// of the scenario, printed with every result as inputs and never as findings. Seconds are turned back into the unit the scenario states them in (hours).

type Case = BreakoutReport["cases"][number];

const HOUR = 3600;

/** The ledger id of an origin: the lot, the equipment item, the unit or the sample that the scenario names. */
const originId = (o: BreakoutConfig["origin"]): string =>
  o.kind === "seed_lot" || o.kind === "medium_lot" ? o.lot_id : o.kind === "shared_equipment" ? o.equipment_id : o.kind === "unit_equipment" ? o.unit_id : o.sample_id;

export const eventOf = (c: BreakoutCase, b: BreakoutConfig): Case["event"] => ({
  type: b.profile.contamination_type, profile: b.profile.profile_id, origin_kind: b.origin.kind, origin_id: originId(b.origin), horizon_days: c.scenario.process.horizon_s / 86400,
});

export const inputsOf = (c: BreakoutCase, b: BreakoutConfig): Case["inputs"] => {
  const p = b.profile;
  const lagRef = p.params.onset_to_signal_lag_h?.ref ?? "A139";
  const rampRef = p.ramp_input === undefined ? (p.params.signal_ramp_h?.ref ?? "A141") : (p.inputs[p.ramp_input]?.ref ?? "A141");
  const hours = (name: string, ref: string, seconds: number, source: Case["inputs"][number]["source"], what: string): Case["inputs"][number] => ({ name, ref, value: seconds / HOUR, unit: "h", source, what });
  return [
    hours("signal_to_response", "A176", b.signal_to_response_s, "scenario_input", "d1: from the first signal to the scripted response (the stop of each affected unit, the confirming draws, the decision and the holds)"),
    hours("positive_to_hold", "A176", b.positive_to_hold_s, "scenario_input", "d2: from a positive result to the quarantine; also used for a release after the last negative result, for which no source exists (assumed)"),
    hours("lag", lagRef, b.lag_s, b.lag_s === p.lag_s ? "profile_default" : "scenario_input", "from the onset to the first signal (the true lag of the event)"),
    // a profile with a ramp input lists the ramp among its inputs below
    ...(p.ramp_input === undefined ? [hours("ramp", rampRef, b.ramp_s, b.ramp_s === p.ramp_s ? "profile_default" : "scenario_input", "the length of the signal ramp, which ends at the first signal")] : []),
    ...Object.entries(b.inputs).map(([name, x]): Case["inputs"][number] => ({ name, ref: x.ref, value: x.value, unit: x.unit, source: "scenario_input", what: `an input of the event type ${p.profile_id} with no default${x.unit === "mL" ? " (a sample volume)" : ""}` })),
    hours("assumed_lag", c.assumed_lag.ref, c.assumed_lag.seconds, "decision_setting", `the walk-back estimates the onset as the first signal minus this${c.assumed_lag.swept ? " (swept in this case)" : " (the lag of the scenario)"}; a decision setting, not truth`),
  ];
};

const unique = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

export const topologyOf = (b: BreakoutConfig): Case["topology"] => ({
  ref: "A177",
  lots: b.lots.map((l) => ({ lot_id: l.lot_id, kind: l.kind, units: unique(b.consumption.filter((k) => k.lot_id === l.lot_id).map((k) => k.unit_id)) })),
  equipment: b.equipment.map((e) => ({ equipment_id: e.equipment_id, name: e.name, units: unique(b.use.filter((u) => u.equipment_id === e.equipment_id).map((u) => u.unit_id)) })),
});

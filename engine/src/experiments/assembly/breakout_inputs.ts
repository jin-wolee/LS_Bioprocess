import type { BreakoutConfig } from "../../breakout/config.ts";
import type { BreakoutReport } from "../../generated/breakout_report.schema";
import { inoculationInstant } from "../../process.ts";
import type { BreakoutCase } from "./breakout.ts";

// What the SC12 report prints of a case besides its numbers (spec 11.7, 11.8.1, C40): every input the ledger gives no number for, the topology (A177) with its instants, and what the scenario
// injects with the horizon (A189) and the origin's contaminated_at (A157). They are inputs of the scenario, printed with every result as inputs and never as findings. Seconds are turned back into
// the unit the scenario states them in (hours).

type Case = BreakoutReport["cases"][number];

const HOUR = 3600;

/** The ledger id of an origin: the lot, the equipment item, the unit or the sample that the scenario names. */
const originId = (o: BreakoutConfig["origin"]): string =>
  o.kind === "seed_lot" || o.kind === "medium_lot" ? o.lot_id : o.kind === "shared_equipment" ? o.equipment_id : o.kind === "unit_equipment" ? o.unit_id : o.sample_id;

/** The instant the origin became contaminated, as the scenario sets it (A157); none for a sampling origin, whose onset is the instant of a draw the seed decides. */
const contaminatedAt = (o: BreakoutConfig["origin"]): Case["event"]["contaminated_at"] => {
  const s = o.kind === "sampling" ? null : o.kind === "unit_equipment" ? o.at_s : o.contaminated_s;
  return s === null ? null : { value: s / HOUR, unit: "h", ref: "A157" };
};

export const eventOf = (c: BreakoutCase, b: BreakoutConfig): Case["event"] => ({
  type: b.profile.contamination_type, profile: b.profile.profile_id, origin_kind: b.origin.kind, origin_id: originId(b.origin), horizon_days: c.scenario.process.horizon_s / 86400, horizon_ref: "A189",
  contaminated_at: contaminatedAt(b.origin),
});

export const inputsOf = (c: BreakoutCase, b: BreakoutConfig): Case["inputs"] => {
  const p = b.profile;
  const lagRef = p.params.onset_to_signal_lag_h?.ref ?? "A139";
  const rampRef = p.ramp_input === undefined ? (p.params.signal_ramp_h?.ref ?? "A141") : (p.inputs[p.ramp_input]?.ref ?? "A141");
  const hours = (name: string, ref: string, seconds: number, source: Case["inputs"][number]["source"], what: string): Case["inputs"][number] => ({ name, ref, value: seconds / HOUR, unit: "h", source, what });
  return [
    hours("signal_to_response", "A176", b.signal_to_response_s, "scenario_input", "d1: from the first signal to the scripted response (the stop of each affected unit, the confirming draws, the decision and the holds)"),
    hours("positive_to_hold", "A176", b.positive_to_hold_s, "scenario_input", "d2: from a positive result to the quarantine"),
    hours("release_delay", "A176", b.positive_to_hold_s, "scenario_input", "from the last negative result to the release of a hold: A227 (the release delay) has no value yet, so the engine reads d2, the second delay of A176, and prints it under A176; no source gives a delay after a negative result (assumed)"),
    hours("lag", lagRef, b.lag_s, b.lag_s === p.lag_s ? "profile_default" : "scenario_input", "from the onset to the first signal (the true lag of the event)"),
    // a profile with a ramp input lists the ramp among its inputs below
    ...(p.ramp_input === undefined ? [hours("ramp", rampRef, b.ramp_s, b.ramp_s === p.ramp_s ? "profile_default" : "scenario_input", "the length of the signal ramp, which ends at the first signal")] : []),
    ...Object.entries(b.inputs).map(([name, x]): Case["inputs"][number] => ({ name, ref: x.ref, value: x.value, unit: x.unit, source: "scenario_input", what: `an input of the event type ${p.profile_id} with no default${x.unit === "mL" ? " (a sample volume)" : ""}` })),
    hours("assumed_lag", c.assumed_lag.ref, c.assumed_lag.seconds, "decision_setting", `the walk-back estimates the onset as the first signal minus this${c.assumed_lag.swept ? " (swept in this case)" : " (the default: the lag of the event type, rule S8)"}; a decision setting, not truth`),
  ];
};

const unique = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

/** The topology (A177): each lot with its prepared_at and each lot or item with the units that consume or use it, and when; a seed lot is consumed at the inoculation of its unit. */
export const topologyOf = (c: BreakoutCase, b: BreakoutConfig): Case["topology"] => {
  const inoculated = (unit_id: string): number => inoculationInstant(c.scenario.process, Number(unit_id.slice(1)) - 1);
  return {
    ref: "A177",
    lots: b.lots.map((l) => {
      const uses = b.consumption.filter((k) => k.lot_id === l.lot_id);
      return { lot_id: l.lot_id, kind: l.kind, units: unique(uses.map((k) => k.unit_id)), prepared_at_h: l.prepared_s / HOUR, uses: uses.map((k) => ({ unit_id: k.unit_id, at_h: (k.at_s ?? inoculated(k.unit_id)) / HOUR })) };
    }),
    equipment: b.equipment.map((e) => {
      const uses = b.use.filter((u) => u.equipment_id === e.equipment_id);
      return { equipment_id: e.equipment_id, name: e.name, units: unique(uses.map((u) => u.unit_id)), uses: uses.map((u) => ({ unit_id: u.unit_id, at_h: u.at_s / HOUR })) };
    }),
  };
};

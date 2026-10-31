import type { ObservableEvent } from "../../src/observe.ts";
import type { BreakoutInput } from "../../src/record/types.ts";
import { BASE, byTime, sampleWithRun } from "./cell_stream.ts";

// The observable streams of the break-out fixtures FX12a and FX12e, typed by hand from spec 11.8.4 (break-out batch 3, row 3 of 11.8.5). Plain data, like the forced cells of section 5: the
// events a recorder sees, with hours from the start of the scenario written as hours and turned into seconds by `H`. Test-only values: the operator, the glucose value of a routine result, the
// 2 mL bioburden volume (a test design choice, as in engine/tests/breakout/support.ts) and the sterility portions of 2 x 20 mL (A148). Every instant below is read off the fixture text.
//
//   A routine sample is drawn at the hour of the table, its run starts 3300 s later and its result is measured at 3600 s: "released one hour after it is drawn" (11.8.4), no rule fires.
//   The confirming sample of a unit is `<unit>-CONF`, drawn at the first decision instant (19 h) with two aliquots: bioburden (result 120 h later, A142) and sterility (336 h, A143). A later
//   signal draws its own, `<unit>-SIG-CONF`, at its own decision (spec 11.8.2 rule S2 as ruled on F8, C5).

export const H = (hours: number): number => Math.round(hours * 3600);

const batchOf = (unit: string): string => `B-${unit}`;
type Ev<T extends ObservableEvent["type"]> = Extract<ObservableEvent, { type: T }>;

export const inoculationFrom = (unit: string, seedLot: string): ObservableEvent => ({ type: "inoculation", t: 0, unit_id: unit, batch_id: batchOf(unit), density_e6_per_ml: 1, seed_lot_id: seedLot });
export const mediumAddition = (hours: number, unit: string, lot: string): ObservableEvent => ({ type: "process_event", t: H(hours), unit_id: unit, batch_id: batchOf(unit), kind: "medium_addition", source: "scripted", lot_id: lot });
export const equipmentUse = (hours: number, unit: string, item: string): ObservableEvent => ({ type: "process_event", t: H(hours), unit_id: unit, batch_id: batchOf(unit), kind: "equipment_use", source: "scripted", equipment_id: item });
export const unitStopped = (hours: number, unit: string): ObservableEvent => ({ type: "process_event", t: H(hours), unit_id: unit, batch_id: batchOf(unit), kind: "unit_stopped", source: "scripted" });
export const signal = (hours: number, unit: string): ObservableEvent => ({ type: "signal_observed", t: H(hours), unit_id: unit, batch_id: batchOf(unit), signal: "DO", limit: "low" });
export const deviationOpened = (hours: number, unit: string): ObservableEvent => ({ type: "deviation_opened", t: H(hours), deviation_id: "DEV-1", unit_id: unit, batch_id: batchOf(unit), trigger: "signal" });

/** One routine sample `<unit>-S<k>` with its run: 3300 s from draw to run start, measured at 3600 s. */
export const routine = (unit: string, k: number, drawnHours: number): ObservableEvent[] => sampleWithRun(`${unit}-S${k}`, unit, H(drawnHours), 3300, 5.0);

/** The confirming sample of a unit drawn at `drawnHours`: both tests report `outcome`. `sample_id` is that of the first signal's draw unless a later signal drew it (C5). */
export const confirming = (unit: string, drawnHours: number, outcome: Ev<"confirm_result">["outcome"], sample_id = `${unit}-CONF`): ObservableEvent[] => {
  const aliquots = [{ aliquot_id: `${sample_id}-A1`, test: "bioburden", volume_ul: 2000 }, { aliquot_id: `${sample_id}-A2`, test: "sterility", volume_ul: 40000 }] as const;
  return [
    { type: "confirm_sample_drawn", t: H(drawnHours), sample_id, unit_id: unit, batch_id: batchOf(unit), operator_id: "OP-1", volume_ul: 42000, tests: [aliquots[0], aliquots[1]] },
    { type: "confirm_result", t: H(drawnHours + 120), sample_id, aliquot_id: aliquots[0].aliquot_id, test: "bioburden", outcome },
    { type: "confirm_result", t: H(drawnHours + 336), sample_id, aliquot_id: aliquots[1].aliquot_id, test: "sterility", outcome },
  ];
};

/** FX12a: U01 takes the contaminated ML-2 at 5 h; U02 shares the clean ML-1 with U01; U03 is apart. U01 signals at 17 h and stops at 19 h; U01 and U02 are confirmed at 19 h. */
export const FX12A: ObservableEvent[] = byTime([
  ...BASE,
  inoculationFrom("U01", "SL-1"), inoculationFrom("U02", "SL-2"), inoculationFrom("U03", "SL-3"),
  mediumAddition(1, "U01", "ML-1"), mediumAddition(1, "U02", "ML-1"), mediumAddition(1, "U03", "ML-3"), mediumAddition(5, "U01", "ML-2"),
  ...routine("U01", 1, 3), ...routine("U01", 2, 8), ...routine("U01", 3, 14),
  ...routine("U02", 1, 4), ...routine("U02", 2, 9), ...routine("U02", 3, 15),
  ...routine("U03", 1, 5), ...routine("U03", 2, 10), ...routine("U03", 3, 16),
  signal(17, "U01"), deviationOpened(17, "U01"), unitStopped(19, "U01"),
  ...confirming("U01", 19, "detected"), ...confirming("U02", 19, "not_detected"),
]);

/**
 * FX12e: the transfer line TL-1 is used by U01 at 5 h and by U02 at 9 h; U03 does not use it. U01 signals at 17 h, U02 at 21 h; both stop 2 h later; U01 and U02 are confirmed at 19 h, and the
 * signal of U02 draws its own sample at 23 h (spec 11.8.4, the FX12e truth row as retyped for F8).
 */
export const FX12E: ObservableEvent[] = byTime([
  ...BASE,
  inoculationFrom("U01", "SL-1"), inoculationFrom("U02", "SL-2"), inoculationFrom("U03", "SL-3"),
  mediumAddition(1, "U01", "ML-1"), mediumAddition(1, "U02", "ML-2"), mediumAddition(1, "U03", "ML-3"),
  equipmentUse(5, "U01", "TL-1"), equipmentUse(9, "U02", "TL-1"),
  ...routine("U01", 1, 3), ...routine("U01", 2, 8), ...routine("U01", 3, 14),
  ...routine("U02", 1, 4), ...routine("U02", 2, 10), ...routine("U02", 3, 16), ...routine("U02", 4, 20),
  ...routine("U03", 1, 5), ...routine("U03", 2, 11), ...routine("U03", 3, 17),
  signal(17, "U01"), deviationOpened(17, "U01"), unitStopped(19, "U01"), signal(21, "U02"), unitStopped(23, "U02"),
  ...confirming("U01", 19, "detected"), ...confirming("U02", 19, "detected"), ...confirming("U02", 23, "detected", "U02-SIG-CONF"),
]);

const LOTS: BreakoutInput["lots"] = [
  { lot_id: "SL-1", kind: "seed", prepared_at: 0 }, { lot_id: "SL-2", kind: "seed", prepared_at: 0 }, { lot_id: "SL-3", kind: "seed", prepared_at: 0 },
  { lot_id: "ML-1", kind: "medium", prepared_at: 0 }, { lot_id: "ML-2", kind: "medium", prepared_at: 0 }, { lot_id: "ML-3", kind: "medium", prepared_at: 0 },
];
/** The topology master data the assembly hands the recorder: six lots, and in FX12a no equipment. */
export const FX12A_MASTER: BreakoutInput = { lots: LOTS, equipment: [] };
export const FX12E_MASTER: BreakoutInput = { lots: LOTS, equipment: [{ equipment_id: "TL-1", name: "Shared transfer line" }] };
/** The master data of FX12a plus a medium lot and an equipment item that no event uses (the lot stays available, the item in service). */
export const FX12A_SPARE: BreakoutInput = { lots: [...LOTS, { lot_id: "ML-9", kind: "medium", prepared_at: H(2) }], equipment: [{ equipment_id: "TL-2", name: "Spare transfer line" }] };

import type { ObservableEvent } from "../../src/observe.ts";
import { FX12A_MASTER, H, deviationOpened, inoculationFrom, mediumAddition, routine, unitStopped } from "./breakout_streams.ts";
import { BASE, byTime } from "./cell_stream.ts";

// The observable stream of the break-out fixture FX12m (mycoplasma, the FX12a layout with different times), typed by hand from spec 11.8.4 (break-out batch 5, row 5 of 11.8.5). Plain data, like
// FX12a and FX12e in breakout_streams.ts: the events a recorder sees, hours from the start of the scenario written as hours and turned into seconds by `H`. Test-only values: the operator, the glucose
// value of a routine result, and the aliquot volumes (a test design choice for the nucleic-acid test, N8; 1 mL of indicator material and 10.5 mL of culture, A148).
//
//   Onset 5 h (U01 takes the contaminated ML-2), signal 53 h (lag 48 h, A138), d1 2 h: U01 stops at 55 h and U01 and U02 are confirmed at 55 h.
//   The confirming sample of a unit has three aliquots, in the order of the profile: the nucleic-acid test (result 1 d later, A146), indicator cells (8 d, A145), culture (28 d, A144).
//   Routine samples are `<unit>-S<k>`, drawn at the hours of the table; U01: 3, 20, 40, 50; U02: 4, 21, 41, 51; U03: 5, 22, 42, 52.

type Outcome = Extract<ObservableEvent, { type: "confirm_result" }>["outcome"];

const batchOf = (unit: string): string => `B-${unit}`;

/** The first signal of a mycoplasma contamination: DO reaches its high alarm. */
const signalHigh = (hours: number, unit: string): ObservableEvent => ({ type: "signal_observed", t: H(hours), unit_id: unit, batch_id: batchOf(unit), signal: "DO", limit: "high" });

/** The confirming sample of a unit drawn at `drawnHours`: the nucleic-acid test reports `nat`, the indicator cells and the culture report `rest`. */
export const confirmingMycoplasma = (unit: string, drawnHours: number, nat: Outcome, rest: Outcome): ObservableEvent[] => {
  const sample_id = `${unit}-CONF`;
  const [a1, a2, a3] = [
    { aliquot_id: `${sample_id}-A1`, test: "nucleic_acid_test", volume_ul: 1000 },
    { aliquot_id: `${sample_id}-A2`, test: "mycoplasma_indicator_cells", volume_ul: 1000 },
    { aliquot_id: `${sample_id}-A3`, test: "mycoplasma_culture", volume_ul: 10500 },
  ] as const;
  return [
    { type: "confirm_sample_drawn", t: H(drawnHours), sample_id, unit_id: unit, batch_id: batchOf(unit), operator_id: "OP-1", volume_ul: 12500, tests: [a1, a2, a3] },
    { type: "confirm_result", t: H(drawnHours + 24), sample_id, aliquot_id: a1.aliquot_id, test: a1.test, outcome: nat },
    { type: "confirm_result", t: H(drawnHours + 192), sample_id, aliquot_id: a2.aliquot_id, test: a2.test, outcome: rest },
    { type: "confirm_result", t: H(drawnHours + 672), sample_id, aliquot_id: a3.aliquot_id, test: a3.test, outcome: rest },
  ];
};

/** FX12m: `natCovers` is the scenario input of A224. In FX12m-i (true) the nucleic-acid test of U01 is detected, in FX12m-ii (false) it is not detected; U02 is not detected in any test. */
export const fx12m = (natCovers: boolean): ObservableEvent[] =>
  byTime([
    ...BASE,
    inoculationFrom("U01", "SL-1"), inoculationFrom("U02", "SL-2"), inoculationFrom("U03", "SL-3"),
    mediumAddition(1, "U01", "ML-1"), mediumAddition(1, "U02", "ML-1"), mediumAddition(1, "U03", "ML-3"), mediumAddition(5, "U01", "ML-2"),
    ...routine("U01", 1, 3), ...routine("U01", 2, 20), ...routine("U01", 3, 40), ...routine("U01", 4, 50),
    ...routine("U02", 1, 4), ...routine("U02", 2, 21), ...routine("U02", 3, 41), ...routine("U02", 4, 51),
    ...routine("U03", 1, 5), ...routine("U03", 2, 22), ...routine("U03", 3, 42), ...routine("U03", 4, 52),
    signalHigh(53, "U01"), deviationOpened(53, "U01"), unitStopped(55, "U01"),
    ...confirmingMycoplasma("U01", 55, natCovers ? "detected" : "not_detected", "detected"), ...confirmingMycoplasma("U02", 55, "not_detected", "not_detected"),
  ]);

export const FX12M_I: ObservableEvent[] = fx12m(true);
export const FX12M_II: ObservableEvent[] = fx12m(false);
/** The topology of FX12m is that of FX12a: six lots, no equipment. */
export const FX12M_MASTER = FX12A_MASTER;

import type { PlanHold, ScenePlan } from "../protocol.ts";
import { handPlan } from "./fixture.ts";

// A break-out case typed by hand for the tests of P7c (docs/design/plant_ui.md sections 3.2 and 4.1): the hand plan of fixture.ts (two reactors, U01 inoculated at 1000 s and U02 at 2000 s) with the
// three lots, the equipment item, the confirming samples and the holds a case adds. Every instant is a round number so that the expected values of the tests are hand arithmetic. Not a run of the engine.
//
//   Lots (string order): ML-1 (medium) is added to U01 and U02 at 3000 s, ML-2 (medium) to U02 at 6000 s, SL-A (seed) is taken by U01 at 1000 s and by U02 at 2000 s (their inoculations).
//   TL-1 is used on U01 at 4000 s and on U02 at 8000 s.
//   Confirming samples (indices 8 to 11, after the eight planned ones): U01-CONF and U02-CONF drawn at 9000 s, U02-SIG-CONF skipped for the volume budget at 9500 s, U01-SIG-CONF drawn at 12000 s.
//   Results: U01-CONF reports bioburden `detected` at 20000 s and sterility `detected` at 30000 s, U02-CONF bioburden `not_detected` at 20000 s.
//   Holds of c_context: U02 (unit 1), ML-1 (lot 0) and TL-1 (equipment 0) are held at 7500 s; U02 and ML-1 are quarantined at 10000 s; ML-1 and TL-1 are released at 25000 s; a result of sample 0 is
//   re-flagged at 26000 s and the deviation is closed at 27000 s. Holds of a_manual: U02 is held at 9000 s and nothing else.

type Sample = ScenePlan["samples"][number];
const confirm = (id: string, unit: number, operator: number | null, drawn_s: number, skipped = false): Sample => ({
  id, unit, operator, planned_s: drawn_s, drawn_s, arrived_s: null, label: null, kind: "confirm", skipped, visits: [],
});

export const C_HOLDS: PlanHold[] = [
  { t: 7500, event: "hold_placed", on: "unit", target: 1 },
  { t: 7500, event: "hold_placed", on: "lot", target: 0 },
  { t: 7500, event: "hold_placed", on: "equipment", target: 0 },
  { t: 10000, event: "hold_quarantined", on: "unit", target: 1 },
  { t: 10000, event: "hold_quarantined", on: "lot", target: 0 },
  { t: 25000, event: "hold_released", on: "lot", target: 0 },
  { t: 25000, event: "hold_released", on: "equipment", target: 0 },
  { t: 26000, event: "result_reflagged", on: "sample", target: 0 },
  { t: 27000, event: "deviation_closed", on: null, target: null },
];
export const A_HOLDS: PlanHold[] = [{ t: 9000, event: "hold_placed", on: "unit", target: 1 }];

export const casePlan = (): ScenePlan => {
  const base = handPlan();
  return {
    ...base,
    layout: { ...base.layout, architectures: ["a_manual", "c_context"], items: { lots: ["ML-1", "ML-2", "SL-A"], equipment: ["TL-1"] } },
    samples: [...base.samples, confirm("U01-CONF", 0, 0, 9000), confirm("U02-CONF", 1, 1, 9000), confirm("U02-SIG-CONF", 1, null, 9500, true), confirm("U01-SIG-CONF", 0, 0, 12000)],
    marks: [
      { t: 3000, unit: 0, kind: "medium_addition", source: "scripted", item: "ML-1" },
      { t: 3000, unit: 1, kind: "medium_addition", source: "scripted", item: "ML-1" },
      { t: 4000, unit: 0, kind: "equipment_use", source: "scripted", item: "TL-1" },
      { t: 6000, unit: 1, kind: "medium_addition", source: "scripted", item: "ML-2" },
      { t: 7000, unit: 1, kind: "signal_observed", source: null, item: "DO" },
      { t: 7500, unit: 1, kind: "deviation_opened", source: null, item: "DEV-1" },
      { t: 8000, unit: 1, kind: "equipment_use", source: "scripted", item: "TL-1" },
      { t: 9000, unit: 0, kind: "harvest", source: "scheduled", item: null },
      { t: 12000, unit: 1, kind: "unit_stopped", source: "scripted", item: null },
    ],
    records: [
      { architecture: "a_manual", flags_on: [], cards: [], holds: A_HOLDS },
      { architecture: "c_context", flags_on: ["material_lot_links", "equipment_links"], cards: [], holds: C_HOLDS },
    ],
    lots: [
      { id: "ML-1", kind: "medium", uses: [{ unit: 0, t: 3000 }, { unit: 1, t: 3000 }] },
      { id: "ML-2", kind: "medium", uses: [{ unit: 1, t: 6000 }] },
      { id: "SL-A", kind: "seed", uses: [{ unit: 0, t: 1000 }, { unit: 1, t: 2000 }] },
    ],
    equipment: [{ id: "TL-1", uses: [{ unit: 0, t: 4000 }, { unit: 1, t: 8000 }] }],
    confirms: [
      { sample: 8, test: "bioburden", result_s: 20000, outcome: "detected" },
      { sample: 9, test: "bioburden", result_s: 20000, outcome: "not_detected" },
      { sample: 8, test: "sterility", result_s: 30000, outcome: "detected" },
    ],
  };
};

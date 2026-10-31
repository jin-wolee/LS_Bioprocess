import { beforeAll, describe, expect, it } from "vitest";
import type { BreakoutMetrics } from "../src/evaluate/breakout_metrics.ts";
import type { ItemKind } from "../src/evaluate/breakout_truth.ts";
import { FX12A, FX12A_MASTER, FX12E, FX12E_MASTER, H } from "./support/breakout_streams.ts";
import { metricsOf } from "./support/breakout_truth_setup.ts";
import type { Onset } from "./support/breakout_truth_setup.ts";
import { FX12M_I, FX12M_II, FX12M_MASTER } from "./support/fx12m_streams.ts";
import { CFG, nameOf, run } from "./support/investigate_setup.ts";
import type { Name } from "./support/investigate_setup.ts";

// SC12 Contamination break-out and walk-back (spec 11.5, 11.8): after one reactor shows a contamination signal, how fast and how completely can each architecture find everything the event touched?
// The tables of the forced-error fixtures FX12a, FX12e and FX12m of spec 11.8.4 are checked cell by cell, for the metrics of rule S10. Every expected value below is typed by hand from those tables
// (the counts of items, "x of y"; the times in hours), never read off the code. The streams are the observable events of the hand-built fixtures with the hidden onsets that the engine would log
// (Onset 5 h of U01 in FX12a and FX12m, 5 h of U01 and 9 h of U02 in FX12e); d1 2 h, d2 4 h and the assumed lag 12 h (48 h in FX12m) are the test design choices of 11.8.4. Structural: no ordering of
// architectures and no composite score is asserted anywhere (section 8, anti-gaming rule 8).

type R = [number, number];
interface Cell {
  /** Direction 3 can be read from this record at all (rule S8). */
  reachable: boolean;
  d3: { recall: R; precision: R; false_alarm: R };
  /** Per kind: items held over items in hand at the first signal, and the time of each held item in hours. */
  contained: Partial<Record<ItemKind, { held: R; hours: number[] }>>;
  released: R;
  retro: R;
}
const D1 = { recall: [3, 3] as R, precision: [3, 3] as R, false_alarm: [0, 1] as R };

const pair = (r: { num: number; den: number }): R => [r.num, r.den];
const checkCell = (m: BreakoutMetrics, cell: Cell, d1: typeof D1): void => {
  const i = m.identification;
  expect([pair(i.direction_1.recall), pair(i.direction_1.precision), pair(i.direction_1.false_alarm)], "direction 1").toEqual([d1.recall, d1.precision, d1.false_alarm]);
  expect(m.reach.direction3, "direction 3 reachable").toBe(cell.reachable);
  expect([pair(i.direction_3.recall), pair(i.direction_3.precision), pair(i.direction_3.false_alarm)], "direction 3").toEqual([cell.d3.recall, cell.d3.precision, cell.d3.false_alarm]);
  for (const kind of ["batch", "material_lot", "equipment", "result"] as const) {
    const want = cell.contained[kind] ?? { held: [0, 0] as R, hours: [] };
    expect([pair(m.containment[kind].contained), m.containment[kind].times_s.map((s) => s / 3600)], `containment of ${kind}`).toEqual([want.held, want.hours]);
  }
  expect(pair(m.released_before_containment), "released before containment").toEqual(cell.released);
  expect(pair(m.retro_flag_completeness), "retro-flag completeness").toEqual(cell.retro);
};

/** The rows of the tables that the investigation itself produces and the metrics build on: holds placed at an instant, retro-flag versions, the first hold of an item. */
type Stream = Parameters<typeof run>[0];
type Master = Parameters<typeof run>[1];
const heldAt = (events: Stream, master: Master, n: Name, hours: number, cfg = CFG): number => (run(events, master, n, cfg).dataset.quality_hold ?? []).filter((h) => h.placed_at === H(hours)).length;
const versionsOf = (events: Stream, master: Master, n: Name, cfg = CFG): number => run(events, master, n, cfg).dataset.result.filter((r) => r.hold_id != null).length;
const firstHoldOf = (events: Stream, master: Master, n: Name, item: string): number | undefined => {
  const ds = run(events, master, n).dataset;
  return (ds.quality_hold ?? []).filter((h) => nameOf(ds, h.target_kind, h.target_id) === item).map((h) => h.placed_at).sort((a, b) => a - b)[0];
};

describe("SC12 contamination break-out and walk-back", () => {
  describe("FX12a: a contaminated batch shares a medium lot with a clean batch (U01 consumes the contaminated ML-2 at 5 h)", () => {
    const onsets: Onset[] = [{ unit: "U01", hours: 5, kind: "medium_lot", origin: "ML-2" }];
    // T: direction 1 is B-U01, U01-S2, U01-S3; direction 3 is the lot ML-2. Universe of direction 3: 6 lots, 2 other batches, 6 results = 14, 13 not in T. Items in hand at 17 h: B-U01 and ML-2.
    const NOTHING_D3 = { recall: [0, 1] as R, precision: [0, 0] as R, false_alarm: [0, 13] as R };
    const CELLS: Record<"A" | "B" | "C" | "C-L", Cell> = {
      A: { reachable: false, d3: NOTHING_D3, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [0, 1], hours: [] } }, released: [2, 2], retro: [0, 2] },
      B: { reachable: true, d3: NOTHING_D3, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [0, 1], hours: [] } }, released: [2, 2], retro: [0, 2] },
      C: { reachable: true, d3: { recall: [1, 1], precision: [1, 7], false_alarm: [6, 13] }, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [1, 1], hours: [2] } }, released: [2, 2], retro: [2, 2] },
      "C-L": { reachable: true, d3: NOTHING_D3, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [0, 1], hours: [] } }, released: [2, 2], retro: [2, 2] },
    };
    it.each(["A", "B", "C", "C-L"] as const)("Given the FX12a record under %s When the walk-back of the signal at 17 h is scored against T Then every metric equals the typed cell", (n) => {
      checkCell(metricsOf(FX12A, FX12A_MASTER, onsets, n), CELLS[n], D1);
    });
    // "Holds placed at 19 h": 3, 3, 10, 3. "VR-022 and retro-flag versions at 19 h": not evaluable and 0 in A and B, 5 in C, 2 in C-L.
    const HOLDS: Record<"A" | "B" | "C" | "C-L", [number, number]> = { A: [3, 0], B: [3, 0], C: [10, 5], "C-L": [3, 2] };
    it.each(["A", "B", "C", "C-L"] as const)("Given the FX12a record under %s When the investigation has run at 19 h Then it has placed the typed holds and made the typed retro-flag versions", (n) => {
      expect([heldAt(FX12A, FX12A_MASTER, n, 19), versionsOf(FX12A, FX12A_MASTER, n)]).toEqual(HOLDS[n]);
    });
  });

  describe("FX12e: equipment origin, an affected sibling that signals later (U01 uses the contaminated TL-1 at 5 h, U02 at 9 h)", () => {
    const onsets: Onset[] = [{ unit: "U01", hours: 5, kind: "shared_equipment", origin: "TL-1" }, { unit: "U02", hours: 9, kind: "shared_equipment", origin: "TL-1" }];
    // T: direction 1 is B-U01, U01-S2, U01-S3; direction 3 is TL-1, B-U02, U02-S2, U02-S3, U02-S4 (5 items). Universe of direction 3: 6 lots, 1 item, 2 other batches, 7 results = 16, 11 not in T.
    // In hand at 17 h: B-U01, B-U02, TL-1 (U02-S3 is released at 17 h itself and U02-S4 is not drawn yet).
    const CELLS: Record<"A" | "B" | "C" | "C-L" | "C-E", Cell> = {
      A: { reachable: false, d3: { recall: [0, 5], precision: [0, 0], false_alarm: [0, 11] }, contained: { batch: { held: [2, 2], hours: [2, 6] }, equipment: { held: [0, 1], hours: [] } }, released: [5, 5], retro: [0, 5] },
      B: { reachable: true, d3: { recall: [4, 5], precision: [4, 4], false_alarm: [0, 11] }, contained: { batch: { held: [2, 2], hours: [2, 2] }, equipment: { held: [1, 1], hours: [2] } }, released: [5, 5], retro: [0, 5] },
      C: { reachable: true, d3: { recall: [4, 5], precision: [4, 6], false_alarm: [2, 11] }, contained: { batch: { held: [2, 2], hours: [2, 2] }, equipment: { held: [1, 1], hours: [2] } }, released: [5, 5], retro: [5, 5] },
      "C-L": { reachable: true, d3: { recall: [4, 5], precision: [4, 4], false_alarm: [0, 11] }, contained: { batch: { held: [2, 2], hours: [2, 2] }, equipment: { held: [1, 1], hours: [2] } }, released: [5, 5], retro: [5, 5] },
      "C-E": { reachable: true, d3: { recall: [0, 5], precision: [0, 2], false_alarm: [2, 11] }, contained: { batch: { held: [2, 2], hours: [2, 6] }, equipment: { held: [0, 1], hours: [] } }, released: [5, 5], retro: [5, 5] },
    };
    it.each(["A", "B", "C", "C-L", "C-E"] as const)("Given the FX12e record under %s When the walk-back of the first signal is scored against T Then every metric equals the typed cell", (n) => {
      checkCell(metricsOf(FX12E, FX12E_MASTER, onsets, n), CELLS[n], D1);
    });
    // "Holds placed at 19 h": 3, 7, 9, 7, 5. "Holds placed at 23 h" (the signal of U02 runs the same procedure): 4, 1, 3, 1, 6. "First hold of B-U02": 23 h, 19 h, 19 h, 19 h, 23 h.
    const HOLDS: Record<"A" | "B" | "C" | "C-L" | "C-E", [number, number, number]> = { A: [3, 4, 23], B: [7, 1, 19], C: [9, 3, 19], "C-L": [7, 1, 19], "C-E": [5, 6, 23] };
    it.each(["A", "B", "C", "C-L", "C-E"] as const)("Given the FX12e record under %s When the two signals have been investigated Then the holds at 19 h and at 23 h and the first hold of B-U02 are the typed ones", (n) => {
      const [at19, at23, first] = HOLDS[n];
      expect([heldAt(FX12E, FX12E_MASTER, n, 19), heldAt(FX12E, FX12E_MASTER, n, 23), firstHoldOf(FX12E, FX12E_MASTER, n, "batch:B-U02")]).toEqual([at19, at23, H(first)]);
    });
  });

  describe("FX12m: mycoplasma, the FX12a layout with different times (onset 5 h, signal 53 h, lag 48 h)", () => {
    const onsets: Onset[] = [{ unit: "U01", hours: 5, kind: "medium_lot", origin: "ML-2" }];
    const cfg = { ...CFG, assumed_lag_s: H(48) };
    // T: direction 1 is B-U01, U01-S2, U01-S3, U01-S4; direction 3 is ML-2. Universe of direction 3: 6 lots, 2 other batches, 8 results = 16, 15 not in T.
    const D1M = { recall: [4, 4] as R, precision: [4, 4] as R, false_alarm: [0, 1] as R };
    const NOTHING_D3 = { recall: [0, 1] as R, precision: [0, 0] as R, false_alarm: [0, 15] as R };
    const CELLS: Record<"A" | "B" | "C" | "C-L", Cell> = {
      A: { reachable: false, d3: NOTHING_D3, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [0, 1], hours: [] } }, released: [3, 3], retro: [0, 3] },
      B: { reachable: true, d3: NOTHING_D3, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [0, 1], hours: [] } }, released: [3, 3], retro: [0, 3] },
      C: { reachable: true, d3: { recall: [1, 1], precision: [1, 8], false_alarm: [7, 15] }, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [1, 1], hours: [2] } }, released: [3, 3], retro: [3, 3] },
      "C-L": { reachable: true, d3: NOTHING_D3, contained: { batch: { held: [1, 1], hours: [2] }, material_lot: { held: [0, 1], hours: [] } }, released: [3, 3], retro: [3, 3] },
    };
    describe.each([["i, the nucleic-acid target covers the organism", FX12M_I], ["ii, it does not", FX12M_II]] as const)("FX12m-%s", (_title, events) => {
      it.each(["A", "B", "C", "C-L"] as const)("Given the FX12m record under %s When the walk-back of the signal at 53 h is scored against T Then every metric equals the typed cell", (n) => {
        checkCell(metricsOf(events, FX12M_MASTER, onsets, n, cfg), CELLS[n], D1M);
      });
      // "Holds placed at 55 h": 4, 4, 12, 4. "Retro-flag versions at 55 h": not evaluable and 0 in A and B, 7 in C, 3 in C-L.
      const HOLDS: Record<"A" | "B" | "C" | "C-L", [number, number]> = { A: [4, 0], B: [4, 0], C: [12, 7], "C-L": [4, 3] };
      it.each(["A", "B", "C", "C-L"] as const)("Given the FX12m record under %s When the investigation has run at 55 h Then it has placed the typed holds and made the typed retro-flag versions", (n) => {
        expect([heldAt(events, FX12M_MASTER, n, 55, cfg), versionsOf(events, FX12M_MASTER, n, cfg)]).toEqual(HOLDS[n]);
      });
    });
  });

  describe("The two ablation pairs: lot links (C against C-L) and equipment links (C against C-E)", () => {
    const med: Onset[] = [{ unit: "U01", hours: 5, kind: "medium_lot", origin: "ML-2" }];
    const eq: Onset[] = [{ unit: "U01", hours: 5, kind: "shared_equipment", origin: "TL-1" }, { unit: "U02", hours: 9, kind: "shared_equipment", origin: "TL-1" }];
    const pairs: [string, Onset[], Name, Name][] = [["FX12a, lot links", med, "C", "C-L"], ["FX12e, equipment links", eq, "C", "C-E"]];
    let cache: Record<string, [BreakoutMetrics, BreakoutMetrics]>;
    beforeAll(() => {
      cache = {
        "FX12a, lot links": [metricsOf(FX12A, FX12A_MASTER, med, "C"), metricsOf(FX12A, FX12A_MASTER, med, "C-L")],
        "FX12e, equipment links": [metricsOf(FX12E, FX12E_MASTER, eq, "C"), metricsOf(FX12E, FX12E_MASTER, eq, "C-E")],
      };
    });
    it.each(pairs)("Given %s When the full record and the record without the flag are scored Then direction 1 is equal in every metric and direction 3 differs", (title) => {
      const [full, without] = cache[title] as [BreakoutMetrics, BreakoutMetrics];
      expect(without.identification.direction_1).toEqual(full.identification.direction_1);
      expect(without.identification.direction_3).not.toEqual(full.identification.direction_3);
    });
  });
});

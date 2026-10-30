import { beforeAll, describe, expect, it } from "vitest";
import type { Investigation } from "../../src/record/investigate/investigate.ts";
import type { QualityHoldRow, RecordedDataset } from "../../src/record/types.ts";
import { H } from "../support/breakout_streams.ts";
import { FX12M_I, FX12M_II, FX12M_MASTER } from "../support/fx12m_streams.ts";
import { CFG, nameOf, names, placedAt, rec, returned, run, versions } from "../support/investigate_setup.ts";
import type { Name } from "../support/investigate_setup.ts";

// Break-out batch 5, row 5 of spec 11.8.5: FX12m recorded and investigated under A, B, C, C without material_lot_links (C-L) and C without equipment_links (C-E; FX12m has no equipment, so C-E equals C).
// Every expected value is typed by hand from the FX12m table of spec 11.8.4 (and rules S8, S9 of 11.8.2), never read off the code. d1 = 2 h, d2 = 4 h, assumed lag 48 h (the A138 default): the
// decision is at 55 h (signal 53 h plus 2 h), the estimated onset is 53 - 48 = 5 h. The results: nucleic-acid 79 h, indicator cells 247 h, culture 727 h; U01 detected in the indicator cells and the
// culture, and in the nucleic-acid test in FX12m-i (the target covers the organism) and not in FX12m-ii; U02 not detected in any.
//   The conversion to quarantine is the first positive plus d2: i, 79 + 4 = 83 h; ii, 247 + 4 = 251 h. Day 0 is a Monday and the roster of A201 has a second shift starting at 13:00. 83 h is day 3
//   (Thursday) 11:00, so the next review point is Thursday 13:00 = 85 h; 251 h is day 10 (Thursday) 11:00, so the review point is 253 h.
//   The release of U02 is the last negative plus d2 = 727 + 4 = 731 h, day 30 (Wednesday) 11:00; its review point is 13:00 = 733 h.
//   The closing is the later of the last confirming result (727 h) and the last end of a hold: 731 h in C and C-E (the hold on B-U02), 727 h where B-U02 was not held.

const FIVE = ["A", "B", "C", "C-L", "C-E"] as const satisfies readonly Name[];
const U01 = ["batch:B-U01", "result:U01-S2", "result:U01-S3", "result:U01-S4"];
const U02 = ["batch:B-U02", "result:U02-S1", "result:U02-S2", "result:U02-S3", "result:U02-S4"];
const LOTS = ["material_lot:SL-1", "material_lot:ML-1", "material_lot:ML-2"];
const CFG_M = { ...CFG, assumed_lag_s: H(48) };

interface Cell {
  reachable: { direction3: boolean; lots: boolean; equipment: boolean };
  dir3: string[];
  holds: string[];
  versions: string[];
  rejected: string[];
  released: string[];
  closed_at: number;
}
const WITH_LOTS = (reachable: Cell["reachable"]): Cell => ({
  reachable, dir3: names(...LOTS, ...U02), holds: names(...U01, ...LOTS, ...U02),
  versions: names("U01-S2/v2", "U01-S3/v2", "U01-S4/v2", "U02-S1/v2", "U02-S2/v2", "U02-S3/v2", "U02-S4/v2"), rejected: names(...U01, ...LOTS), released: names(...U02), closed_at: H(731),
});
const CELL: Record<(typeof FIVE)[number], Cell> = {
  A: { reachable: { direction3: false, lots: false, equipment: false }, dir3: [], holds: names(...U01), versions: [], rejected: names(...U01), released: [], closed_at: H(727) },
  B: { reachable: { direction3: true, lots: false, equipment: true }, dir3: [], holds: names(...U01), versions: [], rejected: names(...U01), released: [], closed_at: H(727) },
  C: WITH_LOTS({ direction3: true, lots: true, equipment: true }),
  "C-L": { reachable: { direction3: true, lots: false, equipment: true }, dir3: [], holds: names(...U01), versions: names("U01-S2/v2", "U01-S3/v2", "U01-S4/v2"), rejected: names(...U01), released: [], closed_at: H(727) },
  "C-E": WITH_LOTS({ direction3: true, lots: true, equipment: false }),
};

describe.each([
  ["i (the nucleic-acid target covers the organism)", FX12M_I, H(83), H(85)],
  ["ii (it does not)", FX12M_II, H(251), H(253)],
] as const)("FX12m-%s", (_title, events, quarantineAt, reviewAt) => {
  describe.each(FIVE)("investigated under %s", (n) => {
    let inv: Investigation;
    let ds: RecordedDataset;
    let before: RecordedDataset;
    const holdOf = (name: string): QualityHoldRow => (ds.quality_hold ?? []).find((h) => nameOf(ds, h.target_kind, h.target_id) === name) as QualityHoldRow;
    beforeAll(() => {
      before = rec(events, FX12M_MASTER, n);
      inv = run(events, FX12M_MASTER, n, CFG_M);
      ds = inv.dataset;
    });
    const cell = CELL[n];

    it("Given the signal at 53 h When the walk-back runs Then the decision is at 55 h and the estimated onset is the true onset, 5 h", () => {
      expect(inv.walks.length).toBe(1);
      expect(inv.walks[0]?.decision_at).toBe(H(55));
      expect(inv.walks[0]?.estimated_onset).toBe(H(5));
    });

    it("Then direction 1 returns the batch and the results at or after 5 h (U01-S1 is at 3 h, measured 4 h, and is not returned)", () => {
      expect(returned((inv.walks[0]?.items ?? []).filter((i) => i.direction === 1), ds)).toEqual(names(...U01));
    });

    it("Then direction 3 has the typed reach and returns the typed items (in C and C-E the lots, the sibling batch and its four results)", () => {
      expect(inv.walks[0]?.reachable).toEqual(cell.reachable);
      expect(returned((inv.walks[0]?.items ?? []).filter((i) => i.direction === 3), ds)).toEqual(cell.dir3);
    });

    it("Then the holds placed at 55 h are the typed ones: 4 in A, B and C-L, 12 in C and C-E (the 4, three lots, B-U02 and its four results), and no other hold exists", () => {
      expect(placedAt(ds, H(55))).toEqual(cell.holds);
      expect((ds.quality_hold ?? []).length).toBe(n === "C" || n === "C-E" ? 12 : 4);
    });

    it("Then VR-022 is not evaluable in A and B (0 versions) and fires in C and C-E (7 versions) and C-L (3 versions) at 55 h", () => {
      expect(inv.not_evaluable.map((x) => x.rule)).toEqual(n === "A" || n === "B" ? ["VR-022"] : []);
      expect(versions(ds)).toEqual(cell.versions);
      expect(ds.result.filter((r) => r.hold_id != null).every((r) => r.ingested_at === H(55))).toBe(true);
    });

    it("Then the first positive plus d2 turns the holds on B-U01, its results (and in C the lots) into quarantine, and they are rejected at the next review point", () => {
      for (const name of cell.rejected) {
        const h = holdOf(name);
        expect([name, h.kind, h.outcome, h.released_at, h.state]).toEqual([name, "quarantine", "rejected", reviewAt, "closed"]);
      }
      const quarantined = inv.events.filter((e) => e.type === "hold_quarantined");
      expect(quarantined.length).toBe(cell.rejected.length);
      expect(quarantined.every((e) => e.t === quarantineAt)).toBe(true);
      expect(inv.events.filter((e) => e.type === "hold_rejected").every((e) => e.t === reviewAt)).toBe(true);
    });

    it("Then the last negative result of U02 at 727 h releases, in C, the hold on B-U02 and its results at 731 h; where B-U02 was never held nothing is released", () => {
      for (const name of cell.released) {
        const h = holdOf(name);
        expect([name, h.kind, h.outcome, h.released_at, h.state]).toEqual([name, "hold", "released", H(731), "closed"]);
      }
      expect(inv.events.filter((e) => e.type === "hold_released").map((e) => e.t)).toEqual(cell.released.map(() => H(731)));
    });

    it("Then the deviation is closed once every confirming result is in and every hold is ended, with the estimated onset and the assumed lag stored", () => {
      const d = (ds.deviation ?? [])[0];
      expect([d?.state, d?.closed_at, d?.closed_by, d?.estimated_onset, d?.assumed_lag]).toEqual(["closed", cell.closed_at, n === "A" ? null : "reviewer", H(5), H(48)]);
      expect(inv.events.filter((e) => e.type === "deviation_closed")).toEqual([{ type: "deviation_closed", t: cell.closed_at, deviation_id: "DEV-1" }]);
    });

    it("Then retro-flag completeness is 3 of 3 where VR-022 runs (C, C-L, C-E) and 0 of 3 where it cannot (A, B): a flagged version, the person and the reason for U01-S2 to U01-S4", () => {
      const complete = ["U01-S2", "U01-S3", "U01-S4"].filter((request) => {
        const v = ds.result.find((r) => r.request_id === request && r.hold_id != null);
        const audit = ds.audit_event.find((a) => a.hold_id !== undefined && a.hold_id === v?.hold_id && a.new_version === v?.version);
        return v !== undefined && audit?.placed_by === "reviewer" && typeof audit?.reason === "string";
      });
      expect(complete.length).toBe(n === "A" || n === "B" ? 0 : 3);
    });

    it("Then version n is never modified: every row of the recorded dataset is still in the result table, equal to what the recorder wrote", () => {
      for (const row of before.result) expect(ds.result.find((r) => r.result_id === row.result_id)).toEqual(row);
    });
  });
});

describe("FX12m under C: the retro-flag versions follow data_model 15.3", () => {
  let ds: RecordedDataset;
  const versionOf = (request: string) => ds.result.find((r) => r.request_id === request && r.hold_id != null);
  beforeAll(() => {
    ds = run(FX12M_I, FX12M_MASTER, "C", CFG_M).dataset;
  });

  it.each(["U01-S2", "U01-S3", "U01-S4"])("Given the positive of U01 When the review point 85 h comes Then version 2 of %s is rejected with its value kept, reviewed at 85 h, and has no available_at", (request) => {
    const v = versionOf(request);
    expect([v?.version, v?.state, v?.value, v?.reviewed_at, v?.available_at]).toEqual([2, "rejected", 5, H(85), null]);
  });

  it.each(["U02-S1", "U02-S2", "U02-S3", "U02-S4"])("Given the negatives of U02 When the review point 733 h comes Then version 2 of %s is released again with the same value, reviewed and available at 733 h", (request) => {
    const v = versionOf(request);
    expect([v?.version, v?.state, v?.value, v?.reviewed_at, v?.available_at]).toEqual([2, "released", 5, H(733), H(733)]);
  });

  it("Then the lots under the positive are quarantined (SL-1 and ML-1 stay quarantined: a precision cost) and the other lots keep their state", () => {
    expect((ds.material_lot ?? []).map((l) => [l.lot_id, l.state])).toEqual([
      ["SL-1", "quarantined"], ["SL-2", "in_use"], ["SL-3", "in_use"], ["ML-1", "quarantined"], ["ML-2", "quarantined"], ["ML-3", "in_use"],
    ]);
  });

  it("Then each confirming sample has its three tests recorded as results with an outcome and no value, the nucleic-acid result of U01 detected in i", () => {
    const confirming = ds.result.filter((r) => r.outcome != null).map((r) => [r.request_id, r.analyte, r.measured_at, r.outcome]);
    expect(confirming).toEqual([
      ["U01-CONF", "nucleic_acid_test", H(79), "detected"], ["U02-CONF", "nucleic_acid_test", H(79), "not_detected"],
      ["U01-CONF", "mycoplasma_indicator_cells", H(247), "detected"], ["U02-CONF", "mycoplasma_indicator_cells", H(247), "not_detected"],
      ["U01-CONF", "mycoplasma_culture", H(727), "detected"], ["U02-CONF", "mycoplasma_culture", H(727), "not_detected"],
    ]);
    expect(ds.result.filter((r) => r.outcome != null).every((r) => r.value === null)).toBe(true);
  });
});

describe("FX12m-ii under C: the nucleic-acid result of U01 is not detected, so nothing converts before the indicator cells", () => {
  it("Given the nucleic-acid negative at 79 h When the holds are read Then none is quarantined at 83 h; the first quarantine is at 251 h, the indicator-cell positive 247 h plus d2", () => {
    const inv = run(FX12M_II, FX12M_MASTER, "C", CFG_M);
    const quarantined = inv.events.filter((e) => e.type === "hold_quarantined").map((e) => e.t);
    expect(quarantined.length).toBe(7);
    expect(quarantined.every((t) => t === H(251))).toBe(true);
    expect(quarantined.some((t) => t === H(83))).toBe(false);
  });
});

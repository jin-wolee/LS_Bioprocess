import { beforeAll, describe, expect, it } from "vitest";
import type { Investigation } from "../../src/record/investigate/investigate.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { FX12E, FX12E_MASTER, H } from "../support/breakout_streams.ts";
import { ALL, nameOf, names, placedAt, returned, run, versions } from "../support/investigate_setup.ts";
import type { Name } from "../support/investigate_setup.ts";

// Break-out batch 4, row 4 of spec 11.8.5: the investigation of FX12e (equipment origin, an affected sibling that signals later) under A, B, C, C without material_lot_links (C-L) and C without
// equipment_links (C-E), including the second signal. Every expected value is typed by hand from the FX12e table of spec 11.8.4, never read off the code. U01 signals at 17 h (decision 19 h,
// estimated onset 5 h), U02 at 21 h (decision 23 h, estimated onset 21 - 12 = 9 h). The transfer line TL-1 is used by U01 at 5 h and by U02 at 9 h. Both units are detected at 139 h and 355 h,
// so every hold becomes quarantine at 139 + 4 = 143 h and is rejected at the review point after it, 152 h (Sunday 08:00); the deviation is closed at the last confirming result, 355 h.
//   B has equipment_links on and not material_lot_links: its direction 3 equals that of C-L.

const U01 = ["batch:B-U01", "result:U01-S2", "result:U01-S3"];
const U02_AT_19 = ["batch:B-U02", "result:U02-S2", "result:U02-S3"];
const U02_AT_23 = ["batch:B-U02", "result:U02-S2", "result:U02-S3", "result:U02-S4"];
const TL = "equipment:TL-1";
const LOTS_1 = ["material_lot:SL-1", "material_lot:ML-1"];
const LOTS_2 = ["material_lot:SL-2", "material_lot:ML-2"];

interface Cell {
  reachable: { direction3: boolean; lots: boolean; equipment: boolean };
  dir3_at_19: string[];
  holds_at_19: string[];
  holds_at_23: string[];
  dir3_at_23: string[];
  first_hold_of_b_u02: number;
  versions: string[];
  flagged_at_19: number;
  flagged_at_23: number;
}
const CELL: Record<Name, Cell> = {
  A: {
    reachable: { direction3: false, lots: false, equipment: false }, dir3_at_19: [], holds_at_19: names(...U01), holds_at_23: names(...U02_AT_23), dir3_at_23: [],
    first_hold_of_b_u02: H(23), versions: [], flagged_at_19: 0, flagged_at_23: 0,
  },
  B: {
    reachable: { direction3: true, lots: false, equipment: true }, dir3_at_19: names(TL, ...U02_AT_19), holds_at_19: names(...U01, TL, ...U02_AT_19), holds_at_23: names("result:U02-S4"),
    dir3_at_23: names(TL, "batch:B-U01", "result:U01-S2", "result:U01-S3"), first_hold_of_b_u02: H(19), versions: [], flagged_at_19: 0, flagged_at_23: 0,
  },
  C: {
    reachable: { direction3: true, lots: true, equipment: true }, dir3_at_19: names(...LOTS_1, TL, ...U02_AT_19), holds_at_19: names(...U01, ...LOTS_1, TL, ...U02_AT_19),
    holds_at_23: names("result:U02-S4", ...LOTS_2), dir3_at_23: names(...LOTS_2, TL, "batch:B-U01", "result:U01-S2", "result:U01-S3"), first_hold_of_b_u02: H(19),
    versions: names("U01-S2/v2", "U01-S3/v2", "U02-S2/v2", "U02-S3/v2", "U02-S4/v2"), flagged_at_19: 4, flagged_at_23: 1,
  },
  "C-L": {
    reachable: { direction3: true, lots: false, equipment: true }, dir3_at_19: names(TL, ...U02_AT_19), holds_at_19: names(...U01, TL, ...U02_AT_19), holds_at_23: names("result:U02-S4"),
    dir3_at_23: names(TL, "batch:B-U01", "result:U01-S2", "result:U01-S3"), first_hold_of_b_u02: H(19),
    versions: names("U01-S2/v2", "U01-S3/v2", "U02-S2/v2", "U02-S3/v2", "U02-S4/v2"), flagged_at_19: 4, flagged_at_23: 1,
  },
  "C-E": {
    reachable: { direction3: true, lots: true, equipment: false }, dir3_at_19: names(...LOTS_1), holds_at_19: names(...U01, ...LOTS_1), holds_at_23: names(...U02_AT_23, ...LOTS_2),
    dir3_at_23: names(...LOTS_2), first_hold_of_b_u02: H(23), versions: names("U01-S2/v2", "U01-S3/v2", "U02-S2/v2", "U02-S3/v2", "U02-S4/v2"), flagged_at_19: 2, flagged_at_23: 3,
  },
};

describe.each(ALL)("FX12e investigated under %s", (n) => {
  let inv: Investigation;
  let ds: RecordedDataset;
  beforeAll(() => {
    inv = run(FX12E, FX12E_MASTER, n);
    ds = inv.dataset;
  });
  const cell = CELL[n];
  const dir = (k: number, d: 1 | 3) => returned((inv.walks[k]?.items ?? []).filter((i) => i.direction === d), ds);

  it("Given the two signals When the investigation runs Then there are two walks: decisions at 19 h and 23 h, estimated onsets 5 h and 9 h", () => {
    expect(inv.walks.map((w) => [w.signal.unit_id, w.decision_at, w.estimated_onset])).toEqual([["U01", H(19), H(5)], ["U02", H(23), H(9)]]);
  });

  it("Then direction 3 at 19 h has the typed reach and returns the typed items (U02-S4 does not exist yet; U02-S1 at 4 h is before its use of TL-1)", () => {
    expect(inv.walks[0]?.reachable).toEqual(cell.reachable);
    expect(dir(0, 3)).toEqual(cell.dir3_at_19);
    expect(dir(0, 1)).toEqual(names(...U01));
  });

  it("Then the holds placed at 19 h and at 23 h (the signal of U02 runs the same procedure; an item already held is not held twice) are the typed ones", () => {
    expect(placedAt(ds, H(19))).toEqual(cell.holds_at_19);
    expect(placedAt(ds, H(23))).toEqual(cell.holds_at_23);
    expect((ds.quality_hold ?? []).length).toBe(cell.holds_at_19.length + cell.holds_at_23.length);
  });

  it("Then the second walk reads direction 1 from the estimated onset of U02, 9 h, and direction 3 as typed (the items already held are returned and not held again)", () => {
    expect(dir(1, 1)).toEqual(names(...U02_AT_23));
    expect(dir(1, 3)).toEqual(cell.dir3_at_23);
  });

  it("Then the first hold of B-U02 is at the typed instant", () => {
    const first = (ds.quality_hold ?? []).filter((h) => nameOf(ds, h.target_kind, h.target_id) === "batch:B-U02").map((h) => h.placed_at);
    expect(first).toEqual([cell.first_hold_of_b_u02]);
  });

  it("Then the retro-flag versions are the typed ones, created at 19 h and at 23 h (VR-022 is not evaluable in A and B)", () => {
    expect(versions(ds)).toEqual(cell.versions);
    expect(inv.events.filter((e) => e.type === "result_reflagged" && e.t === H(19)).length).toBe(cell.flagged_at_19);
    expect(inv.events.filter((e) => e.type === "result_reflagged" && e.t === H(23)).length).toBe(cell.flagged_at_23);
    expect(inv.not_evaluable.map((x) => x.rule)).toEqual(n === "A" || n === "B" ? ["VR-022"] : []);
  });

  it("Then both units are detected, so every hold becomes quarantine at 143 h and is rejected at 152 h, and the deviation is closed at 355 h", () => {
    const total = cell.holds_at_19.length + cell.holds_at_23.length;
    expect(inv.events.filter((e) => e.type === "hold_quarantined").map((e) => e.t)).toEqual(Array(total).fill(H(143)));
    expect((ds.quality_hold ?? []).every((h) => h.kind === "quarantine" && h.outcome === "rejected" && h.released_at === H(152) && h.state === "closed")).toBe(true);
    expect((ds.deviation ?? []).map((d) => [d.state, d.closed_at])).toEqual([["closed", H(355)]]);
  });

  it("Then the transfer line is quarantined where its row exists (every configuration with equipment_links) and the lots where their rows exist", () => {
    expect((ds.equipment ?? []).map((e) => [e.equipment_id, e.state])).toEqual(n === "A" || n === "C-E" ? [] : [["TL-1", "quarantined"]]);
    const lotStates = (ds.material_lot ?? []).map((l) => [l.lot_id, l.state]);
    if (n === "C" || n === "C-E") {
      expect(lotStates).toEqual([["SL-1", "quarantined"], ["SL-2", "quarantined"], ["SL-3", "in_use"], ["ML-1", "quarantined"], ["ML-2", "quarantined"], ["ML-3", "in_use"]]);
    } else expect(lotStates).toEqual([]);
  });
});

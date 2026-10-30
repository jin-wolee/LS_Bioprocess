import { beforeAll, describe, expect, it } from "vitest";
import type { Investigation } from "../../src/record/investigate/investigate.ts";
import type { QualityHoldRow, RecordedDataset } from "../../src/record/types.ts";
import { FX12A, FX12A_MASTER, H } from "../support/breakout_streams.ts";
import { nameOf, names, placedAt, rec, returned, run, versions } from "../support/investigate_setup.ts";
import type { Name } from "../support/investigate_setup.ts";

// Break-out batch 4, row 4 of spec 11.8.5: the investigation of FX12a under A, B, C and C without material_lot_links (C-L). Every expected value is typed by hand from the FX12a table of spec
// 11.8.4 (and rules S8, S9 of 11.8.2), never read off the code. Hours are written as hours and turned into seconds by H. d1 = 2 h, d2 = 4 h, assumed lag 12 h: the decision is at 19 h, the
// estimated onset is 17 - 12 = 5 h. The confirming results arrive at 139 h (bioburden) and 355 h (sterility): U01 detected in both, U02 not detected in both.
//   The conversion to quarantine is the first positive plus d2 = 139 + 4 = 143 h. 143 h is a Saturday (day 5, 23:00), so the next review point of the roster of A201 is Sunday 08:00 = 152 h.
//   The release of U02 is the last negative plus d2 = 355 + 4 = 359 h. 359 h is a Monday (day 14, 23:00), so the next review point is Tuesday 08:00 = 368 h.
//   FX12a has no equipment. The FX12a table says "direction 3 reachable: no" for B and C-L; both have equipment_links on (ADR-0020, added after the table was typed), and rule S8 says direction 3
//   is unreachable only when both flags are off, so B and C-L read "equipment only" here and return nothing (11.8.9 clarification C19).

const FOUR = ["A", "B", "C", "C-L"] as const satisfies readonly Name[];
const U01 = ["batch:B-U01", "result:U01-S2", "result:U01-S3"];
const U02 = ["batch:B-U02", "result:U02-S1", "result:U02-S2", "result:U02-S3"];
const LOTS = ["material_lot:SL-1", "material_lot:ML-1", "material_lot:ML-2"];

interface Cell {
  reachable: { direction3: boolean; lots: boolean; equipment: boolean };
  dir3: string[];
  holds: string[];
  versions: string[];
  rejected: string[];
  released: string[];
  closed_at: number;
}
const CELL: Record<(typeof FOUR)[number], Cell> = {
  A: { reachable: { direction3: false, lots: false, equipment: false }, dir3: [], holds: names(...U01), versions: [], rejected: names(...U01), released: [], closed_at: H(355) },
  B: { reachable: { direction3: true, lots: false, equipment: true }, dir3: [], holds: names(...U01), versions: [], rejected: names(...U01), released: [], closed_at: H(355) },
  C: {
    reachable: { direction3: true, lots: true, equipment: true }, dir3: names(...LOTS, ...U02), holds: names(...U01, ...LOTS, ...U02),
    versions: names("U01-S2/v2", "U01-S3/v2", "U02-S1/v2", "U02-S2/v2", "U02-S3/v2"), rejected: names(...U01, ...LOTS), released: names(...U02), closed_at: H(359),
  },
  "C-L": { reachable: { direction3: true, lots: false, equipment: true }, dir3: [], holds: names(...U01), versions: names("U01-S2/v2", "U01-S3/v2"), rejected: names(...U01), released: [], closed_at: H(355) },
};

describe.each(FOUR)("FX12a investigated under %s", (n) => {
  let inv: Investigation;
  let ds: RecordedDataset;
  let before: RecordedDataset;
  const holdOf = (name: string): QualityHoldRow => (ds.quality_hold ?? []).find((h) => nameOf(ds, h.target_kind, h.target_id) === name) as QualityHoldRow;
  beforeAll(() => {
    before = rec(FX12A, FX12A_MASTER, n);
    inv = run(FX12A, FX12A_MASTER, n);
    ds = inv.dataset;
  });
  const cell = CELL[n];

  it("Given the signal at 17 h When the walk-back runs Then the decision is at 19 h and the estimated onset is the true onset, 5 h", () => {
    expect(inv.walks.length).toBe(1);
    expect(inv.walks[0]?.decision_at).toBe(H(19));
    expect(inv.walks[0]?.estimated_onset).toBe(H(5));
  });

  it("Then direction 1 returns the batch and the results at or after 5 h (U01-S1 is at 3 h, measured 4 h, and is not returned)", () => {
    expect(returned((inv.walks[0]?.items ?? []).filter((i) => i.direction === 1), ds)).toEqual(names(...U01));
  });

  it("Then direction 3 has the typed reach and returns the typed items", () => {
    expect(inv.walks[0]?.reachable).toEqual(cell.reachable);
    expect(returned((inv.walks[0]?.items ?? []).filter((i) => i.direction === 3), ds)).toEqual(cell.dir3);
  });

  it("Then the holds placed at 19 h are the direction 1 and direction 3 items and no other hold exists", () => {
    expect(placedAt(ds, H(19))).toEqual(cell.holds);
    expect((ds.quality_hold ?? []).length).toBe(cell.holds.length);
  });

  it("Then placed_by and reason are stored with audit_trail (B, C, C-L) and null without it (A)", () => {
    const rows = ds.quality_hold ?? [];
    expect(rows.every((h) => (n === "A" ? h.placed_by === null && h.reason === null : h.placed_by === "reviewer" && typeof h.reason === "string"))).toBe(true);
  });

  it("Then available_at of a hold is its placement instant with the flag (C, C-L) and null without it (A, B)", () => {
    const stamped = n === "C" || n === "C-L";
    expect((ds.quality_hold ?? []).every((h) => h.available_at === (stamped ? H(19) : null))).toBe(true);
  });

  it("Then every hold targets an existing deviation (K15) and a lot or equipment target exists only with its flag", () => {
    expect((ds.quality_hold ?? []).every((h) => h.deviation_id === "DEV-1")).toBe(true);
    expect((ds.quality_hold ?? []).filter((h) => h.target_kind === "material_lot").length).toBe(n === "C" ? 3 : 0);
  });

  it("Then VR-022 is not evaluable in A and B (0 versions) and fires in C (5 versions) and C-L (2 versions) at 19 h", () => {
    const notEvaluable = inv.not_evaluable.map((x) => x.rule);
    expect(notEvaluable).toEqual(n === "A" || n === "B" ? ["VR-022"] : []);
    expect(versions(ds)).toEqual(cell.versions);
    expect(ds.result.filter((r) => r.hold_id != null).every((r) => r.ingested_at === H(19))).toBe(true);
  });

  it("Then the positive of U01 at 139 h turns, at 143 h, the holds on B-U01 and its results (in C also the three lots) into quarantine, and they are rejected at the review point, 152 h", () => {
    for (const name of cell.rejected) {
      const h = holdOf(name);
      expect([name, h.kind, h.outcome, h.released_at, h.state]).toEqual([name, "quarantine", "rejected", H(152), "closed"]);
    }
    const quarantined = inv.events.filter((e) => e.type === "hold_quarantined");
    expect(quarantined.length).toBe(cell.rejected.length);
    expect(quarantined.every((e) => e.t === H(143))).toBe(true);
    expect(inv.events.filter((e) => e.type === "hold_rejected").every((e) => e.t === H(152))).toBe(true);
  });

  it("Then the last negative result of U02 at 355 h releases, in C, the hold on B-U02 and its results at 359 h", () => {
    for (const name of cell.released) {
      const h = holdOf(name);
      expect([name, h.kind, h.outcome, h.released_at, h.state]).toEqual([name, "hold", "released", H(359), "closed"]);
    }
    expect(inv.events.filter((e) => e.type === "hold_released").map((e) => e.t)).toEqual(cell.released.map(() => H(359)));
  });

  it("Then the deviation is closed once every confirming result is in and every hold is ended, with the estimated onset and the assumed lag stored", () => {
    const d = (ds.deviation ?? [])[0];
    expect([d?.state, d?.closed_at, d?.closed_by, d?.estimated_onset, d?.assumed_lag]).toEqual(["closed", cell.closed_at, n === "A" ? null : "reviewer", H(5), H(12)]);
    expect(inv.events.filter((e) => e.type === "deviation_closed")).toEqual([{ type: "deviation_closed", t: cell.closed_at, deviation_id: "DEV-1" }]);
  });

  it("Then version n is never modified: every row of the recorded dataset is still in the result table, equal to what the recorder wrote", () => {
    for (const row of before.result) expect(ds.result.find((r) => r.result_id === row.result_id)).toEqual(row);
  });
});

describe("FX12a under C: the retro-flag versions follow data_model 15.3", () => {
  let ds: RecordedDataset;
  let before: RecordedDataset;
  const versionOf = (request: string) => ds.result.find((r) => r.request_id === request && r.hold_id != null);
  const base = (request: string) => before.result.find((r) => r.request_id === request);
  beforeAll(() => {
    before = rec(FX12A, FX12A_MASTER, "C");
    ds = run(FX12A, FX12A_MASTER, "C").dataset;
  });

  it.each(["U01-S2", "U01-S3", "U02-S1", "U02-S2", "U02-S3"])("Given the released result %s When it is covered by a hold Then version 2 has the same value, the state quarantined at 19 h, and supersedes version 1 (K16)", (request) => {
    const v = versionOf(request);
    const n1 = base(request);
    expect([v?.version, v?.value, v?.supersedes, v?.measured_at, v?.run_id, v?.analyte]).toEqual([2, 5, n1?.result_id, n1?.measured_at, n1?.run_id, n1?.analyte]);
    expect((ds.quality_hold ?? []).find((h) => h.hold_id === v?.hold_id)?.target_id).toBe(n1?.result_id);
  });

  it.each(["U01-S2", "U01-S3"])("Given the positive of U01 When the review point 152 h comes Then version 2 of %s is rejected with its value kept, reviewed at 152 h, and has no available_at", (request) => {
    const v = versionOf(request);
    expect([v?.state, v?.value, v?.reviewed_at, v?.available_at]).toEqual(["rejected", 5, H(152), null]);
  });

  it.each(["U02-S1", "U02-S2", "U02-S3"])("Given the negative of U02 When the review point 368 h comes Then version 2 of %s is released again with the same value, reviewed and available at 368 h", (request) => {
    const v = versionOf(request);
    expect([v?.state, v?.value, v?.reviewed_at, v?.available_at]).toEqual(["released", 5, H(368), H(368)]);
  });

  it("Then each flag has an audit event with the person, the reason, the time and the old and new version, and a VR-022 finding on version 1, resolved by the review", () => {
    const events = ds.audit_event.filter((a) => a.hold_id != null);
    expect(events.length).toBe(5);
    expect(events.every((a) => a.at === H(19) && a.old_value === 5 && a.new_value === 5 && a.old_version === 1 && a.new_version === 2 && a.placed_by === "reviewer" && typeof a.reason === "string")).toBe(true);
    const findings = ds.validation_finding.filter((f) => f.rule === "VR-022");
    expect(findings.length).toBe(5);
    expect(findings.every((f) => f.severity === "error" && f.action === "quarantine" && f.status === "resolved")).toBe(true);
    expect(findings.map((f) => f.target).sort()).toEqual(ds.result.filter((r) => r.hold_id != null).map((r) => `result:${r.supersedes}`).sort());
  });

  it("Then the lots under the positive are quarantined (SL-1 and ML-1 stay quarantined: a precision cost) and the other lots keep their state", () => {
    expect((ds.material_lot ?? []).map((l) => [l.lot_id, l.state])).toEqual([
      ["SL-1", "quarantined"], ["SL-2", "in_use"], ["SL-3", "in_use"], ["ML-1", "quarantined"], ["ML-2", "quarantined"], ["ML-3", "in_use"],
    ]);
  });
});

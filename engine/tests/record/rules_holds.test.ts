import { describe, expect, it } from "vitest";
import { resultsAsOf } from "../../src/record/asof.ts";
import { holdsAsOf, retroFlag, vr022Targets, vr022Unmet } from "../../src/record/rules_holds.ts";
import type { QualityHoldRow, RecordedDataset } from "../../src/record/types.ts";
import { FX12A, FX12A_MASTER, H } from "../support/breakout_streams.ts";
import { CONFIGS } from "../support/cells.ts";
import { rec, run } from "../support/investigate_setup.ts";

// Break-out batch 4: VR-022 and the retro-flag (data_model 15.3, 15.5; spec 11.8.2 rules S9 and S11), on hostile datasets built by hand from the recorded FX12a: a hold that is entered after the
// instant it was placed, a hold on a batch, a result not released, a result that already has a later version. Every expected value is typed from the rule text: "a result version in state
// released at time t is covered by a quality_hold placed at or before t and no later version exists"; "Released" means a state null or released with an available_at known at t; version n+1
// has the same value and units (K16), the state quarantined, supersedes n and has the hold_id; version n is not modified (K8).

const C = (): RecordedDataset => rec(FX12A, FX12A_MASTER, "C");
const resultOf = (ds: RecordedDataset, request: string) => ds.result.find((r) => r.request_id === request) as RecordedDataset["result"][number];
const hold = (o: Pick<QualityHoldRow, "hold_id" | "target_kind" | "target_id" | "placed_at"> & Partial<QualityHoldRow>): QualityHoldRow => ({
  deviation_id: "DEV-1", kind: "hold", state: "under_test", placed_by: "reviewer", reason: "test", released_at: null, released_by: null, outcome: null, available_at: o.placed_at, ...o,
});
const withHolds = (ds: RecordedDataset, ...holds: QualityHoldRow[]): RecordedDataset => ({ ...ds, quality_hold: holds });
/** The same dataset as the recorder of an architecture without available_at would write it: the flag off and no row stamps. */
const withoutStamps = (ds: RecordedDataset): RecordedDataset => ({
  ...ds,
  architecture: { ...ds.architecture, flags: { ...ds.architecture.flags, available_at: false } },
  result: ds.result.map((r) => ({ ...r, available_at: null })),
  quality_hold: (ds.quality_hold ?? []).map((h) => ({ ...h, available_at: null })),
});

describe("VR-022 needs available_at, append_only_versions and audit_trail (spec 11.8.2 S11, section 5 rule table)", () => {
  const flagged = (name: string) => (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config;
  it("Given C Then VR-022 is evaluable", () => {
    expect(vr022Unmet(rec(FX12A, FX12A_MASTER, "C"))).toBeNull();
  });
  it.each(["available_at", "append_only_versions", "audit_trail"])("Given C without %s Then VR-022 is not evaluable and the reason names the flag", (flag) => {
    const ds = { ...C(), architecture: { id: "x", flags: flagged(`C-${flag}`).flags, labelling: "issued_at_draw" as const } };
    expect(vr022Unmet(ds)).toMatch(new RegExp(flag));
  });
  it.each(["A", "B"] as const)("Given %s Then VR-022 is not evaluable and the reason names the flags that are off", (n) => {
    const reason = vr022Unmet(rec(FX12A, FX12A_MASTER, n)) ?? "";
    expect(reason).toMatch(/available_at/);
    expect(reason).toMatch(/append_only_versions/);
  });
});

describe("The as-of cut of a hold: strict with available_at, valid time without it", () => {
  const ds = withHolds(C(),
    hold({ hold_id: "H1", target_kind: "batch", target_id: "B-U01", placed_at: H(18) }),
    // entered at 25 h about a hold that took effect at 18 h (a back-dated entry): knowable at 25 h only
    hold({ hold_id: "H2", target_kind: "batch", target_id: "B-U02", placed_at: H(18), available_at: H(25) }),
    hold({ hold_id: "H3", target_kind: "batch", target_id: "B-U03", placed_at: H(26) }));
  const ids = (d: RecordedDataset, t: number) => holdsAsOf(d, t).map((h) => h.hold_id);
  it("Given available_at on Then a read at 20 h sees H1 only: H2 is not yet entered and H3 is not yet placed", () => {
    expect(ids(ds, H(20))).toEqual(["H1"]);
  });
  it("Given available_at on Then a read at 25 h sees H1 and H2, and a read at 26 h sees all three", () => {
    expect(ids(ds, H(25))).toEqual(["H1", "H2"]);
    expect(ids(ds, H(26))).toEqual(["H1", "H2", "H3"]);
  });
  it("Given available_at off Then a read at 20 h also sees H2: only the valid time can cut, so the late entry leaks backwards (section 5)", () => {
    expect(ids(withoutStamps(ds), H(20))).toEqual(["H1", "H2"]);
    expect(ids(withoutStamps(ds), H(26))).toEqual(["H1", "H2", "H3"]);
  });
});

describe("VR-022 finds the released results covered by a hold", () => {
  const u01s2 = (ds: RecordedDataset) => resultOf(ds, "U01-S2").result_id;
  const onResult = (ds: RecordedDataset, at = H(18)) => hold({ hold_id: "H1", target_kind: "result", target_id: u01s2(ds), placed_at: at });

  it("Given a hold on the result placed at 18 h Then the result is covered from 18 h and not before", () => {
    const ds = C();
    expect(vr022Targets(withHolds(ds, onResult(ds)), H(17))).toEqual([]);
    expect(vr022Targets(withHolds(ds, onResult(ds)), H(18))).toEqual([u01s2(ds)]);
    expect(vr022Targets(withHolds(ds, onResult(ds)), H(30))).toEqual([u01s2(ds)]);
  });
  it("Given a hold on the batch only Then no result is covered by it (the walk-back names every result it returns)", () => {
    const ds = C();
    expect(vr022Targets(withHolds(ds, hold({ hold_id: "H1", target_kind: "batch", target_id: "B-U01", placed_at: H(18) })), H(19))).toEqual([]);
  });
  it("Given a hold that is ended before t Then the result is no longer covered", () => {
    const ds = C();
    expect(vr022Targets(withHolds(ds, { ...onResult(ds), released_at: H(19), outcome: "released" }), H(20))).toEqual([]);
  });
  it("Given a result that is held or quarantined or rejected, not released Then it is not covered", () => {
    for (const state of ["held", "quarantined", "rejected"] as const) {
      const ds = C();
      const result = ds.result.map((r) => (r.request_id === "U01-S2" ? { ...r, state } : r));
      expect(vr022Targets(withHolds({ ...ds, result }, onResult(ds)), H(19)), state).toEqual([]);
    }
  });
  it("Given a result released at review (available_at 20 h) Then it is covered from 20 h and not at 19 h", () => {
    const ds = C();
    const result = ds.result.map((r) => (r.request_id === "U01-S2" ? { ...r, state: "released" as const, available_at: H(20) } : r));
    expect(vr022Targets(withHolds({ ...ds, result }, onResult(ds)), H(19))).toEqual([]);
    expect(vr022Targets(withHolds({ ...ds, result }, onResult(ds)), H(20))).toEqual([u01s2(ds)]);
  });
  it("Given a result that already has a later version Then it is not covered again", () => {
    const ds = C();
    const flaggedOnce = retroFlag(withHolds(ds, onResult(ds)), H(19)).dataset;
    expect(vr022Targets(flaggedOnce, H(20))).toEqual([]);
  });
});

describe("The retro-flag creates version n+1 and leaves version n alone (K8, K16)", () => {
  const ds = C();
  const n = resultOf(ds, "U01-S2");
  const holds = withHolds(ds, hold({ hold_id: "H7", target_kind: "result", target_id: n.result_id, placed_at: H(18), placed_by: "reviewer", reason: "walk-back" }));
  const out = retroFlag(holds, H(19));

  it("Then version 1 is the same row, byte for byte", () => {
    expect(out.dataset.result.find((r) => r.result_id === n.result_id)).toEqual(n);
  });
  it("Then version 2 has the value, the units columns and the measured time of version 1, the state quarantined, supersedes version 1, carries the hold and is stamped with the flag instant", () => {
    const v = out.dataset.result.find((r) => r.supersedes === n.result_id);
    expect(v).toEqual({ ...n, result_id: v?.result_id, version: 2, supersedes: n.result_id, state: "quarantined", hold_id: "H7", available_at: H(19), ingested_at: H(19), reviewed_at: null });
    expect(out.flagged.map((r) => r.result_id)).toEqual([v?.result_id]);
  });
  it("Then the audit event holds the person and the reason of the hold, the instant and the two versions, and the finding VR-022 is open on version 1", () => {
    expect(out.dataset.audit_event.at(-1)).toMatchObject({ request_id: "U01-S2", at: H(19), old_value: 5, new_value: 5, old_version: 1, new_version: 2, hold_id: "H7", placed_by: "reviewer", reason: "walk-back" });
    expect(out.dataset.validation_finding.filter((f) => f.rule === "VR-022")).toEqual([{ rule: "VR-022", target: `result:${n.result_id}`, severity: "error", action: "quarantine", status: "open" }]);
  });
  it("Then a second run at the same instant creates nothing more", () => {
    expect(retroFlag(out.dataset, H(19)).flagged).toEqual([]);
  });
  it("Then the state of the new version goes through the table: measured to quarantined by a rule", () => {
    const log: import("../../src/record/transitions.ts").Transition[] = [];
    retroFlag(holds, H(19), log);
    expect(log).toEqual([{ entity: "result", from: "measured", to: "quarantined", by: "rule" }]);
  });
});

describe("An as-of read of results after a retro-flag (data_model 15.3 item 5)", () => {
  const ds = run(FX12A, FX12A_MASTER, "C").dataset;
  const requests = (d: RecordedDataset, t: number) => resultsAsOf(d, t).map((r) => r.request_id);

  it("Given available_at on When the read is before the flag Then version 1 is still seen as released (U01-S2 at 9 h, flagged at 19 h)", () => {
    expect(requests(ds, H(18))).toContain("U01-S2");
    expect(resultsAsOf(ds, H(18)).find((r) => r.request_id === "U01-S2")?.version).toBe(1);
  });
  it("Given available_at on When the read is after the flag Then the result is not available: version 1 is superseded by the quarantined version 2, and so on until the rejection", () => {
    for (const t of [H(19), H(20), H(100), H(150), H(152), H(400)]) expect(requests(ds, t), `${t}`).not.toContain("U01-S2");
  });
  it("Given the negative of U02 When the read is after the release of version 2 at 368 h Then version 2 is seen, with the same value; between the flag and the release nothing", () => {
    expect(requests(ds, H(300))).not.toContain("U02-S1");
    expect(resultsAsOf(ds, H(368)).find((r) => r.request_id === "U02-S1")).toMatchObject({ version: 2, value: 5, state: "released" });
  });
  it("Given available_at off When the read is before the flag Then the flag leaks backwards: U01-S2 is already absent at 18 h, and a result that was never flagged is still there", () => {
    const leaky = withoutStamps(ds);
    expect(requests(leaky, H(18))).not.toContain("U01-S2");
    expect(requests(leaky, H(18))).toContain("U03-S1");
  });
});

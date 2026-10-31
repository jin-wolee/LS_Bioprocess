import { beforeAll, describe, expect, it } from "vitest";
import type { Investigation } from "../../src/record/investigate/investigate.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { FX12A, FX12A_MASTER, H } from "../support/breakout_streams.ts";
import { metricsOf } from "../support/breakout_truth_setup.ts";
import type { Onset } from "../support/breakout_truth_setup.ts";
import { byTime, visit } from "../support/cell_stream.ts";
import { run, versions } from "../support/investigate_setup.ts";

// F2 of the S3 adversary pass (spec 11.8.13; C25 and data_model 15.3 item 2 as amended): VR-022 reads as of its instant. The probe's input: FX12a plus a re-measure of U01-S3 (attempt 2) that is
// measured at 30 h, after the decision at 19 h. At 19 h the rerun does not exist (it is written at 30 h), so version 1 of U01-S3 is released and under a hold, and VR-022 flags it as it flags the
// other four; the rerun, written later, is appended after the flag: it supersedes version 2 (the flag) and becomes version 3, and the versions of its audit event follow. Typed from the rule text.

const RERUN = byTime([...FX12A, ...visit({ request: "U01-S3", attempt: 2, queued: H(29), started: H(29.5), finished: H(30), value: 5.1 })]);
const ONSET: Onset[] = [{ unit: "U01", hours: 5, kind: "medium_lot", origin: "ML-2" }];

describe("F2: VR-022 as of t, and no two versions supersede one version", () => {
  let inv: Investigation;
  let ds: RecordedDataset;
  beforeAll(() => {
    inv = run(RERUN, FX12A_MASTER, "C");
    ds = inv.dataset;
  });
  const rowsOf = (request: string) => ds.result.filter((r) => r.request_id === request).sort((a, b) => a.version - b.version);

  it("Given the rerun of U01-S3 written at 30 h When VR-022 runs at 19 h Then all five results of the walk-back are flagged, U01-S3 included (as in FX12a without the rerun)", () => {
    expect(versions(ds)).toEqual(["U01-S2/v2", "U01-S3/v2", "U02-S1/v2", "U02-S2/v2", "U02-S3/v2"]);
  });

  it("Then U01-S3 is one chain: version 1 (released at 15 h), version 2 (the flag, with the hold), version 3 (the rerun of 30 h), each superseding the one before", () => {
    const [v1, v2, v3] = rowsOf("U01-S3");
    expect([v1?.version, v1?.supersedes, v1?.available_at]).toEqual([1, null, H(15)]);
    expect([v2?.version, v2?.supersedes, v2?.hold_id != null, v2?.ingested_at]).toEqual([2, v1?.result_id, true, H(19)]);
    expect([v3?.version, v3?.supersedes, v3?.hold_id ?? null, v3?.measured_at, v3?.value]).toEqual([3, v2?.result_id, null, H(30), 5.1]);
  });

  it("Then no version is superseded twice (no fork) anywhere in the table", () => {
    const sup = ds.result.flatMap((r) => (r.supersedes === null ? [] : [r.supersedes]));
    expect(sup.length).toBe(new Set(sup).size);
  });

  it("Then the audit event of the rerun names the versions it has in the chain: from 2 (the flag) to 3", () => {
    const rerun = ds.audit_event.filter((a) => a.request_id === "U01-S3" && a.hold_id === undefined);
    expect(rerun.map((a) => [a.at, a.old_value, a.new_value, a.old_version, a.new_version])).toEqual([[H(30), 5, 5.1, 2, 3]]);
  });

  it("Then the retro-flag completeness is 2 of 2 and both results stood released before containment (U01-S2 at 9 h, U01-S3 at 15 h)", () => {
    const m = metricsOf(RERUN, FX12A_MASTER, ONSET, "C");
    const pair = (r: { num: number; den: number }) => [r.num, r.den];
    expect([pair(m.released_before_containment), pair(m.retro_flag_completeness)]).toEqual([[2, 2], [2, 2]]);
  });
});

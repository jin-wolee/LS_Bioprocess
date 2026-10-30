import { describe, expect, it } from "vitest";
import { review } from "../../src/record/review.ts";
import { recordResults } from "../../src/record/results.ts";
import type { CaptureInput, CaptureProvenance, RecordedDataset } from "../../src/record/types.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { emptyDataset } from "../support/eval_fixture.ts";
import { NO_FLAGS } from "../support/record_fixture.ts";
import { REVIEW, at } from "../support/review_setup.ts";

// S2f F5: on an overwrite (append_only_versions off: architectures A and B) the row keeps its id and takes the content of the new attempt, so it must also take the findings of the
// ingest stage that belong to that content, and drop the findings of the version it replaced. Hand-typed stream; the stage findings are given as capture provenance (test-only
// rules and stamps). Day 0 is a Monday: 09:30 on Tuesday is reviewed at 13:00.

const result = (attempt: number, value: number): ObservableEvent => ({ type: "result_measured", t: at(1, 9, 30) + attempt, request_id: "S1", attempt, visit: 1, analyzer: "AN-1", analyte: "glucose", value });
const key = (attempt: number): string => `AN-1/S1/${attempt}/1/glucose`;
const quarantine = (rule: string): CaptureProvenance => ({ findings: [{ rule, severity: "error", action: "quarantine" }] });
const hold = (rule: string): CaptureProvenance => ({ findings: [{ rule, severity: "warning", action: "hold" }] });
const record = (provenance: Record<string, CaptureProvenance>, flags: Partial<typeof NO_FLAGS> = {}) => {
  const capture: CaptureInput = { path: "adapter_ingest", provenance };
  return recordResults([result(1, 4.0), result(2, 4.5)], { ...NO_FLAGS, ...flags }, {}, capture);
};
const findings = (out: ReturnType<typeof record>): string[][] => out.validation_finding.map((f) => [f.rule, f.target, f.action, f.status]);

describe("S2f F5: an overwrite carries the findings of the version it holds", () => {
  it("Given attempt 1 clean and attempt 2 quarantined (VR-019) over it Then the one row is quarantined and carries the VR-019 finding", () => {
    const out = record({ [key(2)]: quarantine("VR-019") });
    expect(out.result.map((r) => [r.result_id, r.value, r.version, r.state])).toEqual([["R1", 4.5, 1, "quarantined"]]);
    expect(findings(out)).toEqual([["VR-019", "result:R1", "quarantine", "open"]]);
  });
  it("Given attempt 1 quarantined (VR-019) and attempt 2 clean over it Then the row is clean (no state) and no finding of the replaced version stays open on it", () => {
    const out = record({ [key(1)]: quarantine("VR-019") });
    expect(out.result.map((r) => [r.result_id, r.value, r.state])).toEqual([["R1", 4.5, null]]);
    expect(findings(out)).toEqual([]);
  });
  it("Given attempt 1 held (VR-026) and attempt 2 quarantined (VR-019) Then only the finding of attempt 2 is kept, and the row is quarantined", () => {
    const out = record({ [key(1)]: hold("VR-026"), [key(2)]: quarantine("VR-019") });
    expect(out.result.map((r) => r.state)).toEqual(["quarantined"]);
    expect(findings(out)).toEqual([["VR-019", "result:R1", "quarantine", "open"]]);
  });
  it("Given findings of other rows and of source events Then they are kept as they were", () => {
    const events = [result(1, 4.0), { ...result(1, 6.0), request_id: "S2" }, result(2, 4.5)];
    const out = recordResults(events, { ...NO_FLAGS }, {}, { path: "adapter_ingest", provenance: { "AN-1/S2/1/1/glucose": quarantine("VR-024"), [key(2)]: hold("VR-026") }, findings: [{ rule: "VR-008", target: "source_event:AN-1/S9/1/1/glucose", severity: "info", action: "no-op", status: "resolved" }] });
    expect(findings(out)).toEqual([["VR-024", "result:R2", "quarantine", "open"], ["VR-026", "result:R1", "hold", "open"], ["VR-008", "source_event:AN-1/S9/1/1/glucose", "no-op", "resolved"]]);
  });
  it("Given an architecture that keeps versions (append_only_versions on) Then nothing is overwritten and each version keeps its own finding (unchanged)", () => {
    const out = record({ [key(1)]: hold("VR-026"), [key(2)]: quarantine("VR-019") }, { append_only_versions: true });
    expect(out.result.map((r) => [r.result_id, r.version, r.state])).toEqual([["R1", 1, "held"], ["R2", 2, "quarantined"]]);
    expect(findings(out)).toEqual([["VR-026", "result:R1", "hold", "open"], ["VR-019", "result:R2", "quarantine", "open"]]);
  });
  it("Given the overwritten, quarantined row Then the review finds a finding for it (it would stop with an error on a row that is in a state and has none) and releases it by the policy of VR-019", () => {
    const out = record({ [key(2)]: quarantine("VR-019") });
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: out.result, validation_finding: out.validation_finding };
    expect(review(ds, REVIEW).result[0]).toMatchObject({ state: "released", reviewed_at: at(1, 13) });
  });
});

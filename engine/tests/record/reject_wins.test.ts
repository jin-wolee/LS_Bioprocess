import { describe, expect, it } from "vitest";
import { resultsAsOf } from "../../src/record/asof.ts";
import { review } from "../../src/record/review.ts";
import type { RecordedDataset, ResultRow, SampleRow, ValidationFindingRow } from "../../src/record/types.ts";
import { validate } from "../../src/record/validate.ts";
import { emptyDataset } from "../support/eval_fixture.ts";
import { REVIEW, at } from "../support/review_setup.ts";

// S2f F4: a reject finding wins (data_model section 8: reject = the row is not loaded). A result that the ingest stage put in a state (VR-019 quarantine, a hold) and that a rule
// of the validation stage rejects (VR-014: the label matches no open request) must end rejected, never released. Hand-typed rows and findings; day 0 is a Monday, so Tuesday
// 09:30 is reviewed at the 13:00 shift start (A201, A215).

const ingested = at(1, 9, 30);
const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  result_id: "R1", request_id: "S9", analyte: "glucose", version: 1, run_id: "S9/1/1", value: 5.0, measured_at: ingested, available_at: ingested, supersedes: null,
  ingested_at: ingested, reviewed_at: null, state: "quarantined", ...over,
});
const finding = (rule: string, action: ValidationFindingRow["action"], target = "result:R1"): ValidationFindingRow => ({ rule, target, severity: "error", action, status: "open" });

describe("S2f F4: a reject finding wins over a hold or a quarantine at the review", () => {
  it("Given a result quarantined at ingest (VR-019) with an open reject finding (VR-014) Then the review rejects it: no available_at, reviewed at the 13:00 shift start, the value kept", () => {
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: [row()], validation_finding: [finding("VR-019", "quarantine"), finding("VR-014", "reject")] };
    const out = review(ds, REVIEW);
    expect(out.result[0]).toMatchObject({ state: "rejected", available_at: null, reviewed_at: at(1, 13), value: 5.0 });
    expect(resultsAsOf(out, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
  it("Given the same row with a VR-012 hold in place of the VR-019 quarantine (already rejected by the policy of VR-012) Then it is still rejected", () => {
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: [row({ state: "held" })], validation_finding: [finding("VR-012", "hold"), finding("VR-014", "reject")] };
    expect(review(ds, REVIEW).result[0]).toMatchObject({ state: "rejected", available_at: null });
  });
  it("Given a hold that the policy would release (VR-015, on the sample) and a reject finding on the result Then the row is rejected", () => {
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: [row({ state: "held" })], validation_finding: [finding("VR-015", "hold", "sample:S9"), finding("VR-014", "reject")] };
    expect(review(ds, REVIEW).result[0]?.state).toBe("rejected");
  });
  it("Given the reject finding sits on the request (a sample target) Then it counts for the row too", () => {
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: [row()], validation_finding: [finding("VR-019", "quarantine"), finding("VR-014", "reject", "sample:S9")] };
    expect(review(ds, REVIEW).result[0]?.state).toBe("rejected");
  });
  it("Given the reject finding sits on another result Then it does not count for this row: released as before", () => {
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: [row()], validation_finding: [finding("VR-019", "quarantine"), finding("VR-014", "reject", "result:R2")] };
    expect(review(ds, REVIEW).result[0]).toMatchObject({ state: "released", available_at: at(1, 13) });
  });
  it("Given the review of such a row Then the quarantine finding is resolved and the reject finding stays open, as for a row rejected at ingest", () => {
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: [row()], validation_finding: [finding("VR-019", "quarantine"), finding("VR-014", "reject")] };
    expect(review(ds, REVIEW).validation_finding.map((f) => [f.rule, f.status])).toEqual([["VR-019", "resolved"], ["VR-014", "open"]]);
  });
  it("Given the review runs twice Then the second run changes nothing", () => {
    const ds: RecordedDataset = { ...emptyDataset({ available_at: true }), result: [row()], validation_finding: [finding("VR-019", "quarantine"), finding("VR-014", "reject")] };
    const once = review(ds, REVIEW);
    expect(review(once, REVIEW)).toEqual(once);
  });
});

describe("S2f F4: from the rules to the review (VR-014 fires on a label that matches no open request, with system_issued_id on)", () => {
  const sample = (id: string): SampleRow => ({
    sample_id: id, unit_id: "U1", batch_id: "B-U1", keys_fixed_at_write: false, state: null, sampled_at: ingested - 1000, planned_at: null, operator_id: "OP-1", qualification_id: "Q1", label_method: "preprinted_barcode", container: "open",
  });
  it("Given a result quarantined at ingest whose label S9 is not an open request When the rules and then the review run Then the row ends rejected", () => {
    const ds: RecordedDataset = {
      ...emptyDataset({ available_at: true, system_issued_id: true }), sample: [sample("S1")], result: [row()], validation_finding: [finding("VR-019", "quarantine")],
    };
    const validated = validate(ds, { hold_limit_s: 1800 }).dataset;
    expect(validated.validation_finding.map((f) => [f.rule, f.action])).toContainEqual(["VR-014", "reject"]);
    expect(validated.result[0]?.state).toBe("quarantined"); // the ingest state stands until the review
    expect(review(validated, REVIEW).result[0]).toMatchObject({ state: "rejected", available_at: null });
  });
});

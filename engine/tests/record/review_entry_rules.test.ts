import { describe, expect, it } from "vitest";
import { resultsAsOf } from "../../src/record/asof.ts";
import { review } from "../../src/record/review.ts";
import type { RecordedDataset, ResultRow, ValidationFindingRow } from "../../src/record/types.ts";
import { emptyDataset } from "../support/eval_fixture.ts";
import { REVIEW, at } from "../support/review_setup.ts";

// The review outcome of the entry rules (data_model section 7, "Policy per rule id"; A218): the author ruled on 2026-10-30 that VR-005 (unit of the wrong dimension),
// VR-006 (physically impossible value) and VR-013 (dilution factor missing or implausible) are rejected at review. The expected values come from that ruling and from
// clock arithmetic (A215: a row stamped Tuesday 09:30 is reviewed at Tuesday 13:00; day 0 is a Monday), never from the policy table. Rows are typed by hand, so these
// tests read no rule: the review sees findings, states and stamps only.

const STAMP = at(1, 9, 30);
const REVIEW_POINT = at(1, 13);

const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  result_id: "R1", request_id: "S1", analyte: "glucose", version: 1, run_id: "S1/1/1", value: 5.0, measured_at: STAMP, available_at: STAMP, supersedes: null,
  ingested_at: STAMP, reviewed_at: null, state: null, ...over,
});
const finding = (rule: string, target: string, action: ValidationFindingRow["action"]): ValidationFindingRow => ({
  rule, target, severity: action === "hold" ? "warning" : "error", action, status: "open",
});
const world = (result: ResultRow[], findings: ValidationFindingRow[]): RecordedDataset => ({ ...emptyDataset({ available_at: true }), result, validation_finding: findings });

describe("Entry rules rejected at review (A218)", () => {
  // [rule, action of its finding, state it left, a value that shows the rule, the unit text of the entry]
  const CASES: [string, "hold" | "quarantine", "held" | "quarantined", Partial<ResultRow>][] = [
    ["VR-005 unit of the wrong dimension", "quarantine", "quarantined", { value: 5.0, unit_ucum: "mmol/L" }],
    ["VR-006 physically impossible value", "quarantine", "quarantined", { analyte: "viability", value: 970 }],
    ["VR-013 dilution factor missing or implausible", "hold", "held", { value: 5.0, dilution_factor: 3 }],
  ];

  describe.each(CASES)("%s", (name, action, state, over) => {
    const rule = name.slice(0, 6);
    const reviewed = (): RecordedDataset => review(world([row({ state, ...over })], [finding(rule, "result:R1", action)]), REVIEW);

    it("Given the row Then the review rejects it, with reviewed_at at the review point and no available_at", () => {
      expect(reviewed().result[0]).toMatchObject({ state: "rejected", reviewed_at: REVIEW_POINT, available_at: null });
    });
    it("Given the row Then its value, unit and measurement stamp are unchanged (value kept)", () => {
      expect(reviewed().result[0]).toMatchObject({ ...over, measured_at: STAMP, ingested_at: STAMP });
    });
    it("Given the row Then the finding is kept and resolved, as for the other rejecting rules", () => {
      expect(reviewed().validation_finding).toEqual([{ ...finding(rule, "result:R1", action), status: "resolved" }]);
    });
    it("Given the rejected row Then it is never available to a read, at any time", () => {
      expect(resultsAsOf(reviewed(), Number.MAX_SAFE_INTEGER)).toEqual([]);
    });
    it("Given a rule that releases (VR-015) on the same request Then the rejecting rule still wins", () => {
      const ds = world([row({ state, ...over })], [finding("VR-015", "sample:S1", "hold"), finding(rule, "result:R1", action)]);
      expect(review(ds, REVIEW).result[0]).toMatchObject({ state: "rejected", available_at: null });
    });
  });

  it("Given a row held by VR-013 and a row held by VR-015 on another request Then only the first is rejected", () => {
    const ds = world(
      [row({ state: "held", dilution_factor: 3 }), row({ result_id: "R2", request_id: "S2", state: "held" })],
      [finding("VR-013", "result:R1", "hold"), finding("VR-015", "sample:S2", "hold")],
    );
    expect(review(ds, REVIEW).result.map((r) => r.state)).toEqual(["rejected", "released"]);
  });
});

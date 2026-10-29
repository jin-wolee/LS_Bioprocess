import { describe, expect, it } from "vitest";
import { resultsAsOf } from "../../src/record/asof.ts";
import { REVIEW_OUTCOME, review, reviewPoint } from "../../src/record/review.ts";
import type { ReviewConfig } from "../../src/record/review.ts";
import { RULES } from "../../src/record/validate.ts";
import type { RecordedDataset, ResultRow, ValidationFindingRow } from "../../src/record/types.ts";
import { emptyDataset } from "../support/eval_fixture.ts";
import { REVIEW, ROSTER, at } from "../support/review_setup.ts";

// The review step (data_model section 7, "Review step and VR-012"): a held or quarantined row is released or rejected at the first staffed review point
// at or after its stamp. Expected values are typed by hand from the approved policy and from clock arithmetic (day 0 is a Monday; A201: weekdays 08:00 and
// 13:00, weekends 08:00). Datasets are typed row by row, so these tests read no rule: the review sees findings, states and stamps only.

const row = (id: string, request: string, over: Partial<ResultRow> = {}): ResultRow => ({
  result_id: id, request_id: request, analyte: "glucose", version: 1, run_id: `${request}/1/1`, value: 5.0, measured_at: 1000, available_at: 1000, supersedes: null,
  ingested_at: 1000, reviewed_at: null, state: null, ...over,
});
const finding = (rule: string, target: string, action: ValidationFindingRow["action"] = "hold"): ValidationFindingRow => ({ rule, target, severity: "warning", action, status: "open" });
const world = (result: ResultRow[], findings: ValidationFindingRow[], flags: Parameters<typeof emptyDataset>[0] = { available_at: true }): RecordedDataset => ({
  ...emptyDataset(flags), result, validation_finding: findings,
});
const reviewed = (ds: RecordedDataset, cfg: ReviewConfig = REVIEW): RecordedDataset => review(ds, cfg);
const ONE = (rule: string, action: ValidationFindingRow["action"], state: ResultRow["state"], over: Partial<ResultRow> = {}) =>
  world([row("R1", "S1", { state, ingested_at: at(1, 9, 30), measured_at: at(1, 9, 30), ...over })], [finding(rule, "result:R1", action)]);

describe("The review point (A201 and A215): the first staffed review point at or after a stamp", () => {
  // [description, stamp, expected next shift start]
  const START: [string, number, number][] = [
    ["Monday 07:00 waits for 08:00 the same day", at(0, 7), 28800],
    ["Monday exactly 08:00 is reviewed at once", at(0, 8), 28800],
    ["Monday 09:30 waits for the 13:00 shift", at(0, 9, 30), 46800],
    ["Monday exactly 13:00 is reviewed at once (at or after)", at(0, 13), 46800],
    ["Monday 13:00:01 waits for Tuesday 08:00 (a weekday has no later start)", at(0, 13, 0, 1), 115200],
    ["Monday 18:30, after the staffed day, rolls to Tuesday 08:00", at(0, 18, 30), 115200],
    ["Friday 19:00 rolls to Saturday 08:00 (a weekend day is staffed)", at(4, 19), 460800],
    ["Saturday 07:00 is reviewed at 08:00", at(5, 7), 460800],
    ["Saturday 09:00 waits for Sunday 08:00 (one shift on a weekend day, no 13:00 start)", at(5, 9), 547200],
    ["Saturday exactly 13:00 waits for Sunday 08:00 (13:00 is not a weekend start)", at(5, 13), 547200],
    ["Sunday 15:00 rolls to Monday 08:00", at(6, 15), 633600],
    ["Wednesday 14:00 of the second week (day 9) rolls to Thursday 08:00", at(9, 14), 10 * 86400 + 28800],
  ];
  it.each(START)("next_shift_start: %s", (_name, stamp, expected) => {
    expect(reviewPoint(stamp, ROSTER, "next_shift_start")).toBe(expected);
  });

  const END: [string, number, number][] = [
    ["Monday 09:30 waits for the end of the first shift, 13:00", at(0, 9, 30), 46800],
    ["Monday 13:00:01 waits for the end of the day, 18:00", at(0, 13, 0, 1), 64800],
    ["Monday 18:00:01 waits for Tuesday 13:00", at(0, 18, 0, 1), at(1, 13)],
    ["Saturday 09:00 waits for the end of the weekend shift, 14:00", at(5, 9), at(5, 14)],
    ["Saturday 14:00:01 waits for Sunday 14:00", at(5, 14, 0, 1), at(6, 14)],
    ["Friday 18:00:01 waits for Saturday 14:00", at(4, 18, 0, 1), at(5, 14)],
  ];
  it.each(END)("shift_end: %s", (_name, stamp, expected) => {
    expect(reviewPoint(stamp, ROSTER, "shift_end")).toBe(expected);
  });

  const NEXT_DAY: [string, number, number][] = [
    ["Monday 07:00 still waits for Tuesday 08:00", at(0, 7), at(1, 8)],
    ["Monday 09:30 waits for Tuesday 08:00", at(0, 9, 30), at(1, 8)],
    ["Friday 10:00 waits for Saturday 08:00", at(4, 10), at(5, 8)],
    ["Sunday 10:00 waits for Monday 08:00", at(6, 10), at(7, 8)],
  ];
  it.each(NEXT_DAY)("next_day_start: %s", (_name, stamp, expected) => {
    expect(reviewPoint(stamp, ROSTER, "next_day_start")).toBe(expected);
  });
});

describe("One review outcome per rule: a fixed policy of the rule id (A213, A214)", () => {
  // [rule, action of the finding, state the rule left, expected outcome]
  const POLICY: [string, ValidationFindingRow["action"], ResultRow["state"], "released" | "rejected"][] = [
    ["VR-010", "hold", "held", "rejected"],
    ["VR-012", "hold", "held", "rejected"],
    ["VR-009", "hold", "held", "rejected"],
    ["VR-015", "hold", "held", "released"],
    ["VR-011", "hold", "held", "released"],
    ["VR-020", "hold", "held", "released"],
    ["VR-003", "hold", "held", "released"],
    ["VR-004", "hold", "held", "released"],
    ["VR-002", "quarantine", "quarantined", "released"],
    ["VR-019", "quarantine", "quarantined", "released"],
  ];
  it.each(POLICY)("Given a row held by %s (%s) Then the review %s it", (rule, action, state, expected) => {
    const out = reviewed(ONE(rule, action, state));
    expect(out.result[0]?.state).toBe(expected);
    expect(out.result[0]?.value).toBe(5.0); // the value is kept in both outcomes
    expect(out.validation_finding.map((f) => f.rule)).toEqual([rule]); // the finding is kept
  });

  it("The policy table names exactly the rules that hold or quarantine a result row: the rules of the catalogue except VR-008b (no row), VR-014 (rejects at ingest)", () => {
    expect(Object.keys(REVIEW_OUTCOME).sort()).toEqual(["VR-002", "VR-003", "VR-004", "VR-009", "VR-010", "VR-011", "VR-012", "VR-015", "VR-019", "VR-020"]);
    const catalogue = RULES.filter((r) => r.action !== "reject" && r.id !== "VR-008b").map((r) => r.id).sort();
    expect(catalogue).toEqual(Object.keys(REVIEW_OUTCOME).sort());
  });

  it("Given a held row whose rule has no policy entry Then the review stops with an error: a new rule cannot reach the review without an outcome", () => {
    expect(() => reviewed(ONE("VR-099", "hold", "held"))).toThrow(/VR-099/);
  });
});

describe("Several rules on one row: any rejecting rule wins", () => {
  const ingested = at(1, 9, 30);
  const base = { ingested_at: ingested, measured_at: ingested };
  it("Given VR-015 (release) and VR-010 (reject) on one row Then it is rejected, whichever finding comes first", () => {
    for (const findings of [
      [finding("VR-015", "sample:S1"), finding("VR-010", "result:R1")],
      [finding("VR-010", "result:R1"), finding("VR-015", "sample:S1")],
    ]) {
      expect(reviewed(world([row("R1", "S1", { ...base, state: "held" })], findings)).result[0]?.state).toBe("rejected");
    }
  });
  it("Given VR-002 (quarantine, release) and VR-010 (hold, reject) Then the policy of the rule decides, not the severity of the action: rejected", () => {
    const ds = world([row("R1", "S1", { ...base, state: "quarantined" })], [finding("VR-002", "result:R1", "quarantine"), finding("VR-010", "result:R1")]);
    expect(reviewed(ds).result[0]?.state).toBe("rejected");
  });
  it("Given VR-004 and VR-015 (both release) on one row Then it is released", () => {
    const ds = world([row("R1", "S1", { ...base, state: "held" })], [finding("VR-004", "result:R1"), finding("VR-015", "sample:S1")]);
    expect(reviewed(ds).result[0]?.state).toBe("released");
  });
  it("Given a finding on another request or another result Then it does not count for this row", () => {
    const ds = world([row("R1", "S1", { ...base, state: "held" }), row("R2", "S2", { ...base })], [finding("VR-015", "sample:S1"), finding("VR-010", "result:R2")]);
    expect(reviewed(ds).result.map((r) => r.state)).toEqual(["released", null]); // R2 carries a finding but was never held: only a held row is reviewed
  });
});

describe("What a review writes on a row", () => {
  it("Given a row held by VR-015 at Tuesday 09:30 with available_at on Then it is released at Tuesday 13:00: reviewed_at = available_at = the review point, the value and the measurement stamp unchanged", () => {
    const out = reviewed(ONE("VR-015", "hold", "held", { value: 4.2 })).result[0] as ResultRow;
    expect(out).toMatchObject({ state: "released", reviewed_at: at(1, 13), available_at: at(1, 13), value: 4.2, measured_at: at(1, 9, 30), ingested_at: at(1, 9, 30) });
  });
  it("Given available_at off Then a released row gets reviewed_at and keeps available_at null (the column is not stored)", () => {
    const ds = world([row("R1", "S1", { state: "held", ingested_at: at(1, 9, 30), available_at: null })], [finding("VR-015", "sample:S1")], {});
    expect(reviewed(ds).result[0]).toMatchObject({ state: "released", reviewed_at: at(1, 13), available_at: null });
  });
  it("Given a row rejected at review Then it has reviewed_at, no available_at, its value, and is never available to a read, whatever the flag and the time", () => {
    for (const flags of [{ available_at: true }, {}]) {
      const ds = world([row("R1", "S1", { state: "held", value: 3.2, ingested_at: at(1, 9, 30), available_at: flags.available_at ? at(1, 9, 30) : null })], [finding("VR-010", "result:R1")], flags);
      const out = reviewed(ds);
      expect(out.result[0]).toMatchObject({ state: "rejected", reviewed_at: at(1, 13), available_at: null, value: 3.2 });
      expect(resultsAsOf(out, Number.MAX_SAFE_INTEGER)).toEqual([]);
    }
  });
  it("Given a row with no ingestion stamp (architecture A) Then the measured time sets the review point", () => {
    const ds = world([row("R1", "S1", { state: "held", ingested_at: null, measured_at: at(0, 7), available_at: null })], [finding("VR-012", "result:R1")], {});
    expect(reviewed(ds).result[0]).toMatchObject({ state: "rejected", reviewed_at: at(0, 8) });
  });
  it("Given a sample-level finding on a request with two results Then each result is reviewed at the first point after its own stamp", () => {
    const ds = world(
      [row("R1", "S1", { state: "held", ingested_at: at(0, 9, 30) }), row("R2", "S1", { analyte: "lactate", state: "held", ingested_at: at(0, 14) })],
      [finding("VR-015", "sample:S1")],
    );
    expect(reviewed(ds).result.map((r) => r.reviewed_at)).toEqual([at(0, 13), at(1, 8)]);
  });
  it("Given a row with no hold Then it is not reviewed: reviewed_at stays null and available_at is unchanged (review by exception)", () => {
    const out = reviewed(world([row("R1", "S1", { available_at: 1234 })], [])).result[0];
    expect(out).toMatchObject({ state: null, reviewed_at: null, available_at: 1234 });
  });
  it("Given a row that a rule rejected at ingest (VR-014) Then it stays rejected and is not reviewed", () => {
    const out = reviewed(ONE("VR-014", "reject", "rejected")).result[0];
    expect(out).toMatchObject({ state: "rejected", reviewed_at: null, value: 5.0 });
  });
  it("Given a reviewed dataset Then reviewing it again changes nothing", () => {
    const once = reviewed(ONE("VR-015", "hold", "held"));
    expect(reviewed(once)).toEqual(once);
  });
  it("Given the review Then the input dataset is not modified, and no table other than result and validation_finding changes", () => {
    const ds = ONE("VR-015", "hold", "held");
    const copy = structuredClone(ds);
    const out = reviewed(ds);
    expect(ds).toEqual(copy);
    expect({ ...out, result: [], validation_finding: [] }).toEqual({ ...ds, result: [], validation_finding: [] });
  });
  it("Given a finding on a reviewed row Then it is kept and its status is resolved; a finding on a source event or on a request with no result stays open", () => {
    const ds = world([row("R1", "S1", { state: "held" })], [finding("VR-015", "sample:S1"), finding("VR-008b", "source_event:AN-1/S9/1/1/glucose", "quarantine"), finding("VR-015", "sample:S7")]);
    expect(reviewed(ds).validation_finding.map((f) => [f.target, f.status])).toEqual([["sample:S1", "resolved"], ["source_event:AN-1/S9/1/1/glucose", "open"], ["sample:S7", "open"]]);
  });
});

describe("Sensitivity variants (reported, never gated)", () => {
  const late = at(1, 13, 30); // Tuesday 13:30
  it("Given a row at Tuesday 13:30 Then the next shift start is Wednesday 08:00, the shift end Tuesday 18:00 and the next day Wednesday 08:00", () => {
    const point = (timing: ReviewConfig["timing"]) => reviewed(ONE("VR-015", "hold", "held", { ingested_at: late, measured_at: late }), { roster: ROSTER, timing }).result[0]?.reviewed_at;
    expect(point("next_shift_start")).toBe(at(2, 8));
    expect(point("shift_end")).toBe(at(1, 18));
    expect(point("next_day_start")).toBe(at(2, 8));
  });
  it("Given VR-015 and VR-020 listed as rejecting Then those two are rejected and VR-004 is still released", () => {
    const cfg: ReviewConfig = { ...REVIEW, reject_also: ["VR-015", "VR-020"] };
    expect(reviewed(ONE("VR-015", "hold", "held"), cfg).result[0]?.state).toBe("rejected");
    expect(reviewed(ONE("VR-020", "hold", "held"), cfg).result[0]?.state).toBe("rejected");
    expect(reviewed(ONE("VR-004", "hold", "held"), cfg).result[0]?.state).toBe("released");
  });
});

describe("A released row in the as-of read", () => {
  it("Given a row released at Tuesday 13:00 and available_at on Then a read just before shows nothing and a read at the review point shows it", () => {
    const out = reviewed(ONE("VR-015", "hold", "held"));
    expect(resultsAsOf(out, at(1, 13) - 1).map((r) => r.result_id)).toEqual([]);
    expect(resultsAsOf(out, at(1, 13)).map((r) => r.result_id)).toEqual(["R1"]);
  });
  it("Given available_at off Then a released row is read as of now", () => {
    const ds = world([row("R1", "S1", { state: "held", ingested_at: at(1, 9, 30), available_at: null })], [finding("VR-015", "sample:S1")], {});
    expect(resultsAsOf(reviewed(ds), 0).map((r) => r.result_id)).toEqual(["R1"]);
  });
  it("Given version 1 released after version 2 became available Then the later version still wins: a release never puts an older version above its successor", () => {
    const ds = world(
      [
        row("R1", "S1", { state: "held", ingested_at: at(1, 9, 30), measured_at: at(1, 9, 30), available_at: at(1, 9, 30), value: 5.0 }),
        row("R2", "S1", { version: 2, supersedes: "R1", measured_at: at(1, 10), ingested_at: at(1, 10), available_at: at(1, 10), value: 5.4 }),
      ],
      [finding("VR-004", "result:R1")],
    );
    const out = reviewed(ds);
    expect(out.result[0]).toMatchObject({ state: "released", available_at: at(1, 13) }); // R1 becomes available after R2 did
    expect(resultsAsOf(out, at(1, 14)).map((r) => r.result_id)).toEqual(["R2"]);
  });
});

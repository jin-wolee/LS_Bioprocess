import { describe, expect, it } from "vitest";
import { NOW } from "../../src/evaluate/query.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import type { FlagName } from "../../src/record/architecture.ts";
import { resultsAsOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import { review } from "../../src/record/review.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { validate } from "../../src/record/validate.ts";
import type { RuleConfig } from "../../src/record/validate.ts";
import { SENSORS, STREAM, arch } from "../support/record_fixture.ts";
import { REVIEW } from "../support/review_setup.ts";

// VR-012, run QC failed (data_model section 7, "Review step and VR-012"). Fixture times: see record_fixture.ts. S2 is drawn at 5000; its first run (6000-6500) fails QC
// with glucose 3.2 and the rerun (8500-9000) passes with 3.4. All stamps are before 08:00 of day 0, so every held row is reviewed at 28800 (Monday 08:00).
//   with append_only_versions: R1 = S1, R2 = S2 attempt 1 (3.2, QC failed), R3 = S2 attempt 2 (3.4), R4 = S3.
//   without it: the rerun overwrites in place, so R2 = S2 with the value 3.4 of the run that passed.

const PLAIN: RuleConfig = {}; // no hold limit: VR-010 does not run
const WITH_LIMIT: RuleConfig = { hold_limit_s: 1800 }; // the rerun of S2 waited 3500 s
const rec = (flags: FlagName[], events: readonly ObservableEvent[] = STREAM): RecordedDataset => record({ events, sensors: SENSORS }, arch(...flags));
const checked = (ds: RecordedDataset, cfg: RuleConfig = PLAIN): RecordedDataset => review(validate(ds, cfg).dataset, REVIEW);
const vr012 = (ds: RecordedDataset) => validate(ds, PLAIN).dataset.validation_finding.filter((f) => f.rule === "VR-012").map((f) => [f.target, f.severity, f.action, f.status]);
const NO_RERUN = STREAM.filter((e) => !("attempt" in e && e.request_id === "S2" && e.attempt === 2) && e.type !== "rerun_requested");

describe("The run QC outcome is recorded by every architecture (no flag owns it)", () => {
  const OUTCOMES = { "S1/1/1": "qc_passed", "S2/1/1": "qc_failed", "S2/2/1": "qc_passed", "S3/1/1": "qc_passed" };
  it.each([
    ["A", [] as FlagName[]],
    ["B", ["system_issued_id", "ingest_idempotency", "audit_trail"] as FlagName[]],
    ["C", [...FLAG_NAMES] as FlagName[]],
    ["C minus append_only_versions", FLAG_NAMES.filter((f) => f !== "append_only_versions")],
  ])("Given %s Then every run carries the outcome of its qc_result event", (_name, flags) => {
    expect(Object.fromEntries(rec(flags).run.map((r) => [r.run_id, r.qc_outcome]))).toEqual(OUTCOMES);
  });
  it("Given a run with no qc_result in the stream Then its outcome is null", () => {
    const events = STREAM.filter((e) => !(e.type === "qc_result" && e.request_id === "S3"));
    expect(rec([], events).run.find((r) => r.run_id === "S3/1/1")?.qc_outcome).toBeNull();
  });
});

describe("VR-012 holds the results of a run whose recorded QC outcome failed", () => {
  it("Given append_only_versions on Then only the failed first attempt of S2 (R2, 3.2) is held, as an error with the action hold; the rerun (R3) and the others are not", () => {
    const ds = rec(["append_only_versions"]);
    expect(vr012(ds)).toEqual([["result:R2", "error", "hold", "open"]]);
    expect(validate(ds, PLAIN).dataset.result.map((r) => [r.result_id, r.value, r.state])).toEqual([["R1", 5.1, null], ["R2", 3.2, "held"], ["R3", 3.4, null], ["R4", 7.0, null]]);
  });
  it("Given append_only_versions off and a rerun Then the rerun overwrote the failed attempt: one row of S2 (3.4, from the run that passed) and nothing is held", () => {
    const ds = rec([]);
    expect(ds.result.filter((r) => r.request_id === "S2").map((r) => [r.value, r.run_id])).toEqual([[3.4, "S2/2/1"]]);
    expect(vr012(ds)).toEqual([]);
  });
  it("Given append_only_versions off and no rerun at the end of the horizon Then the single S2 row (3.2) belongs to the failed run and is held", () => {
    const ds = rec([], NO_RERUN);
    expect(ds.result.filter((r) => r.request_id === "S2").map((r) => [r.value, r.run_id])).toEqual([[3.2, "S2/1/1"]]);
    expect(vr012(ds)).toEqual([["result:R2", "error", "hold", "open"]]);
  });
  it("Given architecture A (no flag) Then VR-012 is evaluable: the rule needs no stored field that a flag owns", () => {
    expect(validate(rec([]), PLAIN).not_evaluable.map((n) => n.rule)).not.toContain("VR-012");
  });
  it("Given an over_range outcome Then it is not a QC failure and nothing is held", () => {
    const events = STREAM.map((e) => (e.type === "qc_result" && e.request_id === "S2" && e.attempt === 1 ? { ...e, outcome: "over_range" as const } : e));
    expect(vr012(rec(["append_only_versions"], events))).toEqual([]);
  });
  it("Given a stream with no qc_result at all Then nothing is held (an unknown outcome is not a failure)", () => {
    expect(vr012(rec(["append_only_versions"], STREAM.filter((e) => e.type !== "qc_result")))).toEqual([]);
  });
});

describe("At review the failed run is rejected and the rerun stands on its own", () => {
  const out = checked(rec(["append_only_versions", "available_at"]));
  it("Given the failed first attempt Then it is rejected at Monday 08:00 with its value kept and no availability, and the finding is resolved", () => {
    expect(out.result.find((r) => r.result_id === "R2")).toMatchObject({ state: "rejected", value: 3.2, reviewed_at: 28800, available_at: null });
    expect(out.validation_finding.filter((f) => f.rule === "VR-012").map((f) => f.status)).toEqual(["resolved"]);
  });
  it("Given the rerun Then it is not held, keeps its link to the failed version, and the read at the end shows S1, the rerun of S2 and S3", () => {
    expect(out.result.find((r) => r.result_id === "R3")).toMatchObject({ state: null, supersedes: "R2", value: 3.4, reviewed_at: null });
    expect(resultsAsOf(out, NOW).map((r) => r.result_id)).toEqual(["R1", "R3", "R4"]);
  });
  it("Given the failed run with no rerun Then its request has no result after the review: unanswerable, never the failed value", () => {
    const lone = checked(rec(["append_only_versions", "available_at"], NO_RERUN));
    expect(resultsAsOf(lone, NOW).map((r) => r.request_id)).toEqual(["S1", "S3"]);
    expect(lone.result.find((r) => r.request_id === "S2")).toMatchObject({ state: "rejected", value: 3.2 });
  });
});

describe("The 22-request finding of S2c2: a held rerun no longer lets the read fall back to the failed first attempt", () => {
  it("Given the rerun of S2 held by VR-010 (3500 s against a 1800 s limit) and the first attempt failed Then both are rejected and S2 has no result", () => {
    const ds = checked(rec(["two_clocks", "append_only_versions", "available_at"]), WITH_LIMIT);
    expect(ds.result.filter((r) => r.request_id === "S2").map((r) => [r.result_id, r.state, r.value])).toEqual([["R2", "rejected", 3.2], ["R3", "rejected", 3.4]]);
    expect(resultsAsOf(ds, NOW).map((r) => r.request_id)).toEqual(["S1", "S3"]);
  });
  it("Given validation only (no review) Then the read of S2 shows neither attempt: the first is held by VR-012 and the rerun by VR-010", () => {
    const ds = validate(rec(["two_clocks", "append_only_versions", "available_at"]), WITH_LIMIT).dataset;
    expect(resultsAsOf(ds, NOW).map((r) => r.result_id)).toEqual(["R1", "R4"]);
  });
});

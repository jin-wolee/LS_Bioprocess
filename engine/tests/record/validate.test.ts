import { describe, expect, it } from "vitest";
import type { ObservableEvent } from "../../src/observe.ts";
import type { FlagName } from "../../src/record/architecture.ts";
import { resultsAsOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import type { QualificationInput, RecordedDataset } from "../../src/record/types.ts";
import { RULE_IDS, validate } from "../../src/record/validate.ts";
import type { RuleConfig } from "../../src/record/validate.ts";
import { SENSORS, STREAM, WITH_CONFLICT, WITH_HARVEST, arch, byTime } from "../support/record_fixture.ts";

// S2b: the detection rules of the catalogue (data_model section 8) applied to a recorded dataset. A rule changes the state of a row
// and writes a finding; it never edits a value. A rule that needs a field the architecture does not store is not evaluable (it does not
// "pass"). Test-only values: the limits below are fixture inputs, not domain claims. Fixture times: see record_fixture.ts.
//   hold_time (run_started_at minus sampled_at): S1 400 s, S2 first run 1000 s, S2 rerun 3500 s, S3 400 s.

const CFG: RuleConfig = { hold_limit_s: 1800, late_tolerance_s: 600, clock_tolerance_s: 900 };
const PLAIN: RuleConfig = { late_tolerance_s: 600, clock_tolerance_s: 900 }; // no hold limit: the rerun of S2 (3500 s) is then not flagged by VR-010
const QUALS: QualificationInput[] = [
  { qualification_id: "Q1", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: null },
  { qualification_id: "Q2", operator_id: "OP-2", qualified: false, valid_from: 6000, valid_to: null }, // not valid at the draw of S2 (5000)
];
const ALL_QUALS: QualificationInput[] = [{ ...(QUALS[0] as QualificationInput) }, { ...(QUALS[1] as QualificationInput), valid_from: 0 }];

const rec = (flags: FlagName[], events: readonly ObservableEvent[] = STREAM, extra: { received_at?: Record<string, number>; qualifications?: QualificationInput[] } = {}): RecordedDataset =>
  record({ events, sensors: SENSORS, ...extra }, arch(...flags));
const edit = (f: (e: ObservableEvent) => ObservableEvent): ObservableEvent[] => STREAM.map(f);
const hits = (ds: RecordedDataset, cfg = CFG) =>
  validate(ds, cfg).dataset.validation_finding.filter((f) => f.action !== "no-op").map((f) => [f.rule, f.target, f.severity, f.action] as const).sort((a, b) => (a.join() < b.join() ? -1 : 1));
const idOf = (ds: RecordedDataset, request: string, version = 1): string => ds.result.find((r) => r.request_id === request && r.version === version)?.result_id as string;
const stateOf = (ds: RecordedDataset, request: string): (string | null)[] => validate(ds, CFG).dataset.result.filter((r) => r.request_id === request).map((r) => r.state);
const notEvaluable = (ds: RecordedDataset, cfg = CFG): string[] => validate(ds, cfg).not_evaluable.map((n) => n.rule);

describe("The rule catalogue", () => {
  it("Given architecture A (no flag) Then only VR-012 is evaluable (the run QC outcome belongs to no flag), nothing is flagged on the stream (the rerun overwrote the failed attempt), and 'not evaluable' is reported for the others rather than 'passed'", () => {
    const v = validate(rec([]), CFG);
    expect(v.not_evaluable.map((n) => n.rule)).toEqual(["VR-002", "VR-003", "VR-004", "VR-008b", "VR-009", "VR-010", "VR-011", "VR-014", "VR-015", "VR-019", "VR-020"]);
    expect(RULE_IDS).toEqual(["VR-002", "VR-003", "VR-004", "VR-008b", "VR-009", "VR-010", "VR-011", "VR-012", "VR-014", "VR-015", "VR-019", "VR-020"]);
    expect(v.dataset.validation_finding).toEqual([]);
  });

  it("Given all eight flags, full qualifications and the clean fixture Then every rule is evaluable and only two fire: VR-010 on the rerun of S2 (3500 s against 1800 s) and VR-012 on its failed first attempt", () => {
    const ds = rec(["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail"], STREAM, { qualifications: ALL_QUALS });
    const v = validate(ds, CFG);
    expect(v.not_evaluable).toEqual([]);
    expect(hits(ds)).toEqual([["VR-010", `result:${idOf(ds, "S2", 2)}`, "warning", "hold"], ["VR-012", `result:${idOf(ds, "S2", 1)}`, "error", "hold"]]);
    expect(idOf(ds, "S2", 2)).toBe("R3");
  });
});

describe("VR-002 sampled_at is not later than measured_at (quarantine; needs two_clocks)", () => {
  const early = edit((e) => (e.type === "result_measured" && e.request_id === "S1" ? { ...e, t: 1000 } : e)); // measured at 1000, drawn at 1100
  it("Given S1 measured before it was drawn Then its result is quarantined", () => {
    const ds = rec(["two_clocks"], early);
    expect(hits(ds, PLAIN)).toEqual([["VR-002", "result:R1", "error", "quarantine"]]);
    expect(stateOf(ds, "S1")).toEqual(["quarantined"]);
  });
  it("Given only the measured time is stored Then VR-002 is not evaluable and S1 is not flagged", () => {
    const ds = rec([], early);
    expect(notEvaluable(ds)).toContain("VR-002");
    expect(hits(ds)).toEqual([]);
  });
});

describe("VR-003 and VR-004 compare measured_at with ingested_at (hold; need ingested_at and a tolerance)", () => {
  // The S1 instrument clock runs 18000 s (5 h) ahead: the event is stamped 20000, the host received it at 2000. Tolerances: 600 s and 900 s (test-only).
  const skewed = edit((e) => (e.type === "result_measured" && e.request_id === "S1" ? { ...e, t: 20000 } : e));
  const received = { "AN-1/S1/1/1/glucose": 2000 };
  it("Given a clock 5 h ahead Then both rules hold S1: VR-003 (measured later than ingested) as a warning and VR-004 (offset) as an error", () => {
    const ds = rec(["ingest_idempotency"], skewed, { received_at: received });
    expect(hits(ds)).toEqual([["VR-003", "result:R1", "warning", "hold"], ["VR-004", "result:R1", "error", "hold"]]);
    expect(stateOf(ds, "S1")).toEqual(["held"]);
  });
  it("Given a clock 5 h behind (received at 20000, stamped 2000) Then only VR-004 fires: the measured time is not later than the ingested time", () => {
    const ds = rec(["ingest_idempotency"], STREAM, { received_at: { "AN-1/S1/1/1/glucose": 20000 } });
    expect(hits(ds)).toEqual([["VR-004", "result:R1", "error", "hold"]]);
  });
  it("Given an offset of 500 s Then neither rule fires (600 s and 900 s tolerance)", () => {
    expect(hits(rec(["ingest_idempotency"], STREAM, { received_at: { "AN-1/S1/1/1/glucose": 1500 } }))).toEqual([]);
  });
  it("Given an offset of 700 s Then VR-003 fires and VR-004 does not (700 is above 600 and below 900)", () => {
    expect(hits(rec(["ingest_idempotency"], STREAM, { received_at: { "AN-1/S1/1/1/glucose": 1300 } }))).toEqual([["VR-003", "result:R1", "warning", "hold"]]);
  });
  it("Given a system without the idempotency flag (two_clocks only) Then ingested_at is stored and both rules still fire: ablating ingest_idempotency from C does not remove clock detection", () => {
    const ds = rec(["two_clocks"], skewed, { received_at: received });
    expect(hits(ds, PLAIN)).toEqual([["VR-003", "result:R1", "warning", "hold"], ["VR-004", "result:R1", "error", "hold"]]);
    const c = rec(["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "audit_trail"], skewed, { received_at: received });
    expect(hits(c, PLAIN).map((h) => h[0])).toEqual(expect.arrayContaining(["VR-003", "VR-004"]));
  });
  it("Given ingested_at is not stored (no flag at all, as in A) Then both are not evaluable and the skew is invisible", () => {
    const ds = rec([], skewed, { received_at: received });
    expect(notEvaluable(ds)).toEqual(expect.arrayContaining(["VR-003", "VR-004"]));
    expect(hits(ds)).toEqual([]);
  });
  it("Given no tolerance is configured Then both are not evaluable, with the reason named", () => {
    const v = validate(rec(["ingest_idempotency"], skewed, { received_at: received }), {});
    expect(v.not_evaluable.filter((n) => n.rule === "VR-003" || n.rule === "VR-004").map((n) => n.reason.includes("tolerance"))).toEqual([true, true]);
  });
});

describe("VR-009 two samples of one unit with the same sampled_at and analyte but different ids (hold; needs two_clocks)", () => {
  // S4 is a copy of S1 under another id: same unit U1, same draw time 1100, same analyte, measured 700 s later.
  const twin: ObservableEvent[] = byTime([
    ...STREAM,
    ...STREAM.flatMap((e): ObservableEvent[] => {
      if ("sample_id" in e && e.sample_id === "S1") return [{ ...e, sample_id: "S4" } as ObservableEvent];
      if ("request_id" in e && e.request_id === "S1") return [{ ...e, request_id: "S4", t: e.t + 700 } as ObservableEvent];
      return [];
    }),
  ]);
  it("Given the twin Then both results are held", () => {
    const ds = rec(["two_clocks"], twin);
    const targets = [idOf(ds, "S1"), idOf(ds, "S4")].map((id) => `result:${id}`).sort();
    expect(hits(ds, PLAIN)).toEqual(targets.map((t) => ["VR-009", t, "warning", "hold"]));
    expect([stateOf(ds, "S1"), stateOf(ds, "S4"), stateOf(ds, "S3")]).toEqual([["held"], ["held"], [null]]);
  });
  it("Given only the measured time is stored Then VR-009 is not evaluable and the twin passes unseen", () => {
    const ds = rec([], twin);
    expect(notEvaluable(ds)).toContain("VR-009");
    expect(hits(ds)).toEqual([]);
  });
});

describe("VR-010 hold time above the limit (hold; needs two_clocks)", () => {
  it("Given the limit 1800 s Then only the rerun of S2 (3500 s) is held; the first run of S2 (1000 s) and S1, S3 (400 s) are not", () => {
    const ds = rec(["two_clocks", "append_only_versions"]);
    expect(hits(ds)).toEqual([["VR-010", "result:R3", "warning", "hold"], ["VR-012", "result:R2", "error", "hold"]]); // VR-012: the first run of S2 failed QC
    expect(stateOf(ds, "S2")).toEqual(["held", "held"]); // the first run is held by VR-012, not by VR-010
  });
  it("Given a hold time of exactly the limit Then it is not flagged: the rule is 'above'", () => {
    const only012 = [["VR-012", "result:R2", "error", "hold"]]; // the failed first attempt of S2 is held whatever the limit
    expect(hits(rec(["two_clocks", "append_only_versions"]), { ...CFG, hold_limit_s: 3500 })).toEqual(only012);
    expect(hits(rec(["two_clocks", "append_only_versions"]), { ...CFG, hold_limit_s: 3499 })).toEqual([["VR-010", "result:R3", "warning", "hold"], ...only012]);
  });
  it("Given one stored time (feed in the gap) Then VR-010 is not evaluable: the hold cannot be computed", () => {
    expect(notEvaluable(rec([]))).toContain("VR-010");
  });
  it("Given no limit is configured Then VR-010 is not evaluable and the reason says so", () => {
    const v = validate(rec(["two_clocks"]), {});
    expect(v.not_evaluable.find((n) => n.rule === "VR-010")?.reason).toMatch(/limit/);
  });
});

describe("VR-011 run has no instrument-state link while instrument_state_snapshot is on (hold)", () => {
  const uncalibrated = STREAM.filter((e) => !(e.type === "calibration_recorded" && e.t === 0)); // the first calibration is at 7200: S1 and the first run of S2 have no state
  it("Given runs before the first calibration Then their results are held", () => {
    const ds = rec(["instrument_state_snapshot", "append_only_versions"], uncalibrated);
    expect(hits(ds)).toEqual([["VR-011", "result:R1", "warning", "hold"], ["VR-011", "result:R2", "warning", "hold"], ["VR-012", "result:R2", "error", "hold"]]);
  });
  it("Given the snapshot off Then there is no link to miss and the rule is not evaluable", () => {
    expect(notEvaluable(rec([], uncalibrated))).toContain("VR-011");
  });
});

describe("VR-014 label matches no open request (reject; needs the registry of issued keys, system_issued_id)", () => {
  const renamed = (to: string): ObservableEvent[] => edit((e) => ("request_id" in e && e.request_id === "S1" ? ({ ...e, request_id: to } as ObservableEvent) : e));
  it("Given S1 measured under the id 'S1?' that no plan issued Then the result is rejected", () => {
    const ds = rec(["system_issued_id"], renamed("S1?"));
    expect(hits(ds)).toEqual([["VR-014", "result:R1", "error", "reject"]]);
    expect(stateOf(ds, "S1?")).toEqual(["rejected"]);
  });
  it("Given the typo matches another open request ('S3') Then it passes (the silent case)", () => {
    expect(hits(rec(["system_issued_id"], renamed("S3")))).toEqual([]);
  });
  it("Given keys are typed (no registry) Then the rule is not evaluable and 'S1?' is invisible", () => {
    const ds = rec([], renamed("S1?"));
    expect(notEvaluable(ds)).toContain("VR-014");
    expect(hits(ds)).toEqual([]);
  });
});

describe("VR-015 operator or qualification missing or not valid on the date while audit_trail is on (hold)", () => {
  it("Given OP-2 had no valid qualification at the draw of S2 Then the sample S2 is flagged and its result held; S1 and S3 are not", () => {
    const ds = rec(["audit_trail"], STREAM, { qualifications: QUALS });
    expect(hits(ds)).toEqual([["VR-015", "sample:S2", "warning", "hold"]]);
    expect([stateOf(ds, "S1"), stateOf(ds, "S2"), stateOf(ds, "S3")]).toEqual([[null], ["held"], [null]]);
  });
  it("Given no qualification records at all Then every sample is flagged: a missing qualification is not a pass", () => {
    expect(hits(rec(["audit_trail"])).map((h) => h[1])).toEqual(["sample:S1", "sample:S2", "sample:S3"]);
  });
  it("Given audit_trail off (the operator is absent) Then VR-015 is not evaluable", () => {
    expect(notEvaluable(rec([], STREAM, { qualifications: QUALS }))).toContain("VR-015");
  });
});

describe("VR-019 result version n+1 arrives without version n (quarantine; needs versions)", () => {
  it("Given version 2 with no link to version 1 Then it is quarantined", () => {
    const ds = rec(["append_only_versions"]);
    ds.result[2] = { ...(ds.result[2] as RecordedDataset["result"][number]), supersedes: null };
    expect(hits(ds)).toEqual([["VR-012", "result:R2", "error", "hold"], ["VR-019", "result:R3", "error", "quarantine"]]); // VR-012: the failed first attempt of S2
  });
  it("Given version 2 linked to a row that does not exist Then it is quarantined too", () => {
    const ds = rec(["append_only_versions"]);
    ds.result[2] = { ...(ds.result[2] as RecordedDataset["result"][number]), supersedes: "R99" };
    expect(hits(ds)).toEqual([["VR-012", "result:R2", "error", "hold"], ["VR-019", "result:R3", "error", "quarantine"]]); // VR-012: the failed first attempt of S2
  });
  it("Given the intact chain Then nothing fires; given overwrite in place (no versions) Then the rule is not evaluable", () => {
    expect(hits(rec(["append_only_versions"]))).toEqual([["VR-012", "result:R2", "error", "hold"]]); // only the failed first attempt of S2, no VR-019
    expect(notEvaluable(rec([]))).toContain("VR-019");
  });
});

describe("VR-020 sample on a unit with no open batch at sampled_at (hold; needs two_clocks)", () => {
  it("Given U1 harvested at 1500 Then S2 (drawn at 5000 on U1) is held and S1 (drawn at 1100) is not", () => {
    const ds = rec(["two_clocks"], WITH_HARVEST);
    expect(hits(ds, PLAIN)).toEqual([["VR-020", "sample:S2", "error", "hold"]]);
    expect(stateOf(ds, "S2")).toEqual(["held"]);
  });
  it("Given only the measured time is stored Then the gross case is invisible and the rule is not evaluable", () => {
    const ds = rec([], WITH_HARVEST);
    expect(notEvaluable(ds)).toContain("VR-020");
    expect(hits(ds)).toEqual([]);
  });
});

describe("VR-008b same source event id, different content (quarantine; needs ingest_idempotency)", () => {
  it("Given the S1 result replayed with another value Then the incoming row is quarantined, the original stays and is not held", () => {
    const ds = rec(["ingest_idempotency"], WITH_CONFLICT);
    expect(hits(ds)).toEqual([["VR-008b", "source_event:AN-1/S1/1/1/glucose", "error", "quarantine"]]);
    expect(stateOf(ds, "S1")).toEqual([null]);
    expect(ds.result.find((r) => r.request_id === "S1")?.value).toBe(5.1);
  });
  it("Given the flag off Then the conflicting row is a second row and the rule is not evaluable", () => {
    expect(notEvaluable(rec([], WITH_CONFLICT))).toContain("VR-008b");
  });
});

describe("Rules change a status and never a value", () => {
  const cases: [string, RecordedDataset][] = [
    ["VR-002", rec(["two_clocks"], edit((e) => (e.type === "result_measured" && e.request_id === "S1" ? { ...e, t: 1000 } : e)))],
    ["VR-010", rec(["two_clocks", "append_only_versions"])],
    ["VR-014", rec(["system_issued_id"], edit((e) => ("request_id" in e && e.request_id === "S1" ? ({ ...e, request_id: "S1?" } as ObservableEvent) : e)))],
    ["VR-015", rec(["audit_trail"], STREAM, { qualifications: QUALS })],
    ["VR-020", rec(["two_clocks"], WITH_HARVEST)],
    ["VR-008b", rec(["ingest_idempotency"], WITH_CONFLICT)],
  ];
  it.each(cases)("%s: every table other than validation_finding and the state of result rows is unchanged, and no value, time or id moved", (_rule, ds) => {
    const before = structuredClone({ ...ds, historian: { late: ds.historian.late, series: [] } });
    const after = validate(ds, CFG).dataset;
    expect({ ...after, historian: { late: after.historian.late, series: [] }, validation_finding: [], result: after.result.map((r) => ({ ...r, state: null })) }).toEqual({
      ...before,
      validation_finding: [],
      result: before.result.map((r) => ({ ...r, state: null })),
    });
    expect(after.validation_finding.length).toBeGreaterThan(ds.validation_finding.length);
  });
  it("The input dataset itself is not modified by the validation", () => {
    const ds = rec(["two_clocks", "append_only_versions"]);
    const copy = structuredClone({ ...ds, historian: { late: [], series: [] } });
    validate(ds, CFG);
    expect({ ...ds, historian: { late: [], series: [] } }).toEqual(copy);
    expect(ds.result.map((r) => r.state)).toEqual([null, null, null, null]);
  });
  it("Given two rules on one row (VR-002 quarantine and VR-003 hold) Then the more severe state wins: quarantined", () => {
    const events = edit((e) => (e.type === "result_measured" && e.request_id === "S1" ? { ...e, t: 1000 } : e)); // measured 1000, drawn 1100, received 50 (950 s earlier than the stamp)
    const ds = rec(["two_clocks", "ingest_idempotency"], events, { received_at: { "AN-1/S1/1/1/glucose": 50 } });
    expect(hits(ds, PLAIN).map((h) => h[0])).toEqual(["VR-002", "VR-003", "VR-004"]);
    expect(stateOf(ds, "S1")).toEqual(["quarantined"]);
  });
});

describe("A held, quarantined or rejected result is not available to an as-of read", () => {
  it("Given the rerun of S2 held by VR-010 and its failed first attempt held by VR-012 Then the as-of read at the end of the run returns neither (before VR-012 it fell back to the failed first attempt)", () => {
    const ds = rec(["two_clocks", "append_only_versions", "available_at"]);
    expect(resultsAsOf(ds, 20000).map((r) => r.result_id)).toEqual(["R1", "R3", "R4"]);
    expect(resultsAsOf(validate(ds, CFG).dataset, 20000).map((r) => r.result_id)).toEqual(["R1", "R4"]);
  });
});

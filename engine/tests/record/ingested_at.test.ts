import { describe, expect, it } from "vitest";
import { CORE_FLAG_NAMES, FLAG_NAMES } from "../../src/record/architecture.ts";
import type { FlagName } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import type { QualificationInput } from "../../src/record/types.ts";
import { SENSORS, STREAM, arch } from "../support/record_fixture.ts";

// S2b, orchestrator decision 1 and ruling R1 (data_model section 14, question 7): a row-creation stamp is stored whenever a system writes the
// rows, that is whenever at least one of the eight flags of ADR-0005 is on (the lot and equipment links of ADR-0017 and ADR-0020 read nothing without a break-out event and do not count, spec 11.8.6); the all-off configuration (architecture A, the spreadsheet) stores none, so
// `ingested_at` is null and the rules that read it (VR-003, VR-004) are not evaluable for A. In layer-off runs the stamp equals the stamp of the
// observable event (no ingestion delay is modelled before the raw layer). The column does not hang on one flag: ablating `ingest_idempotency`
// from C must not also remove clock detection. A clock error makes the event stamp differ from the host receipt time; the injector hands the
// receipt time over as plain data (`received_at`, by source event id).
// Test-only values, from the fixture of record_fixture.ts: S1 is measured at 2000, S2 at 6500 and 9000, S3 at 10000.

const input = (extra: { received_at?: Record<string, number>; qualifications?: QualificationInput[] } = {}) => ({ events: STREAM, sensors: SENSORS, ...extra });
const stamps = (flags: FlagName[], extra = {}) => record(input(extra), arch(...flags)).result.map((r) => r.ingested_at);
const ALL: FlagName[] = [...FLAG_NAMES];

describe("ingested_at of a result row", () => {
  it("Given architecture A (no flag) Then no result row stores a row-creation stamp, with or without receipt times", () => {
    expect(stamps([], { received_at: { "AN-1/S1/1/1/glucose": 1500 } })).toEqual([null, null, null]); // three rows: without append_only_versions the rerun of S2 overwrote the first S2 row
  });

  it("Given B (system_issued_id, ingest_idempotency, audit_trail) Then the stamp is the stamp of the observable event: 2000 (S1), 9000 (the rerun of S2 replaced the first row), 10000 (S3)", () => {
    expect(stamps(["system_issued_id", "ingest_idempotency", "audit_trail"])).toEqual([2000, 9000, 10000]);
  });

  it("Given C (all ten flags) Then four rows store the event stamps 2000, 6500, 9000, 10000", () => {
    expect(stamps(ALL)).toEqual([2000, 6500, 9000, 10000]);
  });

  it.each(FLAG_NAMES)("Given C minus %s Then every row still stores its stamp: a system writes the rows (ablating one flag removes one thing)", (flag) => {
    const without = ALL.filter((f) => f !== flag);
    // minus append_only_versions the rerun of S2 overwrites the first S2 row, so there are three rows
    expect(stamps(without)).toEqual(flag === "append_only_versions" ? [2000, 9000, 10000] : [2000, 6500, 9000, 10000]);
  });

  it.each(CORE_FLAG_NAMES)("Given only %s on (one flag is enough to make a system) Then the rows store their stamps", (flag) => {
    expect(stamps([flag]).every((x) => x !== null)).toBe(true);
  });

  it.each(["material_lot_links", "equipment_links"] as const)("Given only %s on Then no row stores a stamp: with no break-out event nothing reads the flag, so it makes no system that writes the rows", (flag) => {
    expect(stamps([flag])).toEqual([null, null, null]);
  });

  it("Given the host received the S1 result at 1500 while the event is stamped 2000 Then S1 stores 1500 beside its measured_at 2000 and the others keep their event stamps", () => {
    const rows = record(input({ received_at: { "AN-1/S1/1/1/glucose": 1500 } }), arch("two_clocks")).result;
    expect(rows.map((r) => [r.request_id, r.measured_at, r.ingested_at])).toEqual([["S1", 2000, 1500], ["S2", 9000, 9000], ["S3", 10000, 10000]]);
  });

  it("Given the flag Then no result row carries a state: the recorder alone never holds, quarantines or rejects", () => {
    expect(record(input(), arch("ingest_idempotency")).result.map((r) => r.state)).toEqual([null, null, null]);
  });
});

describe("audit_trail attaches the qualification reference that was valid at the draw", () => {
  // OP-1 is qualified from 0 on; OP-2 only from 6000, so at its draw of S2 (5000) OP-2 had no valid qualification.
  const QUALS: QualificationInput[] = [
    { qualification_id: "Q1", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: null },
    { qualification_id: "Q2", operator_id: "OP-2", qualified: false, valid_from: 6000, valid_to: null },
  ];

  it("Given audit_trail on Then S1 and S3 (OP-1) carry Q1 and S2 (OP-2, drawn at 5000, valid from 6000) carries none", () => {
    const ds = record(input({ qualifications: QUALS }), arch("audit_trail"));
    expect(ds.sample.map((s) => [s.sample_id, s.operator_id, s.qualification_id])).toEqual([["S1", "OP-1", "Q1"], ["S2", "OP-2", null], ["S3", "OP-1", "Q1"]]);
    expect(ds.qualification.map((q) => q.qualification_id)).toEqual(["Q1", "Q2"]);
  });

  it("Given a qualification that ended before the draw (valid_to 1000 for the draw at 1100) Then no reference is attached", () => {
    const ds = record(input({ qualifications: [{ qualification_id: "Q9", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: 1000 }] }), arch("audit_trail"));
    expect(ds.sample.map((s) => s.qualification_id)).toEqual([null, null, null]);
  });

  it("Given audit_trail off Then no operator, no reference and no qualification table are stored", () => {
    const ds = record(input({ qualifications: QUALS }), arch());
    expect(ds.sample.map((s) => [s.operator_id, s.qualification_id])).toEqual([[null, null], [null, null], [null, null]]);
    expect(ds.qualification).toEqual([]);
  });
});

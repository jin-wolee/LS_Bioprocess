import { describe, expect, it } from "vitest";
import { batchOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { SENSORS, STREAM, WITH_CONFLICT, WITH_HARVEST, WITH_REPLAY, WITH_SKIP, arch } from "../support/record_fixture.ts";

// S2a Step 1, one test per flag: the same observable stream recorded with the flag on and with it off (every other flag off), and the
// documented difference in the recorded rows (spec section 5, the On and Off columns). Expected rows are typed by hand from the
// fixture in support/record_fixture.ts; the three samples are S1, S2 (with a rerun) and S3.

const rec = (flags: Parameters<typeof arch>, events = STREAM): RecordedDataset => record({ events, sensors: SENSORS }, arch(...flags));
const col = <T, K extends keyof T>(rows: readonly T[], key: K): T[K][] => rows.map((r) => r[key]);

describe("system_issued_id: the plan that issues the label gives the sample its planned time", () => {
  it("Given the flag on When recorded Then each sample row carries planned_at, the stamp of its sample_planned event", () => {
    const ds = rec(["system_issued_id"]);
    expect(col(ds.sample, "sample_id")).toEqual(["S1", "S2", "S3"]);
    expect(col(ds.sample, "planned_at")).toEqual([900, 4800, 9000]);
  });
  it("Given the flag off When recorded Then planned_at is null on every sample row", () => {
    expect(col(rec([]).sample, "planned_at")).toEqual([null, null, null]);
  });
});

describe("two_clocks: sampled_at and measured_at, or the measured time alone", () => {
  it("Given the flag on When recorded Then sampled_at is the stamp of the draw and measured_at the stamp of the result", () => {
    const ds = rec(["two_clocks"]);
    expect(col(ds.sample, "sampled_at")).toEqual([1100, 5000, 9100]);
    expect(col(ds.result, "measured_at")).toEqual([2000, 9000, 10000]);
  });
  it("Given the flag off When recorded Then sampled_at is not stored and the one time stored is the measured time", () => {
    const ds = rec([]);
    expect(col(ds.sample, "sampled_at")).toEqual([null, null, null]);
    expect(col(ds.result, "measured_at")).toEqual([2000, 9000, 10000]);
  });
});

describe("available_at: each row carries when it became knowable", () => {
  it("Given the flag on When recorded Then every result row carries available_at, the stamp of its result event", () => {
    expect(col(rec(["available_at"]).result, "available_at")).toEqual([2000, 9000, 10000]);
  });
  it("Given the flag off When recorded Then available_at is null on every result row", () => {
    expect(col(rec([]).result, "available_at")).toEqual([null, null, null]);
  });
});

describe("instrument_state_snapshot: the run links instrument, calibration and reagent lot", () => {
  it("Given the flag on When recorded Then the calibrations become instrument states and each run links the state in force at its start", () => {
    const ds = rec(["instrument_state_snapshot"]);
    expect(ds.instrument_state).toEqual([
      { instrument_state_id: "AN-1@0", instrument_id: "AN-1", calibration_ref: "AN-1/cal@0", reagent_lot: "LOT-1", valid_from: 0, valid_to: 7200 },
      { instrument_state_id: "AN-1@7200", instrument_id: "AN-1", calibration_ref: "AN-1/cal@7200", reagent_lot: "LOT-2", valid_from: 7200, valid_to: null },
    ]);
    expect(ds.run.map((r) => [r.run_id, r.instrument_id, r.instrument_state_id])).toEqual([
      ["S1/1/1", "AN-1", "AN-1@0"],
      ["S2/1/1", "AN-1", "AN-1@0"],
      ["S2/2/1", "AN-1", "AN-1@7200"],
      ["S3/1/1", "AN-1", "AN-1@7200"],
    ]);
  });
  it("Given the flag off When recorded Then there are no instrument states, no link, and the analyzer is free text only", () => {
    const ds = rec([]);
    expect(ds.instrument_state).toEqual([]);
    expect(col(ds.run, "instrument_id")).toEqual([null, null, null, null]);
    expect(col(ds.run, "instrument_state_id")).toEqual([null, null, null, null]);
    expect(col(ds.run, "analyzer_name")).toEqual(["AN-1", "AN-1", "AN-1", "AN-1"]);
  });
});

describe("append_only_versions: a rerun creates a version, or overwrites in place", () => {
  it("Given the flag on When S2 is rerun Then both versions are recorded and version 2 supersedes version 1", () => {
    const ds = rec(["append_only_versions"]);
    expect(ds.result.map((r) => [r.result_id, r.request_id, r.version, r.value, r.measured_at, r.run_id, r.supersedes])).toEqual([
      ["R1", "S1", 1, 5.1, 2000, "S1/1/1", null],
      ["R2", "S2", 1, 3.2, 6500, "S2/1/1", null],
      ["R3", "S2", 2, 3.4, 9000, "S2/2/1", "R2"],
      ["R4", "S3", 1, 7.0, 10000, "S3/1/1", null],
    ]);
  });
  it("Given the flag off When S2 is rerun Then one row remains, overwritten in place, and the first value is gone", () => {
    const ds = rec([]);
    expect(ds.result.map((r) => [r.result_id, r.request_id, r.version, r.value, r.measured_at, r.run_id, r.supersedes])).toEqual([
      ["R1", "S1", 1, 5.1, 2000, "S1/1/1", null],
      ["R2", "S2", 1, 3.4, 9000, "S2/2/1", null],
      ["R3", "S3", 1, 7.0, 10000, "S3/1/1", null],
    ]);
    expect(ds.result.some((r) => r.value === 3.2)).toBe(false);
  });
});

describe("write_time_keys: keys fixed at write time, or the batch derived at read by a time join", () => {
  // WITH_HARVEST: U1 is harvested at 1500. S1 is drawn at 1100 (before) and measured at 2000 (after); S2 is drawn and measured after it; S3 is on U2.
  const batches = (ds: RecordedDataset): (string | null)[] => ds.result.map((r) => batchOf(ds, r));

  it("Given the flag on When recorded Then sample_id, unit_id and batch_id are fixed at write, whatever the clocks say", () => {
    const ds = rec(["write_time_keys"], WITH_HARVEST);
    expect(col(ds.sample, "keys_fixed_at_write")).toEqual([true, true, true]);
    expect(ds.sample.map((s) => [s.sample_id, s.unit_id, s.batch_id])).toEqual([["S1", "U1", "B-U1"], ["S2", "U1", "B-U1"], ["S3", "U2", "B-U2"]]);
    expect(batches(ds)).toEqual(["B-U1", "B-U1", "B-U2"]); // S1, S2 (one row: the rerun overwrote it), S3
  });
  it("Given the flag off with one stored time, the measured time Then batch_id is not stored and the join at the measured time finds no open batch for S1 and S2", () => {
    const ds = rec([], WITH_HARVEST);
    expect(col(ds.sample, "keys_fixed_at_write")).toEqual([false, false, false]);
    expect(ds.sample.map((s) => [s.sample_id, s.unit_id, s.batch_id])).toEqual([["S1", "U1", null], ["S2", "U1", null], ["S3", "U2", null]]);
    expect(batches(ds)).toEqual([null, null, "B-U2"]); // measured at 2000 and 9000: U1 was harvested at 1500; S3 at 10000: B-U2 is open
  });
  it("Given the flag off with two_clocks on Then the join uses sampled_at: S1, drawn before the harvest, gets its batch while S2 still gets none", () => {
    const ds = rec(["two_clocks"], WITH_HARVEST);
    expect(col(ds.sample, "batch_id")).toEqual([null, null, null]);
    expect(batches(ds)).toEqual(["B-U1", null, "B-U2"]); // sampled at 1100 (open), 5000 (harvested at 1500), 9100 (open)
  });
});

describe("ingest_idempotency: a replayed result row is a no-op, a conflicting one is kept aside, or both double count", () => {
  it("Given the flag on When the S1 result is replayed unchanged Then S1 has one result row, one key is recorded per distinct event and the replay is logged as information", () => {
    const ds = rec(["ingest_idempotency"], WITH_REPLAY);
    expect(col(ds.result, "request_id")).toEqual(["S1", "S2", "S3"]);
    expect(ds.source_event.map((s) => [s.source_system, s.source_event_id, s.received_at])).toEqual([
      ["AN-1", "AN-1/S1/1/1/glucose", 2000],
      ["AN-1", "AN-1/S2/1/1/glucose", 6500],
      ["AN-1", "AN-1/S2/2/1/glucose", 9000],
      ["AN-1", "AN-1/S3/1/1/glucose", 10000],
    ]);
    expect(ds.source_event[0]?.idempotency_key).toBe("AN-1|AN-1/S1/1/1/glucose|v1"); // source, event id and content version; the value is not in it
    expect(ds.validation_finding).toEqual([{ rule: "VR-008", target: "source_event:AN-1/S1/1/1/glucose", severity: "info", action: "no-op", status: "resolved" }]);
    expect(ds.ingest_conflict).toEqual([]);
  });
  it("Given the flag on When the S1 result comes again with the same event id and the value 5.9 Then the original 5.1 stays, nothing is loaded and the incoming row is kept in the conflict list", () => {
    const ds = rec(["ingest_idempotency"], WITH_CONFLICT);
    expect(ds.result.filter((r) => r.request_id === "S1").map((r) => [r.result_id, r.value])).toEqual([["R1", 5.1]]);
    expect(col(ds.source_event, "source_event_id")).toEqual(["AN-1/S1/1/1/glucose", "AN-1/S2/1/1/glucose", "AN-1/S2/2/1/glucose", "AN-1/S3/1/1/glucose"]);
    expect(ds.validation_finding).toEqual([]); // VR-008b is a rule of S2b: the recorder only keeps the row
    expect(ds.ingest_conflict).toEqual([
      { source_system: "AN-1", source_event_id: "AN-1/S1/1/1/glucose", idempotency_key: "AN-1|AN-1/S1/1/1/glucose|v1", received_at: 2000, request_id: "S1", analyte: "glucose", run_id: "S1/1/1", value: 5.9, measured_at: 2000 },
    ]);
  });
  it("Given the flag off When the S1 result is replayed Then S1 is counted twice and no key, log or conflict list exists", () => {
    const ds = rec([], WITH_REPLAY);
    expect(col(ds.result, "request_id")).toEqual(["S1", "S1", "S2", "S3"]);
    expect(ds.result.filter((r) => r.request_id === "S1").map((r) => r.value)).toEqual([5.1, 5.1]);
    expect(ds.source_event).toEqual([]);
    expect(ds.validation_finding).toEqual([]);
  });
  it("Given the flag off When the S1 result comes again with the value 5.9 Then both values are rows of the dataset and the conflict is not seen", () => {
    const ds = rec([], WITH_CONFLICT);
    expect(ds.result.filter((r) => r.request_id === "S1").map((r) => r.value)).toEqual([5.1, 5.9]);
    expect(ds.ingest_conflict).toEqual([]);
  });
});

describe("a draw refused by the volume budget (spec section 2.2): planned, never drawn", () => {
  it("Given system_issued_id on (the plan issues the label) When S4 is skipped Then a sample row with state skipped and its planned_at is recorded, with no sampled_at, operator, label or result", () => {
    const ds = record({ events: WITH_SKIP, sensors: SENSORS }, arch("system_issued_id", "two_clocks", "write_time_keys", "audit_trail"));
    expect(col(ds.sample, "sample_id")).toEqual(["S1", "S2", "S3", "S4"]);
    expect(ds.sample[3]).toEqual({
      sample_id: "S4", unit_id: "U2", batch_id: "B-U2", keys_fixed_at_write: true, state: "skipped", sampled_at: null, planned_at: 11000, operator_id: null, qualification_id: null, label_method: null,
    });
    expect(col(ds.sample.slice(0, 3), "state")).toEqual([null, null, null]);
    expect(ds.result.some((r) => r.request_id === "S4")).toBe(false);
    expect(ds.run.some((r) => r.request_id === "S4")).toBe(false);
  });
  it("Given system_issued_id off (no plan in the system) When S4 is skipped Then nobody wrote anything and there is no row, whatever the other flags are", () => {
    const ds = record({ events: WITH_SKIP, sensors: SENSORS }, arch("two_clocks", "write_time_keys", "audit_trail", "ingest_idempotency"));
    expect(col(ds.sample, "sample_id")).toEqual(["S1", "S2", "S3"]);
  });
});

describe("audit_trail: who, when and what changed", () => {
  it("Given the flag on When recorded Then the sampler is attributed and the rerun of S2 is an audit event with the old and the new value", () => {
    const ds = rec(["audit_trail", "append_only_versions"]);
    expect(col(ds.sample, "operator_id")).toEqual(["OP-1", "OP-2", "OP-1"]);
    expect(ds.audit_event).toEqual([{ audit_id: "A1", request_id: "S2", analyte: "glucose", at: 9000, old_value: 3.2, new_value: 3.4, old_version: 1, new_version: 2 }]);
  });
  it("Given the flag on and append_only_versions off Then the overwrite is still visible in the audit trail, with the lost value", () => {
    const ds = rec(["audit_trail"]);
    expect(ds.result.some((r) => r.value === 3.2)).toBe(false);
    expect(ds.audit_event.map((a) => [a.request_id, a.old_value, a.new_value])).toEqual([["S2", 3.2, 3.4]]);
  });
  it("Given the flag off When recorded Then the operator is absent and there is no history", () => {
    const ds = rec(["append_only_versions"]);
    expect(col(ds.sample, "operator_id")).toEqual([null, null, null]);
    expect(ds.audit_event).toEqual([]);
  });
});

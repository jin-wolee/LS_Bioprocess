import { beforeAll, describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import { controllerEntry } from "../../src/ingest/controller_entry.ts";
import { parseControllerFile } from "../../src/ingest/controller_parse.ts";
import { newStore } from "../../src/ingest/store.ts";
import type { HistorianRow } from "../../src/record/types.ts";
import { readTag } from "../../src/record/tag_read.ts";
import { logTags } from "../../src/raw/controller_log.ts";
import type { TagSeries } from "../../src/raw/controller_types.ts";
import { BANNER } from "../../src/raw/types.ts";
import { ANCHOR, controllerCases, flatAlarms, flatHistorian, flatPhases, profileOf, runControllerCase } from "../support/controller_fixtures.ts";
import type { ControllerParsed } from "../support/controller_fixtures.ts";

// Step 7, one Given-When-Then per controller quirk, named after its id (spec section 2.4.3): RQ9 deadband and maximum-interval logging, RQ10 alarm state changes, RQ11 batch
// phase transitions. The inputs are the hand-made fixtures of tests/fixtures/raw/ctrl_neutral and ctrl_bench; the values below are typed by hand from the design (A172 for the
// worked example, data_model 16.4 and 16.5 for the alarm and phase models). Every alarm id, user, severity and instant is test-only: the production run emits no alarm log, because
// no acknowledge or return-to-normal time has a ledger entry (spec 2.4.8). Instants are seconds of the scenario with day 0 the synthetic Monday 2030-01-07: 09:00:00 is 32400.

const parsed = (family: string, name: string, pattern: RegExp): ControllerParsed => {
  const c = controllerCases(family, name).find((x) => pattern.test(x.name));
  if (!c) throw new Error(`no case ${String(pattern)} in ${family}/${name}`);
  return runControllerCase(family, name, c);
};
const rowsOf = (p: ControllerParsed): Pick<HistorianRow, "ts" | "value" | "ingested_at">[] => p.last.historian.map((r) => ({ ts: r.payload.ts, value: r.payload.value, ingested_at: r.envelope.received_at }));

describe("RQ9 deadband and maximum-interval logging", () => {
  // test-only values: the worked example of A172 (a 1 rpm deadband and a 15 s maximum interval) on an agitation PV sampled every 5 s
  const AGITATION: TagSeries = { unit: "U01", signal: "agitation", role: "PV", t0_s: 0, cadence_s: 5, n: 7, at: (j) => [100.0, 100.4, 101.2, 101.3, 101.3, 101.3, 101.3][j] as number };
  let file: ControllerParsed;
  let bench: ControllerParsed;
  beforeAll(() => {
    file = parsed("ctrl_neutral", "deadband", /three logged rows load as received/);
    bench = parsed("ctrl_bench", "process", /pH\.PV \(U01\) loads as the canonical tag/);
  });
  it("Given an agitation PV of 100.0, 100.4, 101.2 and 101.3 rpm every 5 s, a 1 rpm deadband and a 15 s maximum interval (test-only) When the controller logs it Then it writes (0 s, 100.0), (10 s, 101.2) and (25 s, 101.3)", () => {
    expect(logTags([AGITATION], { deadband: () => 1, max_interval_s: 15 }).map((r) => [r.ts, r.value])).toEqual([[0, 100.0], [10, 101.2], [25, 101.3]]);
  });
  it("Given the value 101.0 after 100.0 and a deadband of exactly 1 When logged Then the move counts at equality: the row is written", () => {
    const s: TagSeries = { ...AGITATION, n: 4, at: (j) => [100.0, 100.5, 101.0, 101.0][j] as number };
    expect(logTags([s], { deadband: () => 1, max_interval_s: 1000 }).map((r) => [r.ts, r.value])).toEqual([[0, 100.0], [10, 101.0]]);
  });
  it("Given a flat tag and a maximum interval of 15 s When logged Then a row is written each time the interval is reached at equality, and none between", () => {
    const s: TagSeries = { ...AGITATION, n: 9, at: () => 100 };
    expect(logTags([s], { deadband: () => 1, max_interval_s: 15 }).map((r) => r.ts)).toEqual([0, 15, 30]);
  });
  it("Given the three rows as a file When parsed Then three historian values load under the canonical tag, stamped with the file's received_at as ingested_at", () => {
    expect(flatHistorian(file.last)).toMatchObject([
      { tag: "U01.agitation.PV", ts: 0, value: 100.0, ingested_at: 86400, state: "loaded" },
      { tag: "U01.agitation.PV", ts: 10, value: 101.2, ingested_at: 86400, state: "loaded" },
      { tag: "U01.agitation.PV", ts: 25, value: 101.3, ingested_at: 86400, state: "loaded" },
    ]);
  });
  it("Given the loaded rows When the value is read at 20 s Then it is the last row at or before it, 101.2 with an age of 10 s", () => {
    expect(readTag(rowsOf(file), 20)).toEqual({ value: 101.2, ts: 10, age_s: 10 });
  });
  it("Given the same rows When the value is read at 9 s Then it is 100.0 with an age of 9 s: nothing is interpolated toward 101.2", () => {
    expect(readTag(rowsOf(file), 9)).toEqual({ value: 100.0, ts: 0, age_s: 9 });
  });
  it("Given a read before the first row Then there is no value", () => {
    expect(readTag(rowsOf(file), -1)).toBeUndefined();
  });
  it("Given a row that arrived after the decision time When the value is read as of that time Then the late row is invisible to it and an earlier row is read", () => {
    const rows = [{ ts: 0, value: 100.0, ingested_at: 0 }, { ts: 10, value: 101.2, ingested_at: 86400 }];
    expect(readTag(rows, 20, 3600)).toEqual({ value: 100.0, ts: 0, age_s: 20 });
    expect(readTag(rows, 20, 86400)).toEqual({ value: 101.2, ts: 10, age_s: 10 });
  });
  it("Given the same file received twice When ingest_idempotency is on Then the second copy is a no-op (VR-008) and loads nothing", () => {
    const again = parsed("ctrl_neutral", "deadband", /received twice is a no-op/);
    expect(again.last.historian).toEqual([]);
    expect(again.last.raw_records.map((r) => [r.state, r.rule_id])).toEqual([["no_op", "VR-008"], ["no_op", "VR-008"], ["no_op", "VR-008"]]);
    expect(again.last.findings.filter((f) => f.rule === "VR-008" && f.action === "no-op").length).toBe(3);
  });
  it("Given the same file twice When ingest_idempotency is off Then every copy loads: the rows double count", () => {
    const off = parsed("ctrl_neutral", "deadband", /idempotency off every copy/);
    expect(off.outputs.map((o) => o.historian.length)).toEqual([3, 3]);
  });
  it("Given the same canonical tag from both families When the second family's variable pH.PV (U01) is parsed Then it lands under U01.pH.PV, the form the first family writes with its unit in a column", () => {
    expect(flatHistorian(bench.last).map((r) => r.tag)).toEqual(["U01.pH.PV", "U01.DO.PV", "U02.temperature.SP"]);
  });
  it("Given a tag cell with a signal but no role (test-only text) When parsed Then the line is rejected (VR-023, unknown_name) with exactly one parse_error (K20), and the line before it loads", () => {
    const text = `${BANNER}\nTimestamp,Unit,Tag,Value,Quality\n2030-01-07T00:00:00+00:00,U01,agitation.PV,100.0,good\n2030-01-07T00:00:10+00:00,U01,agitation,101.2,good\n`;
    const out = parseControllerFile(text, { entry: controllerEntry(profileOf("ctrl_neutral"), { controller: "CTRL-1" }), file_name: "ctrl_tags_CTRL-1_2030-01-07.csv", raw_file_id: "RF1", received_at: 86400, anchor_epoch_s: anchorEpoch(ANCHOR), flags: { ingest_idempotency: true }, store: newStore() });
    expect(out.raw_records.map((r) => [r.line_no, r.state, r.rule_id])).toEqual([[3, "loaded", null], [4, "rejected", "VR-023"]]);
    expect(out.parse_errors.map((e) => [e.line_no, e.code, e.rule_id])).toEqual([[4, "unknown_name", "VR-023"]]);
    expect(out.historian.length).toBe(1);
  });
  it("Given the same tag value with a changed value under the same stamp When parsed after the first Then the copy is quarantined (VR-008b) and the original stays", () => {
    const entry = controllerEntry(profileOf("ctrl_neutral"), { controller: "CTRL-1" });
    const store = newStore();
    const ctx = (id: string) => ({ entry, file_name: "ctrl_tags_CTRL-1_2030-01-07.csv", raw_file_id: id, received_at: 86400, anchor_epoch_s: anchorEpoch(ANCHOR), flags: { ingest_idempotency: true }, store });
    const row = (v: string) => `${BANNER}\nTimestamp,Unit,Tag,Value,Quality\n2030-01-07T00:00:10+00:00,U01,agitation.PV,${v},good\n`;
    parseControllerFile(row("101.2"), ctx("RF1"));
    const second = parseControllerFile(row("101.9"), ctx("RF2"));
    expect(second.raw_records.map((r) => [r.state, r.rule_id])).toEqual([["quarantined", "VR-008b"]]);
    expect(second.historian).toEqual([]);
  });
});

describe("RQ10 alarm state changes", () => {
  let ack: ControllerParsed;
  let illegal: ControllerParsed;
  let mid: ControllerParsed;
  let bench: ControllerParsed;
  beforeAll(() => {
    ack = parsed("ctrl_neutral", "alarm_ack", /three alarm_event rows/);
    illegal = parsed("ctrl_neutral", "alarm_illegal", /acknowledged straight to unacknowledged is held/);
    mid = parsed("ctrl_neutral", "alarm_ack", /starts mid-instance/);
    bench = parsed("ctrl_bench", "alarm", /acknowledging user/);
  });
  it("Given an alarm that goes unacknowledged, acknowledged and normal (test-only) When the log is parsed Then there are three alarm_event rows, one per transition", () => {
    expect(flatAlarms(ack.last).map((r) => [r.from_state, r.to_state, r.ts])).toEqual([["normal", "unacknowledged", 32400], ["unacknowledged", "acknowledged", 32700], ["acknowledged", "normal", 33600]]);
  });
  it("Given the same log Then acknowledge and return-to-normal are separate events: the rows are not merged and each keeps its own stamp", () => {
    expect(ack.last.alarms.length).toBe(ack.last.raw_records.length);
    expect(new Set(ack.last.alarms.map((r) => r.payload.ts)).size).toBe(3);
  });
  it("Given the first family's rows Then the alarm is watched on the canonical tag U01.pH.PV at severity 500 and no acknowledging user is recorded", () => {
    expect(flatAlarms(ack.last)[0]).toMatchObject({ alarm_id: "AL-1", unit_id: "U01", tag: "U01.pH.PV", severity: 500, actor: null });
  });
  it("Given acknowledged straight back to unacknowledged When parsed Then the row is held (VR-025): stored, not loaded, with a finding that targets it", () => {
    expect(illegal.last.raw_records.map((r) => [r.line_no, r.state, r.rule_id])).toEqual([[3, "loaded", null], [4, "loaded", null], [5, "held", "VR-025"]]);
    expect(illegal.last.findings.filter((f) => f.action === "hold")).toEqual([{ rule: "VR-025", severity: "warning", action: "hold", target: "alarm_event:RF1:5", status: "open" }]);
    expect(flatAlarms(illegal.last).map((r) => r.state)).toEqual(["loaded", "loaded", "held"]);
  });
  it("Given a hold Then the value of the row is untouched: a rule changes a state and never a value", () => {
    expect(flatAlarms(illegal.last)[2]).toMatchObject({ from_state: "acknowledged", to_state: "unacknowledged", ts: 33000 });
  });
  it("Given a log whose first row is acknowledged to normal When parsed Then it is accepted: the log starts mid-instance and there is no earlier record to contradict", () => {
    expect(mid.last.raw_records.map((r) => [r.state, r.rule_id])).toEqual([["loaded", null]]);
  });
  it("Given the second family's alarm log Then the acknowledge row names the acknowledging user, and the other two rows name none", () => {
    expect(flatAlarms(bench.last).map((r) => r.actor)).toEqual([null, "op1", null]);
  });
  it("Given the second family's alarm log, which has no From column Then from_state is the previous state of the instance, and normal for its first row", () => {
    expect(flatAlarms(bench.last).map((r) => [r.from_state, r.to_state])).toEqual([["normal", "unacknowledged"], ["unacknowledged", "acknowledged"], ["acknowledged", "normal"]]);
  });
});

describe("RQ11 batch phase transitions", () => {
  let hold: ControllerParsed;
  let illegal: ControllerParsed;
  let steps: ControllerParsed;
  let stepsIllegal: ControllerParsed;
  beforeAll(() => {
    hold = parsed("ctrl_neutral", "phase_hold", /five batch_phase_record rows/);
    illegal = parsed("ctrl_neutral", "phase_illegal", /held straight to running is held/);
    steps = parsed("ctrl_bench", "steps", /recipe steps running, holding/);
    stepsIllegal = parsed("ctrl_bench", "steps_illegal", /bench family too/);
  });
  it("Given a phase that runs, holds, is held, restarts and runs again (test-only) When the log is parsed Then five batch_phase_record rows load", () => {
    expect(flatPhases(hold.last).map((r) => [r.to_state, r.state])).toEqual([["running", "loaded"], ["holding", "loaded"], ["held", "loaded"], ["restarting", "loaded"], ["running", "loaded"]]);
  });
  it("Given the same rows Then each carries the ISA-88 hierarchy as ids: recipe, procedure, unit procedure, operation and phase", () => {
    expect(flatPhases(hold.last)[0]).toMatchObject({ batch_id: "B-U01", recipe_id: "REC-CULTURE", procedure: "culture", unit_procedure: "culture_run", operation: "culture_control", phase: "before_shift" });
  });
  it("Given a phase that goes from held straight to running When parsed Then that row is held (VR-025), the three before it load, and so does the row after it", () => {
    expect(illegal.last.raw_records.map((r) => [r.line_no, r.state])).toEqual([[3, "loaded"], [4, "loaded"], [5, "loaded"], [6, "held"], [7, "loaded"]]);
    expect(illegal.last.findings.filter((f) => f.action === "hold").map((f) => [f.rule, f.target])).toEqual([["VR-025", "batch_phase_record:RF1:6"]]);
  });
  it("Given a held row followed by held to restarting Then the next row loads: a held row does not advance the instance, so the row after it is judged against the last accepted state (held)", () => {
    expect(flatPhases(illegal.last).map((r) => [r.from_state, r.to_state, r.state])).toEqual([["idle", "running", "loaded"], ["running", "holding", "loaded"], ["holding", "held", "loaded"], ["held", "running", "held"], ["held", "restarting", "loaded"]]);
  });
  it("Given the second family's recipe steps, which have no From column Then from_state is the previous state of the instance, idle for its first row, and batch, procedure, unit procedure and operation are null", () => {
    expect(flatPhases(steps.last).map((r) => [r.from_state, r.to_state])).toEqual([["idle", "running"], ["running", "holding"], ["holding", "held"], ["held", "restarting"], ["restarting", "running"]]);
    expect(flatPhases(steps.last)[0]).toMatchObject({ batch_id: null, procedure: null, unit_procedure: null, operation: null, unit_id: "U01", phase: "before_shift" });
  });
  it("Given held straight to running in the second family's steps Then it is held (VR-025) there too", () => {
    expect(stepsIllegal.last.raw_records.find((r) => r.line_no === 6)).toMatchObject({ state: "held", rule_id: "VR-025" });
  });
});

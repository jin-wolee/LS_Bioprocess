import { beforeAll, describe, expect, it } from "vitest";
import { rawMetrics, observationsOf } from "../../src/evaluate/raw_metrics.ts";
import type { ParseOutput } from "../../src/ingest/canonical.ts";
import type { KeyRow } from "../../src/raw/key.ts";
import { casesOf, flat, runCase } from "../support/raw_fixtures.ts";
import type { Parsed } from "../support/raw_fixtures.ts";

// Step 6, one Given-When-Then per raw quirk, named after its id (spec section 2.4.3). The inputs are the hand-made fixtures of tests/fixtures/raw; the values below are typed
// by hand from the dialect description (test-only values: the zones, the pinned orders and the unit text mg/dL are said so where they appear). Instants are seconds of the
// scenario with day 0 the synthetic Monday 2030-01-07: 09:10:00 is 33000.

const parsed = (dialect: string, name: string, pattern: RegExp): Parsed => {
  const c = casesOf(dialect, name).find((x) => pattern.test(x.name));
  if (!c) throw new Error(`no case ${String(pattern)} in ${dialect}/${name}`);
  return runCase(dialect, name, c);
};
const at = (p: Parsed, line: number, analyte: string): Record<string, unknown> => {
  const r = p.last.records.find((x) => x.envelope.raw_ref.line_no === line && x.payload.analyte === analyte);
  if (!r) throw new Error(`no ${analyte} record at line ${line}`);
  return flat(r);
};
const rawRecord = (p: Parsed, line: number) => p.last.raw_records.find((r) => r.line_no === line);

describe("RQ1 stamp with no zone", () => {
  let zoned: Parsed;
  let none: Parsed;
  beforeAll(() => {
    zoned = parsed("allinone_csv", "clean", /RQ1 a stamp with no zone/);
    none = parsed("allinone_csv", "clean", /RQ1 an entry without a zone/);
  });
  it("Given the stamp 09:10:00 with no zone and an entry zone of +2 h (test-only) When the file is parsed Then the UTC instant is 07:10:00, two hours earlier", () => {
    expect(at(zoned, 3, "glucose").measured_at).toBe(25800);
  });
  it("Given the same entry Then the source zone of 7200 s is stored beside the instant (K14)", () => {
    expect(at(zoned, 3, "glucose").source_zone_s).toBe(7200);
  });
  it("Given an entry that has no zone When the file is parsed Then the stamp is unresolved: the row is stored and quarantined (VR-024) and no instant is stored", () => {
    expect([at(none, 3, "glucose").state, at(none, 3, "glucose").measured_at, at(none, 3, "glucose").source_zone_s]).toEqual(["quarantined", null, null]);
    expect(rawRecord(none, 3)).toMatchObject({ state: "quarantined", rule_id: "VR-024" });
  });
});

describe("RQ2 date order and clock style", () => {
  let pinned: Parsed;
  let open: Parsed;
  let wrong: Parsed;
  let twelve: Parsed;
  beforeAll(() => {
    pinned = parsed("allinone_csv", "order_day_first", /row with day 13 pins/);
    open = parsed("allinone_csv", "order_ambiguous", /no day above 12/);
    wrong = parsed("allinone_csv", "order_ambiguous", /wrong order/);
    twelve = parsed("allinone_csv", "clean", /12 h clock/);
  });
  it("Given an entry whose order is unknown and a file with the days 13 and 08 When parsed Then the day 13 pins day-first for every row: 08-01 is January 8 (119670 s)", () => {
    expect([at(pinned, 3, "glucose").measured_at, at(pinned, 4, "glucose").measured_at]).toEqual([551400, 119670]);
  });
  it("Given an unknown order and no day above 12 When parsed Then every row is unresolved and quarantined (VR-024)", () => {
    expect([3, 4].map((l) => rawRecord(open, l))).toMatchObject([{ state: "quarantined", rule_id: "VR-024" }, { state: "quarantined", rule_id: "VR-024" }]);
    expect(open.last.records.map((r) => r.payload.measured_at)).toEqual([null, null]);
  });
  it("Given an entry pinned to the wrong order (month-first, test-only) When parsed Then valid but wrong instants load: May 1 and August 1", () => {
    expect(wrong.last.records.map((r) => [r.state, r.payload.measured_at])).toEqual([["loaded", 9882600], ["loaded", 17831670]]);
  });
  it("Given those loaded rows and the intended instants January 5 (-139800 s) and January 8 (119670 s) in the key Then the key counts the first as resolved wrongly and the second (same in both orders) as correct", () => {
    const key = (line: number, intended_s: number): KeyRow => ({ line, sample_id: "S", intended_s, resolution_s: 1, ambiguous: true, repeat: false, quirks: ["RQ2"], unreadable: false });
    const m = rawMetrics(observationsOf([{ file_name: "order_ambiguous.csv", rows: [key(3, -139800), key(4, 119670)] }], [wrong.last as ParseOutput]));
    // line 4 reads August 1 under the wrong order, so it is wrong as well: both ambiguous rows resolved wrongly
    expect(m.ambiguous).toEqual({ status: "reported", den: 2, correct: 0, wrong: 2, unresolved: 0 });
  });
  it("Given a 12 h clock believed without a day-part marker (test-only) Then the stamp is unresolved and quarantined", () => {
    expect(at(twelve, 3, "glucose")).toMatchObject({ state: "quarantined", measured_at: null });
  });
});

describe("RQ3 stamp truncated to the minute", () => {
  let p: Parsed;
  beforeAll(() => { p = parsed("counter_csv", "same_minute", /RQ3/); });
  it("Given a counter stamp 09:14 When parsed Then measured_at is 33240 and time_resolution_s is 60", () => {
    expect([at(p, 3, "vcd").measured_at, at(p, 3, "vcd").time_resolution_s]).toEqual([33240, 60]);
  });
  it("Given two rows in the same minute Then both load with that instant and keep the file order", () => {
    expect(p.last.records.map((r) => [r.envelope.raw_ref.line_no, r.payload.sample_id, r.payload.analyte, r.payload.measured_at])).toEqual([
      [3, "U01-D01-1", "vcd", 33240], [3, "U01-D01-1", "viability", 33240], [4, "U02-D01-1", "vcd", 33240], [4, "U02-D01-1", "viability", 33240],
    ]);
  });
});

describe("RQ4 repeated rows", () => {
  it("Given the clean file ingested twice When ingest_idempotency is on Then the second pass gives no new rows, every line is a no-op and each result is a VR-008 information", () => {
    const twice = runCase("allinone_csv", "clean", { ...casesOf("allinone_csv", "clean")[0]!, after: ["clean"] });
    expect(twice.last.records).toEqual([]);
    expect(twice.last.raw_records.map((r) => [r.state, r.rule_id])).toEqual([["no_op", "VR-008"], ["no_op", "VR-008"], ["no_op", "VR-008"]]);
    expect(twice.last.findings.filter((f) => f.rule === "VR-008").length).toBe(6);
  });
  it("Given the same two passes When ingest_idempotency is off Then the second pass loads the rows again (double count)", () => {
    const base = casesOf("allinone_csv", "clean")[0]!;
    const off = runCase("allinone_csv", "clean", { ...base, after: ["clean"], flags: { ingest_idempotency: false } });
    expect(off.last.records.length).toBe(6);
    expect(off.outputs[0]?.records.length).toBe(6);
  });
  it("Given an append-mode counter file that repeats three earlier rows When parsed after them Then the three are no-ops and the new row loads", () => {
    const p = parsed("counter_csv", "append", /append-mode/);
    expect(p.last.raw_records.map((r) => r.state)).toEqual(["no_op", "no_op", "no_op", "loaded"]);
  });
  it("Given an overlapping export of the all-in-one analyzer When parsed after the first Then the repeated row is a no-op and the new row loads", () => {
    expect(parsed("allinone_csv", "overlap", /overlapping/).last.raw_records.map((r) => r.state)).toEqual(["no_op", "loaded"]);
  });
  it("Given the same key with a changed value (glucose 4.9 for 4.2) Then the incoming row is quarantined (VR-008b), not loaded, and the original stays", () => {
    const p = parsed("allinone_csv", "changed_value", /same key and a changed value/);
    expect(rawRecord(p, 3)).toMatchObject({ state: "quarantined", rule_id: "VR-008b" });
    expect(p.last.conflicts.map((c) => [c.analyte, c.value])).toEqual([["glucose", 4.9]]);
    expect(p.store.keys.get("AN-1|AN-1|2030-01-07 09:10:00|U01-D01-1|glucose|v1")?.content.startsWith("4.2|")).toBe(true);
  });
});

describe("RQ5 reanalysis", () => {
  it("Given a row with the new row time 09:50 and the sample time 09:10 after version 1 When parsed Then it is version 2 with the original measured_at (33000) and supersedes version 1", () => {
    const p = parsed("allinone_csv", "reanalysis", /after version 1/);
    expect(at(p, 3, "glucose")).toMatchObject({ version: 2, measured_at: 33000, supersedes: "RF1:3:glucose", event_time: "2030-01-07 09:50:00", state: "loaded" });
  });
  it("Given the same row and no version 1 in the store Then it is quarantined as VR-019", () => {
    const p = parsed("allinone_csv", "reanalysis", /without version 1/);
    expect(rawRecord(p, 3)).toMatchObject({ state: "quarantined", rule_id: "VR-019" });
  });
  it("Given append_only_versions off Then the reanalysis overwrites: version 1 and no supersedes link", () => {
    expect(at(parsed("allinone_csv", "reanalysis", /off the reanalysis overwrites/), 3, "glucose")).toMatchObject({ version: 1, supersedes: null });
  });
});

describe("RQ6 range and error marking", () => {
  it("Given a blank glucose cell with the note 'Glucose Analytical Range High' When parsed Then the value is null and range_flag is above_analytical", () => {
    expect(at(parsed("allinone_csv", "range_note", /null value/), 3, "glucose")).toMatchObject({ value: null, range_flag: "above_analytical", state: "loaded" });
  });
  it("Given a blank glucose cell for a required analyte and no note Then the row is held (VR-026)", () => {
    const p = parsed("allinone_csv", "blank_no_note", /held/);
    expect(rawRecord(p, 3)).toMatchObject({ state: "held", rule_id: "VR-026" });
    expect(at(p, 3, "glucose")).toMatchObject({ value: null, range_flag: null, state: "held" });
  });
});

describe("RQ7 units row absent or different", () => {
  it("Given a file without a units row When parsed Then the unit comes from the entry (g/L), the original unit is null", () => {
    expect(at(parsed("allinone_csv", "clean", /without a units row/), 3, "glucose")).toMatchObject({ unit_original: null, unit_ucum: "g/L" });
  });
  it("Given a units row that gives glucose in mmol/L Then the unit maps to another dimension and the row is quarantined (VR-005), the value unchanged", () => {
    const p = parsed("allinone_csv", "units_row_mmol", /another dimension/);
    expect(rawRecord(p, 4)).toMatchObject({ state: "quarantined", rule_id: "VR-005" });
    expect(at(p, 4, "glucose")).toMatchObject({ value: 4.2, unit_ucum: "mmol/L" });
  });
  it("Given a unit text of the same dimension (mg/dL, test-only) and a plausible value Then the row loads, the invisible case", () => {
    expect(rawRecord(parsed("allinone_csv", "units_row_other_unit", /invisible/), 4)).toMatchObject({ state: "loaded", rule_id: null });
  });
});

describe("RQ8 template-defined columns", () => {
  it("Given two templates with the columns in another order When parsed Then the canonical output is the same", () => {
    const a = parsed("cds_table", "clean", /clean file/).last.records.map((r) => flat(r));
    const b = parsed("cds_table", "template_reordered", /another order/).last.records.map((r) => flat(r));
    expect(b).toEqual(a);
  });
  it("Given a file with a column the template map does not know Then it is an information finding and the records are unchanged", () => {
    const p = parsed("cds_table", "unknown_column", /unknown column/);
    expect(p.last.findings).toEqual([{ rule: "VR-023", severity: "info", action: "no-op", target: "file:RF1", status: "resolved" }]);
    expect(p.last.records.length).toBe(3);
  });
  it("Given a file with no stamp column Then the file is rejected (VR-023) with one required_column_missing and nothing loads", () => {
    const p = parsed("cds_table", "missing_required", /missing required/);
    expect([p.last.raw_file.state, p.last.records.length, p.last.parse_errors.map((e) => [e.code, e.column_role, e.line_no, e.rule_id])]).toEqual(["rejected", 0, [["required_column_missing", "stamp", null, "VR-023"]]]);
  });
});

import { describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import { emitExport } from "../../src/raw/emit.ts";
import type { ExportInput } from "../../src/raw/emit.ts";
import { analysisRows } from "../../src/raw/rows.ts";
import { BANNER, deviceDefaults } from "../../src/raw/types.ts";
import type { AnalysisRow } from "../../src/raw/types.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { ANCHOR, dialectOf, textOf } from "../support/raw_fixtures.ts";

// Step 5: the generic emitter. Hand-typed streams (test-only values; every time is an integer second, 09:10:00 is 33000) are rendered and the text is compared with the
// hand-made fixture files, which were typed from the dialect description and not produced by the emitter.

const result = (t: number, request: string, analyte: string, value: number, analyzer = "AN-1"): ObservableEvent => ({ type: "result_measured", t, request_id: request, attempt: 1, visit: 1, analyzer, analyte, value });
const dilution = (request: string, factor: number): ObservableEvent => ({ type: "dilution_applied", t: 0, request_id: request, attempt: 1, visit: 1, dilution_factor: factor });
const S = ["U01-D01-1", "U02-D01-1", "U03-D01-1"] as const;

const AIO = [result(33000, S[0], "glucose", 4.2), result(33000, S[0], "lactate", 0.8), result(33270, S[1], "glucose", 5.5), result(33270, S[1], "lactate", 1.1), result(33540, S[2], "glucose", 9.3), result(33540, S[2], "lactate", 1.9), dilution(S[2], 2)];
const COUNTER = [result(33000, S[0], "vcd", 12.5), result(33000, S[0], "viability", 97), result(33240, S[1], "vcd", 10.1), result(33240, S[1], "viability", 96), result(33540, S[2], "vcd", 22.8), result(33540, S[2], "viability", 95), dilution(S[2], 2)];
const CDS = [result(32940, S[0], "titer", 1.2, "HP-1"), result(33180, S[1], "titer", 1.5, "HP-1"), result(33420, S[2], "titer", 1.1, "HP-1")];

const rowsOf = (dialect: string, events: ObservableEvent[], analytes: string[], run_s: number): AnalysisRow[] =>
  analysisRows(events, { dialect: dialectOf(dialect), visit_dialects: [dialect], visit_analytes: [analytes], visit_run_s: [run_s], default_dilution: dialect === "cds_table" ? null : 1 });

const exportOf = (dialect: string, rows: AnalysisRow[], over: Partial<ExportInput> = {}, instrument = "AN-1") =>
  emitExport({ dialect: dialectOf(dialect), device: deviceDefaults(dialectOf(dialect), instrument), anchor_epoch_s: anchorEpoch(ANCHOR), rows, previous: [], export_at: 36000, plan: { seed: 7 }, ...over });

describe("Step 5 emitter: the text equals the hand-made fixture of each dialect", () => {
  it("Given three analyses on the all-in-one dialect When the export is written Then the file is the clean fixture, line for line", () => {
    expect(exportOf("allinone_csv", rowsOf("allinone_csv", AIO, ["glucose", "lactate"], 270)).files[0]?.text).toBe(textOf("allinone_csv", "clean"));
  });
  it("Given three analyses on the counter dialect When the export is written Then the file is the clean fixture (month, day, year to the minute, units in the header)", () => {
    expect(exportOf("counter_csv", rowsOf("counter_csv", COUNTER, ["vcd", "viability"], 130)).files[0]?.text).toBe(textOf("counter_csv", "clean"));
  });
  it("Given three injections on the data-system dialect When the export is written Then the file is the clean fixture; the stamp is the start, the run time (60 s, test-only) before the result", () => {
    expect(exportOf("cds_table", rowsOf("cds_table", CDS, ["titer"], 60), {}, "HP-1").files[0]?.text).toBe(textOf("cds_table", "clean"));
  });
  it("Given a device whose template lists the columns in another order (RQ8) When the export is written Then the file is the reordered fixture", () => {
    const device = { ...deviceDefaults(dialectOf("cds_table"), "HP-1"), template: ["sample_id", "analyte:titer", "stamp", "result_id", "injection_id"] };
    expect(exportOf("cds_table", rowsOf("cds_table", CDS, ["titer"], 60), { device }, "HP-1").files[0]?.text).toBe(textOf("cds_table", "template_reordered"));
  });
});

describe("Step 5 emitter: banner, determinism, file name, key rows", () => {
  const all = [["allinone_csv", AIO, ["glucose", "lactate"], 270], ["counter_csv", COUNTER, ["vcd", "viability"], 130], ["cds_table", CDS, ["titer"], 60]] as const;
  it.each(all)("%s: the banner is the first line of the emitted file", (dialect, events, analytes, run) => {
    const f = exportOf(dialect, rowsOf(dialect, [...events], [...analytes], run), {}, dialect === "cds_table" ? "HP-1" : "AN-1").files[0];
    expect(f?.text.split("\n")[0]).toBe(BANNER);
    expect(f?.text.split("\n")[0]).toBe("synthetic, modeled on public documentation; not a real instrument file");
  });
  it("Given the same inputs When the export is written twice Then the files are byte-identical", () => {
    const rows = rowsOf("allinone_csv", AIO, ["glucose", "lactate"], 270);
    expect(exportOf("allinone_csv", rows)).toEqual(exportOf("allinone_csv", rows));
  });
  it("Given an export at 10:00:00 Then the file name is the vendor-neutral prefix, the instrument and the export time", () => {
    expect(exportOf("allinone_csv", rowsOf("allinone_csv", AIO, ["glucose", "lactate"], 270)).files[0]?.file_name).toBe("analysis_export_AN-1_2030-01-07_100000.csv");
    expect(exportOf("counter_csv", rowsOf("counter_csv", COUNTER, ["vcd", "viability"], 130)).files[0]?.file_name).toBe("counter_export_AN-1_2030-01-07_100000.csv");
  });
  it("Given the all-in-one export Then the key lists each written row at its physical line with the intended instant, and none is ambiguous (year first)", () => {
    expect(exportOf("allinone_csv", rowsOf("allinone_csv", AIO, ["glucose", "lactate"], 270)).files[0]?.key_rows).toEqual([
      { line: 3, sample_id: S[0], intended_s: 33000, resolution_s: 1, ambiguous: false, repeat: false, quirks: [], unreadable: false },
      { line: 4, sample_id: S[1], intended_s: 33270, resolution_s: 1, ambiguous: false, repeat: false, quirks: [], unreadable: false },
      { line: 5, sample_id: S[2], intended_s: 33540, resolution_s: 1, ambiguous: false, repeat: false, quirks: [], unreadable: false },
    ]);
  });
  it("Given the counter export (month first, year last, day 7 and month 1) Then every row is ambiguous (RQ2) and the stamps lose no second (RQ3 not realised)", () => {
    const keys = exportOf("counter_csv", rowsOf("counter_csv", COUNTER, ["vcd", "viability"], 130)).files[0]?.key_rows ?? [];
    expect(keys.map((k) => [k.ambiguous, k.quirks])).toEqual([[true, ["RQ2"]], [true, ["RQ2"]], [true, ["RQ2"]]]);
  });
  it("Given a row at 09:14:30 on the counter dialect Then the minute-truncated stamp realises RQ3 on that row", () => {
    const rows = rowsOf("counter_csv", [result(33270, S[1], "vcd", 10.1)], ["vcd"], 130);
    expect(exportOf("counter_csv", rows).files[0]?.key_rows[0]?.quirks).toEqual(["RQ2", "RQ3"]);
  });
});

describe("Step 5 emitter: keyed quirk opportunities (purpose raw:RQ4) and the quirks it writes", () => {
  const rows = rowsOf("allinone_csv", AIO, ["glucose", "lactate"], 270);
  it("Given three rows and a previous export When the draws are listed Then each is keyed by sample, visit and attempt and carries purpose raw:RQ4, plus one file-level draw keyed by the export id", () => {
    const e = exportOf("allinone_csv", rows.slice(1), { previous: rows.slice(0, 1) });
    expect(e.opportunities.map((o) => [o.purpose, o.id])).toEqual([
      ["raw:RQ4", "U01-D01-1/1/1"], ["raw:RQ4", "U02-D01-1/1/1"], ["raw:RQ4", "U03-D01-1/1/1"], ["raw:RQ4", "AN-1|allinone_csv|36000"],
    ]);
    expect(e.opportunities.every((o) => o.u >= 0 && o.u < 1)).toBe(true);
  });
  it("Given the same seed When the draws are listed with another plan Then the draws are identical (they know no rate, no path, no architecture)", () => {
    const a = exportOf("allinone_csv", rows, { plan: { seed: 7 } }).opportunities;
    const b = exportOf("allinone_csv", rows, { plan: { seed: 7, rates: { overlap: 1, replay: 1 } } }).opportunities;
    expect(a).toEqual(b);
    expect(exportOf("allinone_csv", rows, { plan: { seed: 8 } }).opportunities).not.toEqual(a);
  });
  it("Given a forced replay (RQ4) Then a second file with the same bytes and replay_of the first follows, and its rows are all repeats", () => {
    const [first, second] = exportOf("allinone_csv", rows, { plan: { seed: 7, forced: { replay: true } } }).files;
    expect(second?.text).toBe(first?.text);
    expect(second?.replay_of).toBe(first?.file_name);
    expect(second?.key_rows.every((k) => k.repeat && k.quirks.includes("RQ4"))).toBe(true);
  });
  it("Given a test-only overlap rate of 1 (RQ4) Then every row of the previous export is repeated before the new rows, as repeats", () => {
    const e = exportOf("allinone_csv", rows.slice(2), { previous: rows.slice(0, 2), plan: { seed: 7, rates: { overlap: 1 } } }).files[0];
    expect(e?.key_rows.map((k) => [k.sample_id, k.repeat])).toEqual([[S[0], true], [S[1], true], [S[2], false]]);
  });
  it("Given append mode on the device (RQ4) Then all earlier rows are repeated whatever the rate", () => {
    const device = { ...deviceDefaults(dialectOf("counter_csv"), "AN-1"), append: true };
    const r = rowsOf("counter_csv", COUNTER, ["vcd", "viability"], 130);
    expect(exportOf("counter_csv", r.slice(2), { device, previous: r.slice(0, 2) }).files[0]?.key_rows.map((k) => k.repeat)).toEqual([true, true, false]);
  });
  it("Given range marking on and a glucose of 16 g/L above a limit of 15 g/L at dilution 1 (A089; test-only) Then the cell is blank and the note names analyte and direction (RQ6)", () => {
    const r = rowsOf("allinone_csv", [result(33000, S[0], "glucose", 16), result(33000, S[0], "lactate", 0.8)], ["glucose", "lactate"], 270);
    const device = { ...deviceDefaults(dialectOf("allinone_csv"), "AN-1"), range_marking: true };
    const text = exportOf("allinone_csv", r, { device, plan: { seed: 7, range_limits: { glucose: 15 } } }).files[0]?.text.split("\n") ?? [];
    expect(text[2]).toBe("U01-D01-1,2030-01-07 09:10:00,2030-01-07 09:10:00,1,,,,0.8,,,Glucose Analytical Range High,");
  });
  it("Given a zone of +2 h on the device Then the stamp text shows the local wall clock and no zone (RQ1)", () => {
    const device = { ...deviceDefaults(dialectOf("allinone_csv"), "AN-1"), zone_offset_s: 7200 };
    expect(exportOf("allinone_csv", rows, { device }).files[0]?.text.split("\n")[2]).toBe("U01-D01-1,2030-01-07 11:10:00,2030-01-07 11:10:00,1,,,4.2,0.8,,,,");
  });
  it("Given a units row on the device and a changed unit text for glucose (RQ7) Then the units row shows it and the row realises RQ7", () => {
    const device = { ...deviceDefaults(dialectOf("allinone_csv"), "AN-1"), units_row: true, unit_texts: { glucose: "mmol/L" } };
    const e = exportOf("allinone_csv", rows.slice(0, 1), { device }).files[0];
    // a device writes the unit of every value column of its header (hand-typed from the dialect: VCD, Viability, Glucose, Lactate, Glutamine, pH)
    expect(e?.text.split("\n")[2]).toBe(",,,,x10^6 cells/mL,%,mmol/L,g/L,mmol/L,pH,,");
    expect(e?.key_rows[0]?.quirks).toEqual(["RQ7"]);
  });
  it("Given a scripted reanalysis (RQ5) Then a row follows with the new row time and the original sample time", () => {
    const e = exportOf("allinone_csv", rows.slice(0, 1), { plan: { seed: 7, forced: { reanalysis: [{ row: 0, at_s: 35400 }] } } }).files[0];
    expect(e?.text.split("\n")[3]).toBe("U01-D01-1,2030-01-07 09:50:00,2030-01-07 09:10:00,1,,,4.2,0.8,,,,");
    expect(e?.key_rows[1]?.quirks).toEqual(["RQ5"]);
  });
});

import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/export/csv.ts";
import { ANALYTE_UNITS, EXPORT_FIELDS } from "../../src/export/columns.ts";
import { exportPackage } from "../../src/export/package.ts";
import type { ExportMeta } from "../../src/export/package.ts";
import { exportRows } from "../../src/export/rows.ts";
import { checkPackage } from "../../src/export/check.ts";
import { record } from "../../src/record/recorder.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { SENSORS, STREAM, arch } from "../support/record_fixture.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";

// Step 11 FAIR export (prompts/20; data_model section 10): one row per (sample x analyte x released version), as CSV plus a Frictionless-style datapackage.json.
// The expected rows are typed by hand from the fixture of support/record_fixture.ts (three samples, S2 reran once), with the arithmetic beside them.
//   hold_time = run.started_at - sampled_at; turnaround = available_at - sampled_at; both need two_clocks (and available_at for the second).
//   C, S1: draw 1100, run 1500, measured 2000 -> hold 400, turnaround 900.   S2 v1: draw 5000, run 6000, measured 6500 -> 1000, 1500.
//   S2 v2: run 8500, measured 9000 -> 3500, 4000 (the hold is to the run of that version, as VR-010 reads it).   S3: draw 9100, run 9500, measured 10000 -> 400, 900.
//   Instrument state: AN-1 is calibrated at 0 (LOT-1) and 7200 (LOT-2): runs at 1500 and 6000 are in the first state, the runs at 8500 and 9500 in the second.

const C: RecordedDataset = record({ events: STREAM, sensors: SENSORS }, arch(...FLAG_NAMES));
const A: RecordedDataset = record({ events: STREAM, sensors: SENSORS }, arch());
const META: ExportMeta = {
  seed: 7, engine_version: "0.1.0", schema_version: "1", horizon_s: 20000, context_as_of: 20000, ledger_ids: ["A046", "A100"], dictionary: { path: "docs/design/data_dictionary.yaml", version: "1" },
};

const OPTS = { context_as_of: 20000 };

/** A row with every column null, then the hand-typed values. */
const row = (v: Record<string, string | number | null>): Record<string, string | number | null> => ({
  ...Object.fromEntries(EXPORT_FIELDS.map((f) => [f.name, null])), canonical_unit: "g/L", analyte: "glucose", context_as_of: 20000, ...v,
});

describe("export rows: one per sample x analyte x released version", () => {
  it("Given C When the rows are built Then each unheld version of each result has a row with the columns of data_model section 10, in sample, analyte, version order", () => {
    expect(exportRows(C, OPTS)).toEqual([
      row({ sample_id: "S1", unit_id: "U1", batch_id: "B-U1", version: 1, value: 5.1, sampled_at: 1100, measured_at: 2000, hold_time: 400, turnaround: 900, calibration_ref: "AN-1/cal@0", reagent_lot: "LOT-1", operator_id: "OP-1", ctx_join_basis: "sampled_at", ctx_join_time: 1100, ctx_feed_epoch: 0, ctx_batch_phase: "before_shift", ctx_pv_temperature: 37.1, available_at: 2000 }),
      row({ sample_id: "S2", unit_id: "U1", batch_id: "B-U1", version: 1, value: 3.2, sampled_at: 5000, measured_at: 6500, hold_time: 1000, turnaround: 1500, calibration_ref: "AN-1/cal@0", reagent_lot: "LOT-1", operator_id: "OP-2", ctx_join_basis: "sampled_at", ctx_join_time: 5000, ctx_feed_epoch: 1, ctx_batch_phase: "before_shift", ctx_pv_temperature: 37.5, available_at: 6500 }),
      row({ sample_id: "S2", unit_id: "U1", batch_id: "B-U1", version: 2, value: 3.4, sampled_at: 5000, measured_at: 9000, hold_time: 3500, turnaround: 4000, calibration_ref: "AN-1/cal@7200", reagent_lot: "LOT-2", operator_id: "OP-2", ctx_join_basis: "sampled_at", ctx_join_time: 5000, ctx_feed_epoch: 1, ctx_batch_phase: "before_shift", ctx_pv_temperature: 37.5, available_at: 9000 }),
      row({ sample_id: "S3", unit_id: "U2", batch_id: "B-U2", version: 1, value: 7.0, sampled_at: 9100, measured_at: 10000, hold_time: 400, turnaround: 900, calibration_ref: "AN-1/cal@7200", reagent_lot: "LOT-2", operator_id: "OP-1", ctx_join_basis: "sampled_at", ctx_join_time: 9100, ctx_feed_epoch: 0, ctx_batch_phase: "after_shift", ctx_pv_temperature: 37.9, available_at: 10000 }),
    ]);
  });

  it("Given A, which stores one time and no link When the rows are built Then what it cannot know is null, the batch is derived and the context joins by measured_at (post-feed for S1)", () => {
    // A: keys by time join at the measured time (S1 at 2000: U1 open since 0 -> B-U1); the feed at 1200 is before 2000, so the epoch is 1 although S1 was drawn at 1100 (feed in the gap); the ramp value at 2000 is 37.2.
    expect(exportRows(A, OPTS)[0]).toEqual(row({ sample_id: "S1", unit_id: "U1", batch_id: "B-U1", version: 1, value: 5.1, measured_at: 2000, ctx_join_basis: "measured_at", ctx_join_time: 2000, ctx_feed_epoch: 1, ctx_batch_phase: "before_shift", ctx_pv_temperature: 37.2 }));
  });

  it("Given a held, a quarantined and a rejected row When the rows are built Then only null and released states are exported (what the as-of read treats as available)", () => {
    const states = ["held", "quarantined", "rejected", "released"] as const;
    const ds: RecordedDataset = { ...C, result: C.result.map((r, i) => ({ ...r, state: states[i] as (typeof states)[number] })) };
    expect(exportRows(ds, OPTS).map((r) => [r.sample_id, r.version])).toEqual([["S3", 1]]); // R4 released; R1 held, R2 quarantined, R3 rejected
    expect(exportRows({ ...C, result: C.result.map((r) => ({ ...r, state: "released" as const })) }, OPTS).length).toBe(4);
  });

  it("Given a context time before the draw of S2 When the rows are built Then the context columns follow the as-of read and context_as_of is the stated time on every row", () => {
    const rows = exportRows(C, { context_as_of: 1300 }); // the feed at 1200 is ingested by 1300; S2 (join 5000) sees a feed epoch of 1, the ramp value is the tick at 1300 (37.1)
    expect(rows.every((r) => r.context_as_of === 1300)).toBe(true);
    expect(rows[1]?.ctx_pv_temperature).toBe(37.1);
  });

  it("Given no stated context time When the export is built Then the context time defaults to the end of the horizon, and the package metadata names that default", () => {
    const unstated: ExportMeta = { ...META, horizon_s: 15000 };
    delete unstated.context_as_of;
    const out = exportPackage(C, unstated);
    expect(exportRows(C, { context_as_of: 15000 }).length).toBe(4);
    expect(out.datapackage).toMatchObject({ context_as_of: 15000, context_as_of_basis: "end_of_horizon" });
    expect((out.files["results.csv"] as string).split("\n")[1]?.endsWith(",2000,15000")).toBe(true); // available_at 2000, context_as_of 15000 on the first row
    expect(exportPackage(C, META).datapackage.context_as_of_basis).toBe("stated");
  });

  it("Then the canonical unit comes from the analyte table, and an analyte without an entry is an error, not a guess", () => {
    expect(ANALYTE_UNITS).toEqual({ vcd: "10*6/mL", viability: "%", glucose: "g/L", glutamine: "mmol/L", lactate: "g/L", titer: "g/L", ph: "[pH]" });
    const ds: RecordedDataset = { ...C, result: C.result.map((r) => ({ ...r, analyte: "unknown_analyte" })) };
    expect(() => exportRows(ds, OPTS)).toThrow(/no canonical unit for analyte unknown_analyte/);
  });
});

describe("csv", () => {
  it("Given nulls, commas and quotes When written Then null is an empty cell and a cell with a comma, a quote or a newline is quoted with doubled quotes (RFC 4180, LF line ends)", () => {
    const fields = [EXPORT_FIELDS[0], EXPORT_FIELDS[1]] as (typeof EXPORT_FIELDS)[number][];
    expect(toCsv(fields, [{ sample_id: 'x,y "q"', unit_id: null }])).toBe(`${fields.map((f) => f.name).join(",")}\n"x,y ""q""",\n`);
  });
});

describe("data package", () => {
  const pkg = exportPackage(C, META);

  it("Given C When the package is built Then it carries the required keys, the table schema of the export columns with UCUM units as a custom property, and the provenance of the run", () => {
    expect(pkg.datapackage).toMatchObject({
      profile: "tabular-data-package", name: `${C.architecture.id}-seed-7`, seed: 7, engine_version: "0.1.0", schema_version: "1", context_as_of: 20000, context_as_of_basis: "stated",
      data_dictionary: { path: "docs/design/data_dictionary.yaml", version: "1" }, ledger_ids: ["A046", "A100"],
      architecture: { id: C.architecture.id, labelling: C.architecture.labelling, flags: C.architecture.flags },
    });
    const [resource] = pkg.datapackage.resources;
    expect(resource).toMatchObject({ name: "results", path: "results.csv", format: "csv", mediatype: "text/csv", encoding: "utf-8" });
    expect(resource?.schema.fields.map((f) => f.name)).toEqual(EXPORT_FIELDS.map((f) => f.name));
    expect(resource?.schema.fields.find((f) => f.name === "hold_time")).toEqual({ name: "hold_time", type: "integer", ucum: "s", constraints: { required: false } });
    expect(resource?.schema.fields.find((f) => f.name === "value")).toEqual({ name: "value", type: "number", ucum_column: "canonical_unit", constraints: { required: true } });
    expect(Object.keys(pkg.files)).toEqual(["results.csv"]);
  });

  it("Then the licence follows ADR-0008 (Accepted): CC BY 4.0 for exported synthetic data", () => {
    expect(pkg.datapackage.licenses).toEqual([{ name: "CC-BY-4.0", path: "https://creativecommons.org/licenses/by/4.0/", title: "Creative Commons Attribution 4.0 International" }]);
  });

  it("Then the CSV header equals the schema field names and the first data row is typed by hand", () => {
    const [header, first] = (pkg.files["results.csv"] as string).split("\n");
    expect(header).toBe(EXPORT_FIELDS.map((f) => f.name).join(","));
    // sample_id,unit_id,batch_id,analyte,version,value,canonical_unit,sampled_at,measured_at,hold_time,turnaround,calibration_ref,reagent_lot,method_version,operator_id,qualification_id,
    // ctx_join_basis,ctx_join_time,ctx_feed_epoch,ctx_batch_phase,ctx_pv_pH,ctx_pv_DO,ctx_pv_temperature,available_at,context_as_of
    expect(first).toBe("S1,U1,B-U1,glucose,1,5.1,g/L,1100,2000,400,900,AN-1/cal@0,LOT-1,,OP-1,,sampled_at,1100,0,before_shift,,,37.1,2000,20000");
  });

  it("Then the same dataset and meta give the same bytes", () => {
    expect(JSON.stringify(exportPackage(C, META))).toBe(JSON.stringify(pkg));
  });
});

describe("in-house validator", () => {
  const good = () => exportPackage(C, META);
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

  it("Given the package of C When it is checked Then it has no error", () => {
    const p = good();
    expect(checkPackage(p.datapackage, p.files)).toEqual([]);
  });

  it.each([
    ["a required key is missing", (p: ReturnType<typeof good>) => delete (p.datapackage as Partial<typeof p.datapackage>).seed, /missing key seed/],
    ["a resource path does not exist", (p: ReturnType<typeof good>) => delete p.files["results.csv"], /resource results: path results.csv does not exist/],
    ["the CSV header differs from the schema field names", (p: ReturnType<typeof good>) => { p.files["results.csv"] = (p.files["results.csv"] as string).replace("sample_id,", "sample,"); }, /header .* differs from the schema field names/],
    ["an integer cell does not parse", (p: ReturnType<typeof good>) => { p.files["results.csv"] = (p.files["results.csv"] as string).replace("S1,U1,B-U1,glucose,1,", "S1,U1,B-U1,glucose,1.5,"); }, /row 1, column version: "1.5" is not an integer/],
    ["a required cell is empty", (p: ReturnType<typeof good>) => { p.files["results.csv"] = (p.files["results.csv"] as string).replace("S1,U1,", ",U1,"); }, /row 1, column sample_id: required cell is empty/],
    ["a row has the wrong width", (p: ReturnType<typeof good>) => { p.files["results.csv"] = `${p.files["results.csv"] as string}a,b\n`; }, /row 5: 2 cells, expected 25/],
  ])("Given a package where %s When it is checked Then the error names it", (_name, break_, message) => {
    const p = clone(good());
    break_(p);
    expect(checkPackage(p.datapackage, p.files).join("\n")).toMatch(message);
  });
});

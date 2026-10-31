import { describe, expect, it } from "vitest";
import { checkPackage } from "../../src/export/check.ts";
import { EXPORT_FIELDS } from "../../src/export/columns.ts";
import { exportPackage } from "../../src/export/package.ts";
import type { ExportMeta } from "../../src/export/package.ts";
import { exportRows } from "../../src/export/rows.ts";
import { FX12A, FX12A_MASTER, FX12E, FX12E_MASTER, H } from "../support/breakout_streams.ts";
import { VALID_QUALIFICATIONS } from "../support/cell_stream.ts";
import { FX12M_I, FX12M_MASTER } from "../support/fx12m_streams.ts";
import { config, rec } from "../support/investigate_setup.ts";
import { record } from "../../src/record/recorder.ts";

// Break-out batch 6, task 1: the export of a break-out dataset (the review of batch 3 found that `exportRows` threw on a confirming result, "no canonical unit for analyte bioburden"). A confirming
// result carries an outcome and no value (K18, data_model 15.3), so it has no row of "one row per sample x analyte x released version with a value" (data_model section 10) and no canonical unit
// to ask for: the export leaves it out and writes the routine rows as it always did. The break-out export package is otherwise not built in S3 (spec 11.8.1). Expected counts are typed by hand
// from the fixtures: FX12a and FX12e have nine routine samples with one glucose result each (three per unit, FX12e has ten with U02-S4), FX12m twelve.

const META: ExportMeta = { seed: 7, engine_version: "0.1.0", schema_version: "1", horizon_s: H(800), context_as_of: H(800), ledger_ids: ["A176"], dictionary: { path: "docs/design/data_dictionary.yaml", version: "1" } };
const OPTS = { context_as_of: H(800) };

describe("Export of a break-out dataset: a confirming result is not a row", () => {
  it.each([
    { name: "FX12a", events: FX12A, master: FX12A_MASTER, routine: 9 },
    { name: "FX12e", events: FX12E, master: FX12E_MASTER, routine: 10 },
    { name: "FX12m", events: FX12M_I, master: FX12M_MASTER, routine: 12 },
  ])("Given $name recorded under C with its confirming samples When the rows are built Then it does not throw and holds the $routine routine results and none of the confirming ones", ({ events, master, routine }) => {
    const ds = rec(events, master, "C");
    expect(ds.result.filter((r) => r.outcome != null).length).toBeGreaterThan(0); // the confirming results are in the record
    const rows = exportRows(ds, OPTS);
    expect(rows.length).toBe(routine);
    expect(rows.every((r) => !String(r.sample_id).endsWith("-CONF") && r.value !== null && r.canonical_unit === "g/L")).toBe(true);
  });

  it("Given the same dataset When it is exported as a package Then the package is valid, has exactly the columns of data_model section 10 and the CSV has one line per routine result", () => {
    const pkg = exportPackage(rec(FX12A, FX12A_MASTER, "C"), META);
    expect(checkPackage(pkg.datapackage, pkg.files)).toEqual([]);
    expect(pkg.datapackage.resources[0]?.schema.fields.map((f) => f.name)).toEqual(EXPORT_FIELDS.map((f) => f.name));
    expect((pkg.files["results.csv"] as string).trim().split("\n").length).toBe(1 + 9);
  });

  it("Given the same stream recorded without the master data (no break-out tables, no confirming rows) When the rows are built Then they are the rows of the dataset with it: the export does not depend on the extension", () => {
    const without = exportRows(record({ events: FX12A, sensors: [], qualifications: VALID_QUALIFICATIONS }, config("C")), OPTS);
    const withData = exportRows(rec(FX12A, FX12A_MASTER, "C"), OPTS);
    expect(withData.map((r) => [r.sample_id, r.analyte, r.version, r.value])).toEqual(without.map((r) => [r.sample_id, r.analyte, r.version, r.value]));
  });
});

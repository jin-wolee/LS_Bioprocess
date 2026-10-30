import { describe, expect, it } from "vitest";
import { CONFIGS, CONFIG_NAMES } from "../support/cells.ts";
import { RAW_EXPECTED } from "../support/raw_cell_tables.ts";
import { RAW_ROWS, cellsOfRaw, runRaw } from "../support/raw_cells.ts";

// Step 6: the forced-error cells of the matrix rows marked (raw) and (manual), through A, B, C and each single-flag ablation of C (ten), once per capture path. The expected cells are
// typed by hand in raw_cell_tables.ts. A (raw) row on manual_transcription and a (manual) row on adapter_ingest read "not_applicable", never zero.

describe("forced-error cells per capture path", () => {
  it("Given the table Then it has a row for every forced row and thirteen cells per path", () => {
    expect(Object.keys(RAW_EXPECTED).sort()).toEqual(RAW_ROWS.map((r) => r.name).sort());
    for (const e of Object.values(RAW_EXPECTED)) expect([e.adapter_ingest.length, e.manual_transcription.length]).toEqual([13, 13]);
    expect(CONFIG_NAMES.length).toBe(13);
  });

  for (const row of RAW_ROWS) {
    for (const path of ["adapter_ingest", "manual_transcription"] as const) {
      it(`Given "${row.name}" on ${path} When it is run through A, B, C and the ten ablations Then the cells are as typed by hand`, () => {
        expect(cellsOfRaw(row, path)).toEqual((RAW_EXPECTED[row.name] as (typeof RAW_EXPECTED)[string])[path]);
      });
    }
    it(`Given "${row.name}" Then the class cannot arise on the other path, and the harness shows why`, () => {
      const other = row.arises === "adapter_ingest" ? "manual_transcription" : "adapter_ingest";
      for (const c of CONFIGS) {
        const { out } = runRaw(row, c.config, other);
        if (other === "manual_transcription") expect([out.outputs.length, out.tables]).toEqual([0, null]); // a (raw) row: no file is parsed, so no adapter finding can exist
        else expect(out.key.entry_errors).toEqual([]); // a (manual) row: no copy step, so nothing is typed
      }
    });
  }

  it("Given the forced timestamp misread on adapter_ingest Then the misread instant is the one the entry's order gives (hand arithmetic): August 1, 09:11:40, which is 206 days and 33100 s after the anchor", () => {
    const row = RAW_ROWS[0];
    if (!row) throw new Error("no row");
    const { out } = runRaw(row, (CONFIGS[2] as (typeof CONFIGS)[number]).config, "adapter_ingest");
    expect(out.events.find((e) => e.type === "result_measured")?.t).toBe(206 * 86400 + 33100);
  });
});

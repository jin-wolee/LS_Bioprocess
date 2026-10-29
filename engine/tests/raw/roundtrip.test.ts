import { describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import { adapterEntry } from "../../src/ingest/adapters/entry.ts";
import { parseFile } from "../../src/ingest/parse.ts";
import { newStore } from "../../src/ingest/store.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { emitExport } from "../../src/raw/emit.ts";
import { analysisRows } from "../../src/raw/rows.ts";
import { deviceDefaults } from "../../src/raw/types.ts";
import { ANCHOR, dialectOf } from "../support/raw_fixtures.ts";

// Step 6, round trip: with every quirk switch off, parsing the emitted file returns the observable events it was rendered from, on the mapped fields and within the dialect's
// time resolution. The expected rows below are typed by hand (test-only values; 09:10:00 is 33000), not produced by running the emitter.

const result = (t: number, request: string, analyte: string, value: number, analyzer: string): ObservableEvent => ({ type: "result_measured", t, request_id: request, attempt: 1, visit: 1, analyzer, analyte, value });

const roundTrip = (dialectId: string, events: ObservableEvent[], analytes: string[], run_s: number, instrument: string) => {
  const dialect = dialectOf(dialectId);
  const rows = analysisRows(events, { dialect, visit_dialects: [dialectId], visit_analytes: [analytes], visit_run_s: [run_s], default_dilution: dialectId === "cds_table" ? null : 1 });
  const file = emitExport({ dialect, device: deviceDefaults(dialect, instrument), anchor_epoch_s: anchorEpoch(ANCHOR), rows, previous: [], export_at: 36000, plan: { seed: 3 } }).files[0];
  if (!file) throw new Error("no file");
  const entry = adapterEntry(dialect, { instrument, required_analytes: analytes, run_s });
  const out = parseFile(file.text, { entry, file_name: file.file_name, raw_file_id: "RF1", received_at: 36000, anchor_epoch_s: anchorEpoch(ANCHOR), flags: { ingest_idempotency: true, append_only_versions: true }, store: newStore() });
  return out.records.map((r) => [r.payload.sample_id, r.payload.analyte, r.payload.value, r.payload.measured_at, r.envelope.source_system, r.state]);
};

describe("Step 6 round trip: emit then parse returns the rendered events (every quirk off)", () => {
  it("Given all-in-one results of two samples When the file is emitted and parsed Then sample, analyte, value, instant and instrument come back to the second", () => {
    const events = [result(33000, "U01-D01-1", "glucose", 4.2, "AN-1"), result(33000, "U01-D01-1", "lactate", 0.8, "AN-1"), result(33337, "U07-D02-1", "glucose", 6.25, "AN-1"), result(33337, "U07-D02-1", "lactate", 1.5, "AN-1")];
    expect(roundTrip("allinone_csv", events, ["glucose", "lactate"], 270, "AN-1")).toEqual([
      ["U01-D01-1", "glucose", 4.2, 33000, "AN-1", "loaded"], ["U01-D01-1", "lactate", 0.8, 33000, "AN-1", "loaded"],
      ["U07-D02-1", "glucose", 6.25, 33337, "AN-1", "loaded"], ["U07-D02-1", "lactate", 1.5, 33337, "AN-1", "loaded"],
    ]);
  });
  it("Given counter results at 09:14:30 When the file is emitted and parsed Then the instant comes back within the one-minute resolution of the dialect (09:14:00)", () => {
    const events = [result(33270, "U02-D01-1", "vcd", 10.1, "AN-1"), result(33270, "U02-D01-1", "viability", 96, "AN-1")];
    expect(roundTrip("counter_csv", events, ["vcd", "viability"], 130, "AN-1")).toEqual([["U02-D01-1", "vcd", 10.1, 33240, "AN-1", "loaded"], ["U02-D01-1", "viability", 96, 33240, "AN-1", "loaded"]]);
  });
  it("Given a titer result at 09:09:00 on the data-system dialect (stamp = start of the run, 60 s test-only) When emitted and parsed Then the measured instant is the stamp plus the run time", () => {
    expect(roundTrip("cds_table", [result(32940, "U01-D01-1", "titer", 1.2, "HP-1")], ["titer"], 60, "HP-1")).toEqual([["U01-D01-1", "titer", 1.2, 32940, "HP-1", "loaded"]]);
  });
  it("Given a result 30 days after the anchor, and one the day before a month end When emitted and parsed Then the calendar arithmetic is exact in both directions", () => {
    const t = 30 * 86400 + 33000; // 2030-02-06 09:10:00
    const t2 = 24 * 86400 + 80000; // 2030-01-31 22:13:20
    expect(roundTrip("allinone_csv", [result(t, "U01-D01-1", "glucose", 4.2, "AN-1"), result(t2, "U02-D01-1", "glucose", 5.5, "AN-1")], ["glucose"], 270, "AN-1").map((r) => r[3])).toEqual([t, t2]);
  });
});

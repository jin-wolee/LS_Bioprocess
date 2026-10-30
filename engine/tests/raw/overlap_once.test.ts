import { describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import { physicalIds } from "../../src/experiments/assembly/physical_ids.ts";
import { rawPath } from "../../src/experiments/assembly/raw_path.ts";
import type { RawSetup } from "../../src/experiments/assembly/raw_path.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { overlapDraw } from "../../src/raw/quirks.ts";
import { BASE, byTime, inoculation, sampleWithRun } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";
import { DIALECTS } from "../support/raw_run.ts";

// S2f F3: RQ4 overlap repeats a chosen row once (spec 2.4.3, RQ4: "overlapping operator exports repeat selected rows"). A row chosen in one export is repeated in the next export of
// the same instrument and dialect, and only there; each row's draw is in the raw quirk key once. The overlap rates below are TEST-ONLY values (no ledger entry gives one, spec 2.4.8).
// Instants are seconds of the synthetic Monday 2030-01-07; a tube drawn at d is measured at d + 400 (100 s wait, 300 s run).

const A = (CONFIGS[0] as (typeof CONFIGS)[number]).config;
const setupOf = (export_at: (t: number) => number, rate: number): RawSetup => ({
  dialects: DIALECTS, anchor_epoch_s: anchorEpoch("2030-01-07"), zone_offset_s: 0, default_dilution: 1, export_at, visits: [{ dialect: "allinone_csv", analytes: ["glucose"], run_s: 270 }],
  plan: { rates: { overlap: rate } },
});
const stream = (tubes: [string, number, string?][]): ObservableEvent[] =>
  byTime([...BASE, inoculation("U1"), ...tubes.flatMap(([id, drawn, analyzer]) => sampleWithRun(id, "U1", drawn, 100, 4.2, analyzer ? { analyzer } : {}))]);
const run = (events: ObservableEvent[], setup: RawSetup, seed = 1) => rawPath({ setup, seed, architecture: A, path: "adapter_ingest", events, received_at: {}, physical: physicalIds(events, events) });
/** Per file in order: instrument and the sample ids of its rows, a repeat marked with a star. */
const layout = (out: ReturnType<typeof run>): string[] => out.files.map((f) => `${f.instrument}: ${f.key_rows.map((k) => k.sample_id + (k.repeat ? "*" : "")).join(" ")}`);

describe("S2f F3: three exports of one instrument, an overlap rate of 1 (test-only, every row chosen)", () => {
  // S1, S2 and S3 are measured at 1500, 1600 and 1700 s and each result is exported at its own instant (per_run): three exports
  const out = run(stream([["S1", 1100], ["S2", 1200], ["S3", 1300]]), setupOf((t) => t, 1));

  it("Given a row chosen in the first export Then it is repeated in the second export only, and the second export's row in the third only", () => {
    expect(layout(out)).toEqual(["AN-1: S1", "AN-1: S1* S2", "AN-1: S2* S3"]);
  });
  it("Given the last row has no next export Then it is never repeated", () => {
    expect(out.files.flatMap((f) => f.key_rows).filter((k) => k.repeat).map((k) => k.sample_id)).toEqual(["S1", "S2"]);
  });
  it("Then the key holds one overlap draw per row (S1, S2, S3 once each) and one file-level draw per export", () => {
    const draws = out.key.opportunities.filter((o) => o.purpose === "raw:RQ4").map((o) => o.id);
    expect(draws).toEqual(["S1/1/1", "AN-1|allinone_csv|1500", "S2/1/1", "AN-1|allinone_csv|1600", "S3/1/1", "AN-1|allinone_csv|1700"]);
  });
});

describe("S2f F3: a chosen row is repeated in the next export of the same instrument", () => {
  it("Given S1 and S3 on AN-1 and S2 on AN-2, rate 1 (test-only) Then S1 is repeated in AN-1's second export and AN-2 repeats nothing", () => {
    const out = run(stream([["S1", 1100], ["S2", 1200, "AN-2"], ["S3", 1300]]), setupOf((t) => t, 1));
    expect(layout(out)).toEqual(["AN-1: S1", "AN-2: S2", "AN-1: S1* S3"]);
  });
});

describe("S2f F3: the same chosen rows give the same number of repeated rows on any export schedule when every chosen row has a next export", () => {
  // Four tubes measured at 1500, 1600, 2500 and 2600 s. Seed 59 and a test-only rate of 0.5: S1 and S2 draw below it, S3 and S4 above (precondition, checked below), so the chosen rows
  // are S1 and S2 and both have a next export on either schedule. per_run: four exports; window_end: two (before and after 2000 s).
  const SEED = 59;
  const events = stream([["S1", 1100], ["S2", 1200], ["S3", 2100], ["S4", 2200]]);
  const repeats = (export_at: (t: number) => number) => run(events, setupOf(export_at, 0.5), SEED).files.flatMap((f) => f.key_rows).filter((k) => k.repeat).map((k) => k.sample_id);

  it("Given the draws of seed 59 Then S1 and S2 are chosen at the rate 0.5 and S3 and S4 are not (the precondition of the cases below)", () => {
    const u = ["S1", "S2", "S3", "S4"].map((id) => overlapDraw(SEED, { physical_id: id, src: { request_id: id, attempt: 1, visit: 1, t: 0 } }).u < 0.5);
    expect(u).toEqual([true, true, false, false]);
  });
  it("When each result is exported at once (per_run) Then two rows are repeated, S1 and S2", () => {
    expect(repeats((t) => t)).toEqual(["S1", "S2"]);
  });
  it("When the exports are cut at the end of each window (window_end) Then the same two rows are repeated", () => {
    expect(repeats((t) => (t < 2000 ? 1999 : 3999))).toEqual(["S1", "S2"]);
  });
});

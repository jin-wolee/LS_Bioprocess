import { describe, expect, it } from "vitest";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import { contextAsOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import type { HistorianRow, RecordedDataset, ResultRow } from "../../src/record/types.ts";
import { SENSORS, STREAM, arch } from "../support/record_fixture.ts";

// S2e2 rework W2: the process-value read on the adapter path. With the raw layer on and a controller on the bay the historian is the logged rows, tag `unit_tag.signal.role`
// (data_model 16.4), and the process context takes for each signal the last `unit.signal.PV` row at or before the join time that the system had received by the decision. A set
// point (`.SP`) or an output (`.OUT`) is never a process value. The dataset is the C fixture of support/record_fixture.ts with its columnar series replaced by hand-typed logged rows
// (test-only values); S1 is drawn on U1 at 1100, so C joins at sampled_at = 1100. The files reached the host at 86400 s (the first) and 172800 s (the second).

const C = (): RecordedDataset => record({ events: STREAM, sensors: SENSORS }, arch(...FLAG_NAMES));
const row = (tag: string, ts: number, value: number, ingested_at: number): HistorianRow => ({ tag, ts, value, quality: "good", ingested_at, raw_ref: { raw_file_id: "CF1", line_no: 3 } });

/** U1: temperature PV logged at 0, 1000 and (in the second file) 1050; a temperature SP at 1000 and a later one at 1090 (both in the first file), a pH PV, a DO SP and no DO PV; U2: a temperature PV. */
const ROWS: HistorianRow[] = [
  row("U1.temperature.PV", 0, 37.0, 86400), row("U1.temperature.PV", 1000, 37.2, 86400), row("U1.temperature.PV", 1050, 37.4, 172800),
  row("U1.temperature.SP", 1000, 33.0, 86400), row("U1.temperature.SP", 1090, 99.0, 86400), row("U1.temperature.OUT", 1095, 55.0, 86400),
  row("U1.pH.PV", 0, 7.01, 86400), row("U1.DO.SP", 0, 30.0, 86400), row("U2.temperature.PV", 1000, 50.0, 86400),
];
const adapterDataset = (): RecordedDataset => {
  const ds = C();
  return { ...ds, historian: { series: [], late: ROWS } };
};
const pvAt = (ds: RecordedDataset, asOf: number): Record<string, number> | undefined => contextAsOf(ds, ds.result[0] as ResultRow, asOf)?.pv;

describe("the process context on the adapter path takes the process value from the logged unit.signal.PV rows", () => {
  const ds = adapterDataset();
  it("Given a decision after the first file and before the second Then each signal is the last PV row at or before the join time 1100 that had been received: temperature 37.2 (ts 1000), pH 7.01 (ts 0)", () => {
    expect(pvAt(ds, 100000)).toEqual({ temperature: 37.2, pH: 7.01 });
  });
  it("Given a decision after the second file Then the row of ts 1050 that arrived later is the last one at or before 1100: temperature 37.4", () => {
    expect(pvAt(ds, 172800)).toEqual({ temperature: 37.4, pH: 7.01 });
  });
  it("Given a decision before the first file arrived Then nothing is visible: the context has no process value yet", () => {
    expect(pvAt(ds, 86399)).toEqual({});
  });
  it("Given a set point that is later than the PV row and at or before the join time (SP 99 at 1090, PV 37.2 at 1000) Then it is not taken as a process value", () => {
    expect(pvAt(ds, 100000)?.temperature).toBe(37.2);
  });
  it("Given a signal with a set point and no PV row (DO) and an output row (temperature OUT) Then the context has no value for it, and no signal is named after a role", () => {
    const pv = pvAt(ds, 172800) ?? {};
    expect("DO" in pv).toBe(false);
    expect(Object.keys(pv).sort()).toEqual(["pH", "temperature"]);
    expect(Object.values(pv)).not.toContain(33);
    expect(Object.values(pv)).not.toContain(99);
    expect(Object.values(pv)).not.toContain(55);
  });
  it("Given a row of another unit (U2 temperature 50 at 1000) Then it is not read for U1", () => {
    expect(Object.values(pvAt(ds, 172800) ?? {})).not.toContain(50);
  });
  it("Given available_at off Then the read sees every row as of now: the later file leaks into the earlier decision (time-travel leakage), and still no set point is a process value", () => {
    const leaky = { ...ds, architecture: { ...ds.architecture, flags: { ...ds.architecture.flags, available_at: false } } };
    expect(pvAt(leaky, 100000)).toEqual({ temperature: 37.4, pH: 7.01 });
  });
});

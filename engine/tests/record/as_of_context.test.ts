import { describe, expect, it } from "vitest";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import type { FlagName } from "../../src/record/architecture.ts";
import { contextAsOf, resultsAsOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import type { RecordedDataset, ResultRow } from "../../src/record/types.ts";
import { SENSORS, STREAM, arch } from "../support/record_fixture.ts";

// S2a Step 1: the process context of C is a versioned as-of projection (data_model section 5, spec section 3 rule 5): keys are stored
// at write time, and the context (feed epoch, batch phase, the last historian value) is derived by an as-of join. Expected values
// are typed by hand from the fixture of support/record_fixture.ts.

/** C with the named flags off (none: C itself). */
const C = (...off: FlagName[]): RecordedDataset => record({ events: STREAM, sensors: SENSORS }, arch(...FLAG_NAMES.filter((f) => !off.includes(f))));
const ids = (rows: readonly ResultRow[]): string[] => rows.map((r) => r.result_id);

describe("context of C: keys from the write, context from the as-of join", () => {
  const ds = C();
  it("Given C When the context of each result is read after the run Then it is the process state at sampled_at", () => {
    const at = (i: number) => contextAsOf(ds, ds.result[i] as ResultRow, 20000);
    expect(at(0)).toEqual({ join_basis: "sampled_at", join_time: 1100, unit_id: "U1", batch_id: "B-U1", feed_epoch: 0, batch_phase: "before_shift", pv: { temperature: 37.1 } }); // S1: the feed at 1200 is after the draw
    expect(at(1)).toEqual({ join_basis: "sampled_at", join_time: 5000, unit_id: "U1", batch_id: "B-U1", feed_epoch: 1, batch_phase: "before_shift", pv: { temperature: 37.5 } }); // S2 version 1
    expect(at(2)).toEqual(at(1)); // S2 version 2: a new version of the result has the context of the same draw
    expect(at(3)).toEqual({ join_basis: "sampled_at", join_time: 9100, unit_id: "U2", batch_id: "B-U2", feed_epoch: 0, batch_phase: "after_shift", pv: { temperature: 37.9 } }); // S3: shift at 9050
  });
  it("Given a result whose sample has no row When its context is read Then there is none", () => {
    expect(contextAsOf(ds, { ...(ds.result[0] as ResultRow), request_id: "S9" }, 20000)).toBeNull();
  });
});

describe("a result version with available_at after the decision time is invisible to it, and a later version supersedes it afterwards", () => {
  const ds = C();
  it.each([
    [1999, []],
    [2000, ["R1"]],
    [6499, ["R1"]],
    [6500, ["R1", "R2"]], // S2 version 1 (QC failed) became available at 6500
    [8999, ["R1", "R2"]], // version 2 is available at 9000: the decision at 8999 does not see it
    [9000, ["R1", "R3"]], // version 2 supersedes version 1 from 9000 on
    [10000, ["R1", "R3", "R4"]],
  ])("Given a decision at %i Then it sees %j", (t, expected) => {
    expect(ids(resultsAsOf(ds, t))).toEqual(expected);
  });

  it("Given available_at off When the same decision at 8999 is taken Then the later version leaks into it (queries see rows as of now)", () => {
    const leaky = C("available_at");
    expect(leaky.result.map((r) => r.available_at)).toEqual([null, null, null, null]);
    expect(ids(resultsAsOf(leaky, 8999))).toEqual(["R1", "R3", "R4"]); // R3 is version 2 of S2, R4 is S3, measured at 10000, after the decision
  });

  it("Given append_only_versions off When the decision at 8999 is taken Then version 1 of S2 no longer exists and the decision sees nothing of S2", () => {
    const over = C("append_only_versions");
    expect(over.result.map((r) => [r.result_id, r.available_at])).toEqual([["R1", 2000], ["R2", 9000], ["R3", 10000]]);
    expect(ids(resultsAsOf(over, 8999))).toEqual(["R1"]);
  });
});

describe("a historian correction ingested after a decision time is invisible to that decision and visible afterwards", () => {
  // test-only value: the temperature logged at ts 1000 on U1 is corrected from 37.0 to 36.4, and the correction reaches the system at 5000
  const correction = { tag: "U1.temperature", ts: 1000, value: 36.4, quality: "good", ingested_at: 5000 } as const;
  const withCorrection = (ds: RecordedDataset): RecordedDataset => ({ ...ds, historian: { ...ds.historian, late: [correction] } });
  const temperatureOfS1 = (ds: RecordedDataset, asOf: number): number | undefined => contextAsOf(ds, ds.result[0] as ResultRow, asOf)?.pv.temperature;

  it("Given the logged value 37.1 at ts 1000 (S1 is drawn at 1100) Then a decision at 4999 reads 37.1 and one at 5000 reads the correction 36.4", () => {
    const ds = withCorrection(C());
    expect(temperatureOfS1(ds, 4999)).toBe(37.1);
    expect(temperatureOfS1(ds, 5000)).toBe(36.4);
    expect(temperatureOfS1(ds, 20000)).toBe(36.4);
  });

  it("Given available_at off Then the earlier decision sees the correction (time-travel leakage)", () => {
    expect(temperatureOfS1(withCorrection(C("available_at")), 4999)).toBe(36.4);
  });

  it("Given a late process event Then it is invisible before its ingested_at and counted after, in the feed epoch", () => {
    const ds = C();
    ds.process_event.push({ event_id: "PE9", batch_id: "B-U1", unit_id: "U1", kind: "feed", occurred_at: 4000, amount: 0.1, source: "scripted", ingested_at: 7000 });
    const epoch = (asOf: number): number | undefined => contextAsOf(ds, ds.result[1] as ResultRow, asOf)?.feed_epoch;
    expect(epoch(6999)).toBe(1); // S2 is drawn at 5000: the feed at 1200 counts, the late one (valid 4000, ingested 7000) does not yet
    expect(epoch(7000)).toBe(2);
  });
});

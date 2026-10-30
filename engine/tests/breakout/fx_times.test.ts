import { beforeAll, describe, expect, it } from "vitest";
import type { ScenarioRun } from "../../src/run.ts";
import { H, docOf, eventsOf, fx12a, fx12e, processOf, runOfDoc } from "./support.ts";

// Spec 11.8.4: the times of FX12a and FX12e from the script (onsets, signal_at, stops, results). Every expected value below was typed from the "Hand-derived truth" rows of
// 11.8.4 before any code: bacterial, lag 12 h (A139), ramp 6 h (A141), d1 2 h, d2 4 h (A176), bioburden 5 d (A142), sterility 14 d (A143); hours from the inoculation at 0 h.

const series = (run: ScenarioRun, unit: string, signal: string) => {
  const s = run.sensors.find((x) => x.unit_id === unit && x.signal === signal);
  if (!s) throw new Error(`no ${signal} series for ${unit}`);
  return s;
};
/** The true value of a series at an instant of the unit (the first tick is at 0 h and the cadence is 60 s). */
const truthAt = (run: ScenarioRun, unit: string, signal: string, t: number): number => series(run, unit, signal).truth[t / 60] as number;

describe("FX12a: a contaminated batch shares a medium lot with a clean batch (truth side)", () => {
  let run: ScenarioRun;
  beforeAll(() => {
    run = runOfDoc(docOf(fx12a()));
  });

  it("Given ML-2 contaminated from 0 h and used by U01 at 5 h When the script runs Then the one onset is U01 at 5 h, hidden in the truth log, with the lot as origin", () => {
    expect(eventsOf(run, "contamination_onset")).toEqual([
      { type: "contamination_onset", t: H(5), unit_id: "U01", batch_id: "B-U01", contamination_type: "bacterial", origin_kind: "medium_lot", origin_id: "ML-2" },
    ]);
  });

  it("Given an onset at 5 h and a lag of 12 h When the signal is observed Then signal_at is 17 h, the first tick at or after 17 h, and the deviation opens at that instant", () => {
    expect(eventsOf(run, "signal_observed")).toEqual([{ type: "signal_observed", t: H(17), unit_id: "U01", batch_id: "B-U01", signal: "DO", limit: "low" }]);
    expect(eventsOf(run, "deviation_opened")).toEqual([{ type: "deviation_opened", t: H(17), deviation_id: "DEV-1", unit_id: "U01", batch_id: "B-U01", trigger: "signal" }]);
  });

  it("Given d1 of 2 h When the first decision falls Then U01 is stopped at 19 h and U02 and U03 are not stopped", () => {
    expect(processOf(run, "unit_stopped")).toEqual([["U01", H(19), "-"]]);
    expect(run.process.byUnit.get("U01")?.harvested_s).toBe(H(19));
    expect(eventsOf(run, "process_event").find((e) => e.kind === "unit_stopped")?.source).toBe("scripted");
  });

  it("Given the confirm list U01 and U02 When the decision falls at 19 h Then one confirming sample per unit is drawn at 19 h, with a bioburden aliquot of 2 mL and a sterility aliquot of 2 media of 20 mL", () => {
    const drawn = eventsOf(run, "confirm_sample_drawn");
    expect(drawn.map((e) => [e.sample_id, e.unit_id, e.t, e.volume_ul])).toEqual([
      ["U01-CONF", "U01", H(19), 42_000],
      ["U02-CONF", "U02", H(19), 42_000],
    ]);
    expect(drawn[0]?.tests).toEqual([
      { aliquot_id: "U01-CONF-A1", test: "bioburden", volume_ul: 2000 },
      { aliquot_id: "U01-CONF-A2", test: "sterility", volume_ul: 40_000 },
    ]);
    expect(drawn.every((e) => /^OP-0[1-4]$/.test(e.operator_id))).toBe(true);
  });

  it("Given bioburden 5 d and sterility 14 d When the results arrive Then they arrive at 139 h and 355 h, U01 detected in both and U02 not detected in both", () => {
    expect(eventsOf(run, "confirm_result").map((e) => [e.sample_id, e.test, e.t, e.outcome])).toEqual([
      ["U01-CONF", "bioburden", H(139), "detected"],
      ["U02-CONF", "bioburden", H(139), "not_detected"],
      ["U01-CONF", "sterility", H(355), "detected"],
      ["U02-CONF", "sterility", H(355), "not_detected"],
    ]);
  });

  it("Given the topology When the log is read Then the inoculations name their seed lots and the medium additions their lots, at 1 h and (ML-2) at 5 h", () => {
    expect(eventsOf(run, "inoculation").map((e) => [e.unit_id, e.t, e.seed_lot_id])).toEqual([["U01", 0, "SL-1"], ["U02", 0, "SL-2"], ["U03", 0, "SL-3"]]);
    expect(processOf(run, "medium_addition")).toEqual([["U01", H(1), "ML-1"], ["U02", H(1), "ML-1"], ["U03", H(1), "ML-3"], ["U01", H(5), "ML-2"]]);
    expect(processOf(run, "equipment_use")).toEqual([]);
  });

  it("Given the DO ramp of 6 h that ends at signal_at When the true DO of U01 is read Then it is the set point 30 up to 11 h, 25 at 14 h, the low alarm 20 at 17 h and stays there until the stop", () => {
    expect(truthAt(run, "U01", "DO", H(11))).toBe(30);
    expect(truthAt(run, "U01", "DO", H(14))).toBe(25);
    expect(truthAt(run, "U01", "DO", H(17))).toBe(20);
    expect(truthAt(run, "U01", "DO", H(18))).toBe(20);
    expect(truthAt(run, "U01", "DO", H(19))).toBe(20);
  });

  it("Given the same ramp for pH (A141, 0.3 below the set point 7.0) When the true pH of U01 is read Then it is 7.0 at 11 h, 6.85 at 14 h and 6.7 at 17 h", () => {
    expect(truthAt(run, "U01", "pH", H(11))).toBe(7);
    expect(truthAt(run, "U01", "pH", H(14))).toBeCloseTo(6.85, 12);
    expect(truthAt(run, "U01", "pH", H(17))).toBeCloseTo(6.7, 12);
  });

  it("Given U02 and U03 are not affected When their series are read Then DO and pH stay at the set points all the way, and the series of U01 ends at the stop", () => {
    for (const unit of ["U02", "U03"]) {
      expect(Array.from(series(run, unit, "DO").truth).every((v) => v === 30)).toBe(true);
      expect(Array.from(series(run, unit, "pH").truth).every((v) => v === 7)).toBe(true);
    }
    expect(series(run, "U01", "DO").n).toBe(H(19) / 60 + 1);
  });
});

describe("FX12e: equipment origin, an affected sibling that signals later (truth side)", () => {
  let run: ScenarioRun;
  beforeAll(() => {
    run = runOfDoc(docOf(fx12e()));
  });

  it("Given TL-1 contaminated from 0 h and used by U01 at 5 h and U02 at 9 h When the script runs Then the onsets are 5 h and 9 h and U03 has none", () => {
    expect(eventsOf(run, "contamination_onset").map((e) => [e.unit_id, e.t, e.origin_kind, e.origin_id])).toEqual([
      ["U01", H(5), "shared_equipment", "TL-1"],
      ["U02", H(9), "shared_equipment", "TL-1"],
    ]);
    expect(processOf(run, "equipment_use")).toEqual([["U01", H(5), "TL-1"], ["U02", H(9), "TL-1"]]);
  });

  it("Given a lag of 12 h When each unit signals Then U01 signals at 17 h and U02 at its own 21 h, and one deviation opens, at the first signal", () => {
    expect(eventsOf(run, "signal_observed").map((e) => [e.unit_id, e.t])).toEqual([["U01", H(17)], ["U02", H(21)]]);
    expect(eventsOf(run, "deviation_opened").map((e) => [e.unit_id, e.t])).toEqual([["U01", H(17)]]);
  });

  it("Given d1 of 2 h When each affected unit stops Then U01 stops at 19 h and U02 at its own signal_at plus d1, 23 h", () => {
    expect(processOf(run, "unit_stopped")).toEqual([["U01", H(19), "-"], ["U02", H(23), "-"]]);
  });

  it("Given the confirm list U01 and U02 When the decision falls at 19 h Then both are drawn at 19 h, U02 still running, and both are detected at 139 h and 355 h", () => {
    expect(eventsOf(run, "confirm_sample_drawn").map((e) => [e.unit_id, e.t])).toEqual([["U01", H(19)], ["U02", H(19)]]);
    expect(eventsOf(run, "confirm_result").map((e) => [e.sample_id, e.test, e.t, e.outcome])).toEqual([
      ["U01-CONF", "bioburden", H(139), "detected"],
      ["U02-CONF", "bioburden", H(139), "detected"],
      ["U01-CONF", "sterility", H(355), "detected"],
      ["U02-CONF", "sterility", H(355), "detected"],
    ]);
  });

  it("Given the second signal When the DO of U02 is read Then its ramp runs 15 h to 21 h and the stop at 23 h ends its series", () => {
    const u02 = series(run, "U02", "DO");
    expect(truthAt(run, "U02", "DO", H(15))).toBe(30);
    expect(truthAt(run, "U02", "DO", H(18))).toBe(25);
    expect(truthAt(run, "U02", "DO", H(21))).toBe(20);
    expect(u02.n).toBe(H(23) / 60 + 1);
  });
});

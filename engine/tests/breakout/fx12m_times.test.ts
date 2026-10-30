import { beforeAll, describe, expect, it } from "vitest";
import type { ScenarioRun } from "../../src/run.ts";
import { H, eventsOf, processOf, runOfDoc } from "./support.ts";
import { docOfM, fx12m } from "./support_m.ts";

// Spec 11.8.4, FX12m: the times of the mycoplasma fixture from the script. Every expected value below was typed from the "Hand-derived truth" row of FX12m before any code: mycoplasma, lag 48 h (A138
// default 2 d), N1 ramp 12 h, d1 2 h, d2 4 h (A176), the nucleic-acid test 1 d (A146), indicator cells 8 d (A145), culture 28 d (A144), horizon 31 d; the layout of FX12a (U01 takes the contaminated
// ML-2 at 5 h). onset 5 h; signal_at 5 + 48 = 53 h (the DO rise runs 41 h to 53 h to its high alarm); decision and stop 55 h; confirming draws at 55 h from U01 and U02; results: nucleic-acid
// 55 + 24 = 79 h, indicator cells 55 + 192 = 247 h, culture 55 + 672 = 727 h (30.3 d). U01: indicator cells and culture detected, nucleic-acid detected in i and not detected in ii; U02: all
// not detected. The sample volumes: nucleic-acid 1 mL (N8, a test design choice), indicator cells 1 mL and culture 10.5 mL (A148, 10.5 mL culture plus 1 mL indicator cell = 11.5 mL).

const series = (run: ScenarioRun, unit: string, signal: string) => {
  const s = run.sensors.find((x) => x.unit_id === unit && x.signal === signal);
  if (!s) throw new Error(`no ${signal} series for ${unit}`);
  return s;
};
/** The true value of a series at an instant of the unit (the first tick is at 0 h and the cadence is 60 s). */
const truthAt = (run: ScenarioRun, unit: string, signal: string, t: number): number => series(run, unit, signal).truth[t / 60] as number;

describe("FX12m-i: mycoplasma through the medium lot ML-2, the nucleic-acid target covers the organism (truth side)", () => {
  let run: ScenarioRun;
  beforeAll(() => {
    run = runOfDoc(docOfM(fx12m({ nat: 1 })));
  });

  it("Given ML-2 contaminated from 0 h and used by U01 at 5 h When the script runs Then the one onset is U01 at 5 h, hidden in the truth log, with the lot as origin and the type mycoplasma", () => {
    expect(eventsOf(run, "contamination_onset")).toEqual([
      { type: "contamination_onset", t: H(5), unit_id: "U01", batch_id: "B-U01", contamination_type: "mycoplasma", origin_kind: "medium_lot", origin_id: "ML-2" },
    ]);
  });

  it("Given an onset at 5 h and a lag of 48 h When the signal is observed Then signal_at is 53 h and it is the high alarm of the DO; the deviation opens at that instant", () => {
    expect(eventsOf(run, "signal_observed")).toEqual([{ type: "signal_observed", t: H(53), unit_id: "U01", batch_id: "B-U01", signal: "DO", limit: "high" }]);
    expect(eventsOf(run, "deviation_opened")).toEqual([{ type: "deviation_opened", t: H(53), deviation_id: "DEV-1", unit_id: "U01", batch_id: "B-U01", trigger: "signal" }]);
  });

  it("Given d1 of 2 h When the first decision falls Then U01 is stopped at 55 h and U02 and U03 are not stopped", () => {
    expect(processOf(run, "unit_stopped")).toEqual([["U01", H(55), "-"]]);
    expect(run.process.byUnit.get("U01")?.harvested_s).toBe(H(55));
  });

  it("Given the DO rise of 12 h that ends at signal_at When the true DO of U01 is read Then it is the set point 30 up to 41 h, 35 at 47 h, the high alarm 40 at 53 h and stays there until the stop at 55 h", () => {
    expect(truthAt(run, "U01", "DO", H(41))).toBe(30);
    expect(truthAt(run, "U01", "DO", H(47))).toBe(35);
    expect(truthAt(run, "U01", "DO", H(53))).toBe(40);
    expect(truthAt(run, "U01", "DO", H(54))).toBe(40);
    expect(truthAt(run, "U01", "DO", H(55))).toBe(40);
    expect(series(run, "U01", "DO").n).toBe(H(55) / 60 + 1);
  });

  it("Given mycoplasma has no pH signal (A140: little base is needed) When the true pH of U01 is read Then it stays at the set point 7 all the way", () => {
    expect(Array.from(series(run, "U01", "pH").truth).every((v) => v === 7)).toBe(true);
  });

  it("Given U02 and U03 are not affected When their DO is read Then it stays at the set point 30 all the way", () => {
    for (const unit of ["U02", "U03"]) expect(Array.from(series(run, unit, "DO").truth).every((v) => v === 30)).toBe(true);
  });

  it("Given the confirm list U01 and U02 When the decision falls at 55 h Then one confirming sample per unit is drawn at 55 h, 12.5 mL in three aliquots in the order nucleic-acid, indicator cells, culture", () => {
    const drawn = eventsOf(run, "confirm_sample_drawn");
    expect(drawn.map((e) => [e.sample_id, e.unit_id, e.t, e.volume_ul])).toEqual([
      ["U01-CONF", "U01", H(55), 12_500],
      ["U02-CONF", "U02", H(55), 12_500],
    ]);
    expect(drawn[0]?.tests).toEqual([
      { aliquot_id: "U01-CONF-A1", test: "nucleic_acid_test", volume_ul: 1000 },
      { aliquot_id: "U01-CONF-A2", test: "mycoplasma_indicator_cells", volume_ul: 1000 },
      { aliquot_id: "U01-CONF-A3", test: "mycoplasma_culture", volume_ul: 10_500 },
    ]);
    expect(drawn.every((e) => /^OP-0[1-4]$/.test(e.operator_id))).toBe(true);
  });

  it("Given 1 d, 8 d and 28 d When the results arrive Then they arrive at 79 h, 247 h and 727 h; U01 is detected in all three, U02 in none", () => {
    expect(eventsOf(run, "confirm_result").map((e) => [e.sample_id, e.test, e.t, e.outcome])).toEqual([
      ["U01-CONF", "nucleic_acid_test", H(79), "detected"],
      ["U02-CONF", "nucleic_acid_test", H(79), "not_detected"],
      ["U01-CONF", "mycoplasma_indicator_cells", H(247), "detected"],
      ["U02-CONF", "mycoplasma_indicator_cells", H(247), "not_detected"],
      ["U01-CONF", "mycoplasma_culture", H(727), "detected"],
      ["U02-CONF", "mycoplasma_culture", H(727), "not_detected"],
    ]);
  });

  it("Given the topology When the log is read Then the inoculations name their seed lots and the medium additions their lots, as in FX12a", () => {
    expect(eventsOf(run, "inoculation").map((e) => [e.unit_id, e.t, e.seed_lot_id])).toEqual([["U01", 0, "SL-1"], ["U02", 0, "SL-2"], ["U03", 0, "SL-3"]]);
    expect(processOf(run, "medium_addition")).toEqual([["U01", H(1), "ML-1"], ["U02", H(1), "ML-1"], ["U03", H(1), "ML-3"], ["U01", H(5), "ML-2"]]);
  });

  it("Given the 31 d horizon When the last result is read Then no result is open at the end of the run: the culture result at 727 h (30.3 d) is inside it", () => {
    const last = Math.max(...eventsOf(run, "confirm_result").map((e) => e.t));
    expect(last).toBe(H(727));
    expect(last).toBeLessThanOrEqual(31 * 86400);
    expect(last).toBeGreaterThan(30 * 86400);
  });
});

describe("FX12m-ii: the nucleic-acid target does not cover the organism", () => {
  it("Given the input of A224 at 0 When the results arrive Then the nucleic-acid result of U01 is not detected at 79 h, and the indicator cells and the culture of U01 are detected as before", () => {
    const run = runOfDoc(docOfM(fx12m({ nat: 0 })));
    expect(eventsOf(run, "confirm_result").map((e) => [e.sample_id, e.test, e.t, e.outcome])).toEqual([
      ["U01-CONF", "nucleic_acid_test", H(79), "not_detected"],
      ["U02-CONF", "nucleic_acid_test", H(79), "not_detected"],
      ["U01-CONF", "mycoplasma_indicator_cells", H(247), "detected"],
      ["U02-CONF", "mycoplasma_indicator_cells", H(247), "not_detected"],
      ["U01-CONF", "mycoplasma_culture", H(727), "detected"],
      ["U02-CONF", "mycoplasma_culture", H(727), "not_detected"],
    ]);
  });

  it("Given the input of A224 changes When the run repeats Then every time of the script is the same (the input decides an outcome, never an instant)", () => {
    const times = (nat: 0 | 1) => runOfDoc(docOfM(fx12m({ nat }))).events.filter((e) => ["contamination_onset", "signal_observed", "deviation_opened", "confirm_sample_drawn", "confirm_result"].includes(e.type)).map((e) => [e.type, e.t]);
    expect(times(0)).toEqual(times(1));
  });
});

import { describe, expect, it } from "vitest";
import { bridgingOffset, lotOffset } from "../src/record/evidence.ts";
import type { RecordedDataset } from "../src/record/types.ts";
import { BASE, byTime, calibration, inoculation, sampleWithRun } from "./support/cell_stream.ts";
import { CONFIGS, run } from "./support/cells.ts";
import type { CellRow } from "./support/cells.ts";

// SC4 New lot on AN-2 (spec 7): when does an instrument effect look like a process effect? Noise-free fixtures (test-only values, binary-exact so that the
// offset can be compared exactly), a bias of +0.5 on AN-2 only. Bay 1 (U1) is habitually measured on AN-1 and bay 2 (U2) on AN-2 (A034). Two aliquots of one
// control material, CTL-1 (true value 4.0), form the bridging pair (`control_id`). Two causes of the same bias, with different evidence (spec "Notes from S2c1"):
//   between analyzers  AN-2 reads +0.5 throughout. The pair is measured one on each analyzer; the analyzer name (free text) tells them apart.
//   a lot step         AN-2 reads +0.5 from a new reagent lot at 3000. The pair is measured on AN-2 before and after; only the link from the run to the
//                      instrument state (instrument_state_snapshot) says which lot a run used.
//   true values        bay 1: S1 4.0, S2 6.0 (mean 5.0)    bay 2: S3 4.0, S4 5.0 (mean 4.5)    true group effect, bay 2 minus bay 1: -0.5
//   recorded           bay 2 reads S3 4.5, S4 5.5 (mean 5.0): recorded effect 0.0, the bias hides the real difference (instrument effect read as process effect).
// The reference to the independent truth is the hand-typed table below, never the recorder's output.

const TRUE: Record<string, number> = { S1: 4.0, S2: 6.0, S3: 4.0, S4: 5.0 };
const BIAS = 0.5;
const TRUE_EFFECT = -0.5;

const BETWEEN: CellRow = {
  events: byTime([
    ...BASE, calibration("AN-2"), inoculation("U1"), inoculation("U2"),
    ...sampleWithRun("S1", "U1", 1000, 500, 4.0, { analyzer: "AN-1" }), ...sampleWithRun("S2", "U1", 2000, 500, 6.0, { analyzer: "AN-1" }),
    ...sampleWithRun("S3", "U2", 3000, 500, 4.5, { analyzer: "AN-2" }), ...sampleWithRun("S4", "U2", 4000, 500, 5.5, { analyzer: "AN-2" }),
    ...sampleWithRun("B1", "U1", 5000, 500, 4.0, { analyzer: "AN-1" }), ...sampleWithRun("B2", "U1", 5001, 500, 4.5, { analyzer: "AN-2" }),
  ]),
  plan: { controls: { B1: "CTL-1", B2: "CTL-1" } },
  rules: {},
  realised: () => true,
  evidence: () => [],
};

/** AN-2 gets a new reagent lot at 3000 (a second calibration record carrying LOT-2); everything measured on it from then on reads +0.5. */
const LOT_STEP: CellRow = {
  events: byTime([
    ...BASE, calibration("AN-2"), calibration("AN-2", 3000, "LOT-2"), inoculation("U1"), inoculation("U2"),
    ...sampleWithRun("B1", "U2", 1000, 500, 4.0, { analyzer: "AN-2" }), ...sampleWithRun("B2", "U2", 3500, 500, 4.5, { analyzer: "AN-2" }),
    ...sampleWithRun("S1", "U1", 4000, 500, 4.0, { analyzer: "AN-1" }), ...sampleWithRun("S2", "U1", 5000, 500, 6.0, { analyzer: "AN-1" }),
    ...sampleWithRun("S3", "U2", 6000, 500, 4.5, { analyzer: "AN-2" }), ...sampleWithRun("S4", "U2", 7000, 500, 5.5, { analyzer: "AN-2" }),
  ]),
  plan: { controls: { B1: "CTL-1", B2: "CTL-1" } },
  rules: {},
  realised: () => true,
  evidence: () => [],
};

const ds = (row: CellRow, name: string): RecordedDataset => run(row, (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config).ds;
const NAMES = CONFIGS.map((c) => c.name);
const WITH_LINK = CONFIGS.filter((c) => c.config.flags.instrument_state_snapshot).map((c) => c.name);
const WITHOUT_LINK = ["A", "B", "C-instrument_state_snapshot"];

/** Mean of the recorded values of the ordinary samples of one bay, with an optional per-run correction. */
const bayMean = (d: RecordedDataset, unit: string, shift: (runId: string) => number): number => {
  const rows = d.result.filter((r) => r.analyte === "glucose" && d.sample.some((s) => s.sample_id === r.request_id && s.unit_id === unit && r.request_id in TRUE));
  return rows.reduce((sum, r) => sum + r.value - shift(r.run_id), 0) / rows.length;
};
const groupEffect = (d: RecordedDataset, shift: (runId: string) => number = () => 0): number => bayMean(d, "U2", shift) - bayMean(d, "U1", shift);

/** The bridging correction between analyzers: every result of the analyzer that the control pair shows to be offset is moved back by the recovered offset. */
const analyzerCorrection = (d: RecordedDataset): ((runId: string) => number) => {
  const offset = bridgingOffset(d, "CTL-1");
  const analyzer = new Map(d.run.map((r) => [r.run_id, r.analyzer_name]));
  return (runId) => (offset !== null && analyzer.get(runId) === offset.other_analyzer ? offset.offset : 0);
};

/** The bridging correction for a lot step: every result of the instrument state that the control pair shows to be offset is moved back by the recovered offset. */
const lotCorrection = (d: RecordedDataset): ((runId: string) => number) => {
  const offset = lotOffset(d, "CTL-1");
  const state = new Map(d.run.map((r) => [r.run_id, r.instrument_state_id]));
  return (runId) => (offset !== null && state.get(runId) === offset.other_state ? offset.offset : 0);
};

describe("SC4 new lot on AN-2: a bias between analyzers", () => {
  it("Given the noise-free fixture When it is recorded Then AN-1 results equal the true values and AN-2 results exceed them by exactly the injected bias (0.5)", () => {
    const d = ds(BETWEEN, "C");
    const analyzer = new Map(d.run.map((r) => [r.run_id, r.analyzer_name]));
    for (const r of d.result.filter((x) => x.request_id in TRUE)) expect(r.value - (analyzer.get(r.run_id) === "AN-2" ? BIAS : 0), r.request_id).toBe(TRUE[r.request_id]);
  });

  it.each(NAMES)("Given %s Then the bias enters the group effect: recorded 0.0 where the truth is -0.5, a phantom of exactly 0.5", (name) => {
    expect(groupEffect(ds(BETWEEN, name))).toBe(0);
    expect(groupEffect(ds(BETWEEN, name)) - TRUE_EFFECT).toBe(BIAS);
  });

  it.each(NAMES)("Given %s When the control pair is compared Then the recovered offset equals the injected bias exactly (0.5): the analyzer name suffices, the instrument-state link is not needed", (name) => {
    expect(bridgingOffset(ds(BETWEEN, name), "CTL-1")).toMatchObject({ reference_analyzer: "AN-1", other_analyzer: "AN-2", offset: BIAS });
  });

  it.each(NAMES)("Given %s and the bridging correction When AN-2's results are moved back by the recovered offset Then the group effect equals the true effect, -0.5, exactly", (name) => {
    const d = ds(BETWEEN, name);
    expect(groupEffect(d, analyzerCorrection(d))).toBe(TRUE_EFFECT);
  });
});

describe("SC4 new lot on AN-2: a reagent lot step on AN-2", () => {
  it("Given the noise-free fixture When it is recorded Then results on AN-2 after the step exceed the true values by exactly the injected step (0.5) and every other result equals its true value", () => {
    const d = ds(LOT_STEP, "C");
    const late = new Set(["S3", "S4", "B2"]);
    for (const r of d.result.filter((x) => x.request_id in TRUE || x.request_id.startsWith("B"))) {
      const truth = r.request_id === "B1" || r.request_id === "B2" ? 4.0 : (TRUE[r.request_id] as number);
      expect(r.value - (late.has(r.request_id) ? BIAS : 0), r.request_id).toBe(truth);
    }
  });

  it.each(WITHOUT_LINK)("Given %s (records without an instrument link) Then the step enters the group effect (recorded 0.0, truth -0.5), no lot is named and nothing can be corrected", (name) => {
    const d = ds(LOT_STEP, name);
    expect(d.run.every((r) => r.instrument_state_id === null)).toBe(true);
    expect(lotOffset(d, "CTL-1")).toBeNull();
    expect(groupEffect(d, lotCorrection(d))).toBe(0);
    expect(groupEffect(d, lotCorrection(d)) - TRUE_EFFECT).toBe(BIAS);
  });

  it.each(WITH_LINK)("Given %s (instrument_state_snapshot on) When the control pair is compared across the step Then the recovered offset equals the injected step exactly: 0.5 between LOT-1 and LOT-2", (name) => {
    expect(lotOffset(ds(LOT_STEP, name), "CTL-1")).toMatchObject({ reference_lot: "LOT-1", other_lot: "LOT-2", offset: BIAS });
  });

  it("Given C and the bridging correction When the results of the new lot are moved back by the recovered offset Then the group effect equals the true effect, -0.5, exactly", () => {
    const c = ds(LOT_STEP, "C");
    expect(groupEffect(c, lotCorrection(c))).toBe(TRUE_EFFECT);
  });

  it("Given C minus instrument_state_snapshot When the same correction is attempted Then the phantom effect of 0.5 is back: the ablation restores the effect", () => {
    const d = ds(LOT_STEP, "C-instrument_state_snapshot");
    expect(groupEffect(d, lotCorrection(d)) - TRUE_EFFECT).toBe(BIAS);
  });
});

import { describe, expect, it } from "vitest";
import { breakoutMetrics } from "../../src/evaluate/breakout_metrics.ts";
import { breakoutTruth } from "../../src/evaluate/breakout_truth.ts";
import type { Truth } from "../../src/evaluate/truth.ts";
import { FX12A, FX12A_MASTER, FX12E, FX12E_MASTER, H, routine } from "../support/breakout_streams.ts";
import { emptyKey, truthOf } from "../support/breakout_truth_setup.ts";
import type { Onset } from "../support/breakout_truth_setup.ts";
import { FX12M_I, FX12M_MASTER } from "../support/fx12m_streams.ts";
import { byTime } from "../support/cell_stream.ts";
import { run } from "../support/investigate_setup.ts";

// `T`, the set of items the event touched (spec 11.6, rule S10), on the hand-built fixtures of 11.8.4. The expected sets and universe sizes are typed from the "Hand-derived truth" rows and from the
// text of the false-alarm rows ("universe: 6 lots, 2 other batches, 6 results = 14, of which 13 not in T"). A result is `<request>/<analyte>`; the routine analyte of the fixtures is glucose.

const FX12A_ONSET: Onset[] = [{ unit: "U01", hours: 5, kind: "medium_lot", origin: "ML-2" }];
const FX12E_ONSETS: Onset[] = [{ unit: "U01", hours: 5, kind: "shared_equipment", origin: "TL-1" }, { unit: "U02", hours: 9, kind: "shared_equipment", origin: "TL-1" }];
const g = (...samples: string[]): string[] => samples.map((s) => `result:${s}/glucose`);
const keysOf = (t: ReturnType<typeof breakoutTruth>, d: 1 | 3): string[] => [...t.touched].filter(([, x]) => x.direction === d).map(([k]) => k).sort();

describe("T, the truth of what the event touched", () => {
  it("Given FX12a When T is computed Then direction 1 is B-U01 with U01-S2 and U01-S3 (U01-S1 at 3 h is before the onset at 5 h) and direction 3 is the lot ML-2", () => {
    const t = breakoutTruth(truthOf(FX12A, FX12A_MASTER, FX12A_ONSET));
    expect(t.signal).toEqual({ unit_id: "U01", batch_id: "B-U01", at: H(17) });
    expect(keysOf(t, 1)).toEqual(["batch:B-U01", ...g("U01-S2", "U01-S3")].sort());
    expect(keysOf(t, 3)).toEqual(["material_lot:ML-2"]);
    expect([t.universe[1].size, t.universe[3].size]).toEqual([4, 14]);
  });

  it("Given FX12e When T is computed Then direction 3 holds TL-1, B-U02 and U02-S2 to U02-S4 (U02-S1 at 4 h is before its onset at 9 h) and its universe has 16 items", () => {
    const t = breakoutTruth(truthOf(FX12E, FX12E_MASTER, FX12E_ONSETS));
    expect(keysOf(t, 1)).toEqual(["batch:B-U01", ...g("U01-S2", "U01-S3")].sort());
    expect(keysOf(t, 3)).toEqual(["equipment:TL-1", "batch:B-U02", ...g("U02-S2", "U02-S3", "U02-S4")].sort());
    expect([t.universe[1].size, t.universe[3].size]).toEqual([4, 16]);
  });

  it("Given FX12m When T is computed Then direction 1 holds B-U01 and U01-S2 to U01-S4 and the universe of direction 3 has 16 items", () => {
    const t = breakoutTruth(truthOf(FX12M_I, FX12M_MASTER, FX12A_ONSET, "mycoplasma"));
    expect(keysOf(t, 1)).toEqual(["batch:B-U01", ...g("U01-S2", "U01-S3", "U01-S4")].sort());
    expect(keysOf(t, 3)).toEqual(["material_lot:ML-2"]);
    expect([t.universe[1].size, t.universe[3].size]).toEqual([5, 16]);
  });

  it("Given FX12e When the items are classed by what is in hand at the first signal at 17 h Then B-U01, B-U02 and TL-1 are in hand and no result is (U02-S3 is released at 17 h itself, U02-S4 is not drawn yet)", () => {
    const t = breakoutTruth(truthOf(FX12E, FX12E_MASTER, FX12E_ONSETS));
    expect([...t.touched].filter(([, x]) => x.in_hand).map(([k]) => k).sort()).toEqual(["batch:B-U01", "batch:B-U02", "equipment:TL-1"]);
  });

  it("Given the record holds U01-S2 under the label of U01-S1 (a label error) When T is computed with that map Then the result is keyed by the id the record holds it under", () => {
    const t = breakoutTruth(truthOf(FX12A, FX12A_MASTER, FX12A_ONSET), (s) => (s === "U01-S2" ? "U01-S1" : s));
    expect(keysOf(t, 1)).toEqual(["batch:B-U01", ...g("U01-S1", "U01-S3")].sort());
  });

  it("Given a sampling origin at the draw U01-S2 When T is computed Then the sample of that draw is taken before the organism enters and is not in T, and no lot or item is", () => {
    const t = breakoutTruth(truthOf(FX12A, FX12A_MASTER, [{ unit: "U01", hours: 8, kind: "sampling", origin: "U01-S2" }]));
    expect(keysOf(t, 1)).toEqual(["batch:B-U01", ...g("U01-S3")].sort());
    expect(keysOf(t, 3)).toEqual([]);
  });

  it("Given a truth without the topology, or without an onset, When T is computed Then it refuses, naming what is missing", () => {
    const bare: Truth = { ...truthOf(FX12A, FX12A_MASTER, FX12A_ONSET) };
    delete bare.breakout;
    expect(() => breakoutTruth(bare)).toThrow(/no topology/);
    expect(() => breakoutTruth(truthOf(FX12A, FX12A_MASTER, []))).toThrow(/no contamination onset/);
  });
});

describe("The extension metrics: zero denominators and the edges of a definition", () => {
  const inv = (events = FX12A) => run(events, FX12A_MASTER, "A");

  it("Given direction 3 returns nothing (A) When precision is read Then the denominator is zero and the value is null, never 0 or 1", () => {
    const m = breakoutMetrics({ truth: truthOf(FX12A, FX12A_MASTER, FX12A_ONSET), investigation: inv(), key_text: emptyKey("A"), architecture: "A" });
    expect(m.identification.direction_3.precision).toMatchObject({ num: 0, den: 0, value: null });
    expect(m.identification.direction_3.recall).toMatchObject({ num: 0, den: 1, value: 0 });
  });

  it("Given no result of T is in hand at the first signal When the containment of results is read Then the share has a zero denominator and no median", () => {
    const m = breakoutMetrics({ truth: truthOf(FX12A, FX12A_MASTER, FX12A_ONSET), investigation: inv(), key_text: emptyKey("A"), architecture: "A" });
    expect(m.containment.result.contained).toMatchObject({ num: 0, den: 0, value: null });
    expect([m.containment.result.median_s, m.containment.result.p90_s]).toEqual([null, null]);
  });

  it("Given two held batches at 2 h and 6 h (FX12e under A) When the time to containment is read Then the median and the p90 are over the held items only (nearest rank: 2 h and 6 h)", () => {
    const m = breakoutMetrics({ truth: truthOf(FX12E, FX12E_MASTER, FX12E_ONSETS), investigation: run(FX12E, FX12E_MASTER, "A"), key_text: emptyKey("A"), architecture: "A" });
    expect(m.containment.batch).toMatchObject({ median_s: H(2), p90_s: H(6), times_s: [H(2), H(6)] });
    expect(m.containment.batch.contained).toMatchObject({ num: 2, den: 2, value: 1 });
  });

  it("Given U01 draws one more sample at 18.5 h, after the signal, whose result arrives at 19.5 h, after the decision at 19 h (FX12a under C) Then T holds it, the walk-back cannot see it, and it is never held", () => {
    // typed by hand: S4 is drawn at or after the onset (5 h), so it is in T (4 results of direction 1 with the batch); its run starts 55 min after the draw and is measured at 19.5 h, so the record
    // does not hold it at 19 h: direction 1 returns the batch, S2 and S3 (3 of 4, precision 3 of 3). Never held, and released at 19.5 h, it stands released before containment: 3 of 3 results of T;
    // no retro-flag version is made for it, so completeness is 2 of 3 (S2 and S3).
    const events = byTime([...FX12A, ...routine("U01", 4, 18.5)]);
    const m = breakoutMetrics({ truth: truthOf(events, FX12A_MASTER, FX12A_ONSET), investigation: run(events, FX12A_MASTER, "C"), key_text: emptyKey("C"), architecture: "C" });
    const pair = (r: { num: number; den: number }) => [r.num, r.den];
    expect([pair(m.identification.direction_1.recall), pair(m.identification.direction_1.precision), pair(m.identification.direction_1.false_alarm)]).toEqual([[3, 4], [3, 3], [0, 1]]);
    expect([pair(m.released_before_containment), pair(m.retro_flag_completeness)]).toEqual([[3, 3], [2, 3]]);
    expect(pair(m.containment.result.contained)).toEqual([0, 0]);
  });

  it("Given U01 draws one more sample at 18 h whose result is released at 19 h, the instant of the hold (FX12a under C) Then it stood released before the hold was placed (C25: the review of an instant runs first) and it is flagged", () => {
    // typed by hand: S4 (drawn 18 h, released 19 h) is in T and its result is known at the decision at 19 h, so direction 1 returns it (4 of 4); the truth released it at 19 h, not after the hold
    // at 19 h, so it counts as released before containment (3 of 3 results of T); VR-022 fires on it at 19 h like on S2 and S3, so completeness is 3 of 3.
    const events = byTime([...FX12A, ...routine("U01", 4, 18)]);
    const m = breakoutMetrics({ truth: truthOf(events, FX12A_MASTER, FX12A_ONSET), investigation: run(events, FX12A_MASTER, "C"), key_text: emptyKey("C"), architecture: "C" });
    const pair = (r: { num: number; den: number }) => [r.num, r.den];
    expect(pair(m.identification.direction_1.recall)).toEqual([4, 4]);
    expect([pair(m.released_before_containment), pair(m.retro_flag_completeness)]).toEqual([[3, 3], [3, 3]]);
  });

  it("Given the investigation made no walk-back When the metrics are read Then it refuses", () => {
    expect(() => breakoutMetrics({ truth: truthOf(FX12A, FX12A_MASTER, FX12A_ONSET), investigation: { ...inv(), walks: [] }, key_text: emptyKey("A"), architecture: "A" })).toThrow(/no walk-back/);
  });
});

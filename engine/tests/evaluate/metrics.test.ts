import { describe, expect, it } from "vitest";
import { parseKey } from "../../src/evaluate/answer_key.ts";
import { detection } from "../../src/evaluate/detection.ts";
import { phantomEffect } from "../../src/evaluate/effects.ts";
import { evaluate } from "../../src/evaluate/evaluate.ts";
import { truthFrom } from "../../src/evaluate/truth.ts";
import type { Truth } from "../../src/evaluate/truth.ts";
import { utilisation } from "../../src/evaluate/utilisation.ts";
import { keyFile } from "../../src/experiments/assembly/key_file.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { Event } from "../../src/generated/event.schema";
import type { MaterialisedError } from "../../src/inject/types.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { readJson } from "../support/paths.ts";
import { A, CONFIG, WORLD, emptyDataset, seedInput } from "../support/eval_fixture.ts";

// S2b Step 3: every metric of spec section 8, with its denominator, against the hand-built world of eval_fixture.ts. All expected numbers are
// derived by hand from that file's header; none is read back from the evaluator. Architecture A has no flag; C has all ten (the ninth and tenth are read by nothing here).

const out = runSeed(seedInput());
const [cellA, cellC] = out.cells as [(typeof out.cells)[number], (typeof out.cells)[number]];
const mA = cellA.metrics;
const mC = cellC.metrics;
const r = (num: number, den: number) => expect.objectContaining({ num, den, value: den === 0 ? null : num / den });

describe("Hand world: four analysis requests (three drawn, one draw refused by the volume budget)", () => {
  it("Given the world Then every cell counts four requests, the refused draw included", () => {
    expect([cellA.n_requests, cellC.n_requests]).toEqual([4, 4]);
    expect([cellA.architecture, cellC.architecture, cellA.seed, cellA.scenario_id]).toEqual(["A", "C", 7, "hand"]);
  });
});

describe("Holding time and turnaround (truth quantities, identical in every architecture)", () => {
  // hold_time = run_started_at - true sampled_at: S1 1500-1100 = 400, S2 6000-5000 = 1000, S3 9500-9100 = 400; S4 never started.
  // nearest rank: median of [400, 400, 1000] is the 2nd = 400, p90 is the 3rd = 1000. SLA 600 s: S2 (1000) and the never-started S4 exceed: 2 of 4.
  it("Then 3 of 4 requests started, median 400 s, p90 1000 s, and 2 of 4 exceed 600 s", () => {
    expect(mA.holding_time).toMatchObject({ started: r(3, 4), median_s: 400, p90_s: 1000, sla_threshold_s: 600, sla_exceedance: r(2, 4) });
    expect(mC.holding_time).toEqual(mA.holding_time);
  });
  // turnaround = release - true sampled_at: S1 2000-1100 = 900, S2 9000-5000 = 4000 (the QC-failed first run does not release), S3 10000-9100 = 900.
  it("Then 3 of 4 requests were released, median 900 s, p90 4000 s", () => {
    expect(mA.turnaround).toMatchObject({ released: r(3, 4), median_s: 900, p90_s: 4000 });
    expect(mC.turnaround).toEqual(mA.turnaround);
  });
  it("Then the denominators are written in words", () => {
    expect(mA.holding_time.started.denominator).toMatch(/all analysis requests/);
    expect(mA.holding_time.sla_exceedance.denominator).toMatch(/never started/);
  });
});

describe("Utilisation is returned twice, each with and without setup", () => {
  it("Given the F5 hand fixture (3600 s busy, 1800 s productive on one analyzer) in a 36000 s window Then per staffed window 0.1 and 0.05, per 24 h 3600/86400 and 1800/86400", () => {
    const f5 = readJson<{ cases: { expected: { runs: { request_id: string; attempt: number; visit: number; analyzer: string; setup_s: number; start_s: number; end_s: number }[] } }[] }>("tests", "fixtures", "hand", "F5_setup_change.json").cases[0];
    const events = (f5?.expected.runs ?? []).flatMap((x): Event[] => {
      const ids = { request_id: x.request_id, attempt: x.attempt, visit: x.visit, analyzer: x.analyzer };
      return [
        { type: "visit_started", t: x.start_s - x.setup_s, ...ids, setup_s: x.setup_s },
        { type: "run_started", t: x.start_s, ...ids },
        { type: "visit_finished", t: x.end_s, ...ids },
      ];
    });
    const u = utilisation(events, { analyzers: 1, days: 1, staffed_window_s: 36000 });
    expect(u.per_staffed_window.with_setup).toMatchObject({ num: 3600, den: 36000, value: 0.1 });
    expect(u.per_staffed_window.without_setup).toMatchObject({ num: 1800, den: 36000, value: 0.05 });
    expect(u.per_24h.with_setup).toMatchObject({ num: 3600, den: 86400, value: 3600 / 86400 });
    expect(u.per_24h.without_setup).toMatchObject({ num: 1800, den: 86400, value: 1800 / 86400 });
    expect(u.per_staffed_window.with_setup.denominator).toMatch(/setup time counts/);
    expect(u.per_staffed_window.without_setup.denominator).toMatch(/does not count/);
  });
  it("Given the hand world (four visits of 500 s, no setup, one analyzer, one day) Then 2000 s over 36000 s and over 86400 s, with and without setup alike", () => {
    expect(mA.utilisation.per_staffed_window.with_setup).toMatchObject({ num: 2000, den: 36000 });
    expect(mA.utilisation.per_staffed_window.without_setup).toMatchObject({ num: 2000, den: 36000 });
    expect(mA.utilisation.per_24h.with_setup).toMatchObject({ num: 2000, den: 86400 });
  });
});

describe("Availability before the decision deadline (as-of read, truth release, leakage kept apart)", () => {
  // A sees rows as of now: S1 (decided at 1800, released 2000) and S2 (7000, released 9000) are shown early, S3 (36000, released 10000) is rightly there.
  it("Given A (no available_at) Then 1 of 4 is available and 2 of 4 are shown although the truth world had not released them", () => {
    expect(mA.availability).toMatchObject({ available: r(1, 4), leaked: r(2, 4) });
  });
  // C hides S1 until 2000. The first S2 run (6500, QC failed) is held by VR-012 and rejected at review, and the rerun (9000, hold 3500 s) by VR-010: S2 is never shown.
  // Before the review step and VR-012 the failed first attempt was visible at 7000 and leaked (1 of 4); now nothing leaks.
  it("Given C (available_at) Then 1 of 4 is available (S3) and none leaks: the failed S2 result is rejected, no longer shown", () => {
    expect(mC.availability).toMatchObject({ available: r(1, 4), leaked: r(0, 4) });
  });
});

/** The metrics of the hand world evaluated on a dataset typed by hand (the dataset does not come from a recorder), against the key of `architecture`. */
const runSeedOn = (ds: RecordedDataset, architecture = "C") => evaluate({ truth: WORLD, dataset: ds, not_evaluable: [], key_text: out.key_text, architecture, config: CONFIG }).metrics;
const copyOf = (id: "A" | "C"): RecordedDataset => structuredClone({ ...(out.datasets[id] as RecordedDataset), historian: { series: [], late: [] } });

describe("Misattribution (recorded unit or batch against truth)", () => {
  // C has no result for S2 since the review step: its failed first attempt (VR-012) and its late rerun (VR-010) are both rejected. A overwrote the failed attempt and has no VR-010.
  it("Given no injected error Then 0 of 4 are misattributed or unattributed; 1 of 4 (the refused draw) has no result in A, 2 of 4 in C (S2 is rejected)", () => {
    expect(mA.misattribution).toMatchObject({ misattributed: r(0, 4), unattributed: r(0, 4), no_result: r(1, 4) });
    expect(mC.misattribution).toMatchObject({ misattributed: r(0, 4), unattributed: r(0, 4), no_result: r(2, 4) });
  });
  // S2 was the sample typed here before the review step; in C it has no result now (both attempts rejected), so a wrong unit on it cannot be read. S1 takes its place.
  it("Given S1 recorded on unit U2 (typed by hand) Then 1 of 4 is misattributed and S1 is no longer reconstructed exactly: 1 of 4 remains exact (S3)", () => {
    const ds = copyOf("C");
    (ds.sample.find((s) => s.sample_id === "S1") as { unit_id: string }).unit_id = "U2";
    const m = runSeedOn(ds);
    expect(m.misattribution).toMatchObject({ misattributed: r(1, 4), unattributed: r(0, 4), no_result: r(2, 4) });
    expect(m.exact_reconstruction).toMatchObject(r(1, 4));
  });
  it("Given no batch open on U1 at the stored time in A (keys derived by a time join) Then S1 and S2 are unattributed, not misattributed", () => {
    const ds = copyOf("A");
    ds.batch = ds.batch.map((b) => (b.unit_id === "U1" ? { ...b, inoculated_at: 99999 } : b));
    expect(runSeedOn(ds, "A").misattribution).toMatchObject({ misattributed: r(0, 4), unattributed: r(2, 4), no_result: r(1, 4) });
  });
  it("Given a forced label error that makes S3 read 'S3?' (no such sample) in A Then S3 is unattributed: its results sit under an id with no sample row", () => {
    const forced = runSeed(seedInput({ architectures: [A], forced: [{ type: "label_error", sample_id: "S3", detail: { as_id: "S3?" } }] }));
    expect((forced.cells[0] as (typeof out.cells)[number]).metrics.misattribution).toMatchObject({ misattributed: r(0, 4), unattributed: r(1, 4), no_result: r(1, 4) });
  });
  it("Given a forced label error that makes S1 read 'S3' (another sample, on unit U2) in A Then S1 is misattributed: the typo that matches another request is the silent case", () => {
    const forced = runSeed(seedInput({ architectures: [A], forced: [{ type: "label_error", sample_id: "S1", detail: { as_id: "S3" } }] }));
    expect((forced.cells[0] as (typeof out.cells)[number]).metrics.misattribution).toMatchObject({ misattributed: r(1, 4), unattributed: r(0, 4), no_result: r(1, 4) });
  });
});

describe("Exact reconstruction (unit, batch, sampled_at, process context at the draw, instrument state; unanswerable counts as wrong)", () => {
  // A stores no sampled_at and no instrument link: nothing is answerable. C: S1 and S3 match truth on all five; S4 has no result and S2 has none either
  // (the failed first attempt is rejected by VR-012 and the late rerun by VR-010 at review; before the review step the read fell back to the failed attempt: 3 of 4).
  it("Given A Then 0 of 4; given C Then 2 of 4", () => {
    expect(mA.exact_reconstruction).toMatchObject(r(0, 4));
    expect(mC.exact_reconstruction).toMatchObject(r(2, 4));
  });
  it("Given C with the S3 sampled_at removed Then S3 is unanswerable and counts as wrong: 1 of 4 (S1)", () => {
    const ds = copyOf("C");
    (ds.sample.find((s) => s.sample_id === "S3") as { sampled_at: number | null }).sampled_at = null;
    expect(runSeedOn(ds).exact_reconstruction).toMatchObject(r(1, 4));
  });
  it("Given C with the instrument link of S1 removed Then S1 is unanswerable: 1 of 4 (S3)", () => {
    const ds = copyOf("C");
    (ds.run.find((x) => x.run_id === "S1/1/1") as { instrument_state_id: string | null }).instrument_state_id = null;
    expect(runSeedOn(ds).exact_reconstruction).toMatchObject(r(1, 4));
  });
});

describe("Alignment error (seconds between the time the join used and the true sampled_at)", () => {
  // A joins by the measured time: S1 |2000-1100| = 900, S2 |9000-5000| = 4000 (the rerun overwrote the first row), S3 |10000-9100| = 900.
  // The feed at 1200 lies between the draw and the join of S1: its context carries one feed too many; S2 and S3 match.
  it("Given A Then 3 of 4 are joined, median 900 s, p90 4000 s, and 1 of 4 has a wrong process context", () => {
    expect(mA.alignment_error).toMatchObject({ joined: r(3, 4), median_s: 900, p90_s: 4000, context_mismatch: r(1, 4) });
  });
  // C joins S1 and S3; S2 has no result (rejected at review), S4 none.
  it("Given C (sampled_at stored) Then the join error is zero for the 2 joined requests and no context is wrong", () => {
    expect(mC.alignment_error).toMatchObject({ joined: r(2, 4), median_s: 0, p90_s: 0, context_mismatch: r(0, 4) });
  });
});

describe("Rerun traceability (original and link recoverable; one request, S2, had a rerun)", () => {
  it("Given A (overwrite in place) Then the first value 3.2 is gone: 0 of 1", () => {
    expect(mA.rerun_traceability).toMatchObject({ num: 0, den: 1, value: 0 });
  });
  it("Given C (versions) Then version 1 holds 3.2 and version 2 supersedes it: 1 of 1", () => {
    expect(mC.rerun_traceability).toMatchObject({ num: 1, den: 1, value: 1 });
  });
});

describe("Attributable rate (operator and qualification present and correct)", () => {
  it("Given A (no audit trail) Then 0 of 4; given C with the qualifications of OP-1 (experienced) and OP-2 (trainee) Then 3 of 4 (the refused draw has no sampler)", () => {
    expect(mA.attributable).toMatchObject(r(0, 4));
    expect(mC.attributable).toMatchObject(r(3, 4));
  });
});

describe("Detection per error type: recall, precision and false-alarm rate, with their own denominators", () => {
  // The key of A lists (structural) feed in the gap on S1, a lost rerun on S2 and unattributable records on S1, S2, S3; C prevents all of them.
  it("Given A Then the feed in the gap on S1 is realised but VR-010 cannot run without two_clocks: not evaluable, recall 0 of 1, nothing flagged", () => {
    expect(mA.detection.by_type.feed_in_gap).toMatchObject({ evaluable: false, realised: 1, recall: r(0, 1), precision: r(0, 0), false_alarm: r(0, 3) });
    expect(mA.detection.by_type.unattributable_record).toMatchObject({ evaluable: false, realised: 3, recall: r(0, 3) });
    expect(mA.detection.by_type.lost_rerun).toMatchObject({ evaluable: false, realised: 1 });
    expect(mA.detection.by_type.lost_rerun.reason).toMatch(/audit_event: needs audit_trail/); // 2026-10-29 S2c2: the audit event is the evidence of a lost rerun (it was "no rule")
    expect(mA.detection.not_evaluable.map((n) => n.rule)).toContain("VR-010");
  });
  it("Given C Then nothing is realised, VR-010 is evaluable and flags the S2 rerun: recall has no denominator, precision 0 of 1, false alarm 1 of 4", () => {
    expect(mC.detection.by_type.feed_in_gap).toMatchObject({ evaluable: true, reason: null, realised: 0, recall: r(0, 0), precision: r(0, 1), false_alarm: r(1, 4) });
    expect(mC.detection.not_evaluable).toEqual([]);
  });
});

// ---- hand fixtures typed row by row -----------------------------------------------------------------------------------------------------

const drawn = (id: string): Event => ({ type: "sample_drawn", t: 100, sample_id: id, unit_id: "U1", batch_id: "B1", operator_id: "OP-1", volume_ul: 200, true_state: {} }) as unknown as Event;
const ids10 = Array.from({ length: 10 }, (_, i) => `R${i + 1}`);
const truth10 = truthFrom(ids10.map(drawn), { visits: {}, deadlines: {}, operators: [], analyzers: [] });
const rekeys = (...ids: string[]): MaterialisedError[] => ids.map((id) => ({ type: "unit_rekey", sample_id: id, detail: { from_unit: "U1", to_unit: "U2" } }));
const flagged = (...ids: string[]): RecordedDataset => ({
  ...emptyDataset(),
  validation_finding: ids.map((id) => ({ rule: "VR-020", target: `sample:${id}`, severity: "error" as const, action: "hold" as const, status: "open" as const })),
});
const key10 = (errors: MaterialisedError[]) => parseKey(keyFile({ engine_version: "t", scenario_id: "ten", seed: 1 }, { T: { materialised: errors, not_modelled: [] } }), "T");

describe("Hand fixture of 10 requests with 3 injected errors, 2 detected and 1 false flag", () => {
  // Errors on R1, R2, R3. Flags (VR-020, the rule of this type) on R1, R2 (detected) and R9 (clean).
  //   recall = 2 detected / 3 realised = 2/3. precision = 2 flags on a realised error / 3 flags = 2/3. false alarm = 1 clean flagged (R9) / 7 clean (R4..R10) = 1/7.
  const d = detection(truth10, flagged("R1", "R2", "R9"), key10(rekeys("R1", "R2", "R3")), []).by_type.unit_rekey;
  it("Then recall is 2/3, precision is 2/3 and the false-alarm rate is 1/7", () => {
    expect(d).toMatchObject({ evaluable: true, realised: 3, recall: r(2, 3), precision: r(2, 3), false_alarm: r(1, 7) });
    expect(d.recall.value).toBeCloseTo(2 / 3, 12);
    expect(d.false_alarm.value).toBeCloseTo(1 / 7, 12);
  });
  it("Then each denominator is named: realised opportunities, raised flags, clean requests", () => {
    expect([d.recall.denominator, d.precision.denominator, d.false_alarm.denominator]).toEqual(["realised opportunities of the type", "raised flags of the type", "requests clean for the type"]);
  });
});

describe("Phantom effect size (recorded group effect against the true one, over the pooled truth SD)", () => {
  // Analyzer AN-1 reads 1 unit high. True values: AN-1 [10, 12], AN-2 [11, 13]: true effect 11 - 12 = -1. Recorded: AN-1 [11, 13], AN-2 [11, 13]: effect 0.
  // pooled SD of the true values: both groups have variance 2, so sqrt((1 x 2 + 1 x 2) / 2) = sqrt(2). Phantom = |0 - (-1)| / sqrt(2) = 1 / sqrt(2).
  const measured = (id: string, analyzer: string, truthValue: number): Event => ({ type: "result_measured", t: 10, request_id: id, attempt: 1, visit: 1, analyzer, analyte: "glucose", value: truthValue, true_value: truthValue, noise: 0 }) as unknown as Event;
  const truth: Truth = truthFrom([...["P1", "P2", "P3", "P4"].map(drawn), measured("P1", "AN-1", 10), measured("P2", "AN-1", 12), measured("P3", "AN-2", 11), measured("P4", "AN-2", 13)], { visits: {}, deadlines: {}, operators: [], analyzers: [] });
  const recorded = (values: Record<string, number>): RecordedDataset => ({
    ...emptyDataset(),
    result: Object.entries(values).map(([id, value], i) => ({ result_id: `R${i}`, request_id: id, analyte: "glucose", version: 1, run_id: `${id}/1/1`, value, measured_at: 10, available_at: null, supersedes: null, ingested_at: null, reviewed_at: null, state: null })),
  });
  const key = key10([]);
  it("Given the 1-unit bias on AN-1 Then the phantom effect is 1/sqrt(2), with 2 requests in each group", () => {
    const p = phantomEffect(truth, recorded({ P1: 11, P2: 13, P3: 11, P4: 13 }), key, { analyte: "glucose", group_a: "AN-1", group_b: "AN-2" });
    expect(p).toMatchObject({ n_a: 2, n_b: 2, true_effect: -1, recorded_effect: 0 });
    expect(p?.value).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(p?.pooled_truth_sd).toBeCloseTo(Math.SQRT2, 12);
  });
  it("Given no bias (the recorded values are the true ones) Then the phantom effect is exactly 0", () => {
    expect(phantomEffect(truth, recorded({ P1: 10, P2: 12, P3: 11, P4: 13 }), key, { analyte: "glucose", group_a: "AN-1", group_b: "AN-2" })?.value).toBe(0);
  });
  it("Given an empty group Then there is no value, not a zero", () => {
    expect(phantomEffect(truth, recorded({ P1: 10, P2: 12 }), key, { analyte: "glucose", group_a: "AN-1", group_b: "AN-2" })?.value).toBeNull();
  });
});


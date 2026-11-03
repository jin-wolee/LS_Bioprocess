import { beforeAll, describe, expect, it } from "vitest";
import { breakoutMetrics } from "../src/evaluate/breakout_metrics.ts";
import type { BreakoutMetrics } from "../src/evaluate/breakout_metrics.ts";
import { breakoutTruth } from "../src/evaluate/breakout_truth.ts";
import { parseKey, recordedId } from "../src/evaluate/answer_key.ts";
import { breakoutCase, runBreakout } from "../src/experiments/assembly/breakout.ts";
import type { BreakoutCase } from "../src/experiments/assembly/breakout.ts";
import { buildBreakoutReport } from "../src/experiments/assembly/breakout_report.ts";
import { rosterOf, seedInputFromRun } from "../src/experiments/assembly/from_run.ts";
import { runSeed } from "../src/experiments/assembly/run_seed.ts";
import type { BreakoutReport } from "../src/generated/breakout_report.schema";
import { investigate, signalsOf } from "../src/record/investigate/investigate.ts";
import type { Investigation } from "../src/record/investigate/investigate.ts";
import type { RecordedDataset } from "../src/record/types.ts";
import { runScenario } from "../src/run.ts";
import { loadScenario } from "../src/scenario.ts";
import type { ScenarioConfig } from "../src/scenario.ts";
import { FX12A, FX12A_MASTER } from "./support/breakout_streams.ts";
import { emptyKey, truthOf } from "./support/breakout_truth_setup.ts";
import type { Onset } from "./support/breakout_truth_setup.ts";
import { makeEvalAjv, validates } from "./support/eval_schemas.ts";
import { CFG, rec } from "./support/investigate_setup.ts";
import { readJson } from "./support/paths.ts";
import { loadSc12 } from "./support/sc12.ts";
import { lookup, rawScenario } from "./support/scenarios.ts";

// SC12 and the fixes of the S3 adversary pass (spec 11.8.13): F1 (a hold no result decides does not contain, C36), F3 (released is the record's, C39), F6 (the report, C40), F7 (the default
// assumed lag is the type's, C41) and F8 (each signal draws its own confirming sample, so the deviation closes; the author's ruling of 2026-10-31). The probes' inputs are used as given (scenario,
// seed, the changed input); every expectation is typed from the amended rule, never read off the code. No value, sign or ordering of a reported metric is asserted (section 8, anti-gaming rule 8).

const CONFIG = readJson("data", "scenarios", "experiments", "sc12.json");
const PRESETS = ["a_manual", "b_lims_lite", "c_context"];
const REVIEW = { timing: "next_shift_start" as const, reject_also: [] as string[] };
const pair = (r: { num: number; den: number }) => [r.num, r.den];

/** One case and seed through the pipeline of the experiment, kept open: the investigated dataset and the metrics of each preset. */
const investigated = (c: BreakoutCase, seed: number) => {
  const { input } = loadSc12(CONFIG, ["medium_lot"]);
  const b = c.scenario.breakout as NonNullable<ScenarioConfig["breakout"]>;
  const run = runScenario({ ...c.scenario, seed });
  const architectures = input.architectures.filter((a) => PRESETS.includes(a.id));
  const si = seedInputFromRun(run, {
    scenario_id: c.scenario.scenario_id, staff: input.staff, evaluation: input.evaluation, architectures, days: c.scenario.process.horizon_s / 86400,
    review: { roster: rosterOf(c.scenario.sampling), ...REVIEW }, breakout: b,
  });
  const out = runSeed(si);
  const cfg = { decision_delay_s: b.signal_to_response_s, conclusion_delay_s: b.positive_to_hold_s, assumed_lag_s: c.assumed_lag.seconds, review: si.review };
  const invs: Record<string, Investigation> = {};
  const metrics: Record<string, BreakoutMetrics> = {};
  for (const a of architectures) {
    invs[a.id] = investigate(out.datasets[a.id] as RecordedDataset, signalsOf(si.events), cfg);
    metrics[a.id] = breakoutMetrics({ truth: si.truth, investigation: invs[a.id] as Investigation, key_text: out.key_text, architecture: a.id });
  }
  return { run, si, out, invs, metrics };
};
const caseOf = (scenario: string, doc: unknown): BreakoutCase => breakoutCase({ case_id: scenario, scenario, set: {} }, loadScenario(doc, lookup));

describe("F1: a hold that waits for a skipped confirming draw does not contain its item (C36)", () => {
  // The probe's input: sc12_medium_lot with a bioburden volume of 100000 mL, seed 9013. Every confirming draw is above the cap, so all are skipped: the two of the first signal and, with F8, the
  // one of U05's later signal. No hold can be decided, so none contains: the two affected batches (B-U01 and B-U05, both running at the first signal) are 0 of 2 contained in A, B and C.
  let out: ReturnType<typeof investigated>;
  beforeAll(() => {
    const raw = structuredClone(rawScenario("sc12_medium_lot")) as { breakout: { inputs: { bioburden_sample_volume_ml: { value: number } } } };
    raw.breakout.inputs.bioburden_sample_volume_ml.value = 100000;
    out = investigated(caseOf("sc12_medium_lot", raw), 9013);
  });

  it("Given the 100000 mL bioburden volume When the run draws Then every confirming draw is skipped, the later signal's included", () => {
    expect(out.run.events.filter((e) => e.type === "draw_skipped_volume_budget" && e.sample_id.endsWith("-CONF")).map((e) => (e as { sample_id: string }).sample_id)).toEqual(["U01-CONF", "U02-CONF", "U05-SIG-CONF"]);
  });

  it.each(PRESETS)("Then under %s every hold stays under test, the deviation stays contained, and no item of any kind is contained (the batches 0 of 2)", (id) => {
    const ds = out.invs[id]?.dataset as RecordedDataset;
    expect((ds.quality_hold ?? []).length).toBeGreaterThan(0);
    expect((ds.quality_hold ?? []).every((h) => h.state === "under_test" && h.outcome === null)).toBe(true);
    expect((ds.deviation ?? []).map((d) => d.state)).toEqual(["contained"]);
    const m = out.metrics[id] as BreakoutMetrics;
    expect(pair(m.containment.batch.contained)).toEqual([0, 2]);
    for (const kind of ["batch", "material_lot", "equipment", "result"] as const) expect(m.containment[kind].contained.num, kind).toBe(0);
  });
});

describe("F3: a result counts as released only if the record made it available (C39)", () => {
  const onset: Onset[] = [{ unit: "U01", hours: 5, kind: "medium_lot", origin: "ML-2" }];
  /** FX12a recorded under C, with U01-S2 rejected by the review at 12 h (as VR-010 does): the record never shows it. */
  const rejected = (): RecordedDataset => {
    const ds = rec(FX12A, FX12A_MASTER, "C");
    return { ...ds, result: ds.result.map((r) => (r.request_id === "U01-S2" ? { ...r, state: "rejected" as const, available_at: null, reviewed_at: 12 * 3600 } : r)) };
  };

  it("Given FX12a under C with U01-S2 rejected before the hold When scored Then only U01-S3 stood released before containment (1 of 2) and only it is owed a retro-flag (1 of 1)", () => {
    const m = breakoutMetrics({ truth: truthOf(FX12A, FX12A_MASTER, onset), investigation: investigate(rejected(), signalsOf(FX12A), CFG), key_text: emptyKey("C"), architecture: "C" });
    expect([pair(m.released_before_containment), pair(m.retro_flag_completeness)]).toEqual([[1, 2], [1, 1]]);
  });

  it("Given the probe's case (medium lot, seed 10937) under C When the results the record rejected are scored Then they are not in the numerator: shown as released instead, the numerator grows by exactly their number", () => {
    const { input } = loadSc12(CONFIG, ["medium_lot"]);
    const c = input.cases[0] as BreakoutCase;
    const o = investigated(c, 10937);
    const inv = o.invs.c_context as Investigation;
    const t = breakoutTruth(o.si.truth, (s) => recordedId(parseKey(o.out.key_text, "c_context"), s));
    // the given of the finding: U01-D02-1 is in T and every row the record holds of it was rejected (VR-010)
    const rows = inv.dataset.result.filter((r) => r.request_id === "U01-D02-1" && r.hold_id == null);
    const inT = [...t.touched.keys()].filter((k) => k.startsWith("result:U01-D02-1/")).sort();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.state === "rejected")).toBe(true);
    expect(inT).toEqual([...new Set(rows.map((r) => `result:U01-D02-1/${r.analyte}`))].sort());
    const shown = { ...inv, dataset: { ...inv.dataset, result: inv.dataset.result.map((r) => (rows.includes(r) ? { ...r, state: null, available_at: r.measured_at } : r)) } };
    const score = (x: Investigation) => breakoutMetrics({ truth: o.si.truth, investigation: x, key_text: o.out.key_text, architecture: "c_context" }).released_before_containment.num;
    expect(score(shown) - score(inv)).toBe(inT.length);
  });
});

describe("F7: the default assumed lag is the lag of the event type (rule S8; C41 as amended)", () => {
  const { input } = loadSc12(CONFIG);
  const by = (id: string) => input.cases.find((c) => c.case_id === id)?.assumed_lag;

  it("Given the seed-lot scenario, whose true lag is 36 h When the case sets no assumed lag Then the walk-back assumes the bacterial lag of 12 h (A139), and the truth keeps 36 h", () => {
    expect(by("seed_lot")).toEqual({ seconds: 12 * 3600, ref: "A139", swept: false });
    expect(input.cases.find((c) => c.case_id === "seed_lot")?.scenario.breakout?.lag_s).toBe(36 * 3600);
  });

  it("Given the medium-lot and the mycoplasma scenarios (no lag of their own) Then the default is the type's lag, 12 h (A139) and 48 h (A138)", () => {
    expect(by("medium_lot")).toEqual({ seconds: 12 * 3600, ref: "A139", swept: false });
    expect(by("mycoplasma_nat_covers")).toEqual({ seconds: 48 * 3600, ref: "A138", swept: false });
  });
});

describe("F8: each signal draws its own confirming sample, so every hold is decided and DEV-1 closes", () => {
  // The probe's cases and seed: in the medium-lot and the mycoplasma cases U05 signals after U01 and is not in the confirm list; in the seed-lot case U02 and U03 signal after U01. Each later
  // signal now draws its own sample (rule S2 as ruled), so its holds are decided by it and the deviation is concluded and closed (C22, C24).
  const { input } = loadSc12(CONFIG, ["medium_lot", "seed_lot", "mycoplasma_nat_covers", "mycoplasma_nat_misses"]);
  it.each(["medium_lot", "seed_lot", "mycoplasma_nat_covers", "mycoplasma_nat_misses"])("Given the %s case, seed 9013 When it is investigated under A, B and C Then every hold is decided and DEV-1 is closed", (id) => {
    const o = investigated(input.cases.find((c) => c.case_id === id) as BreakoutCase, 9013);
    for (const a of PRESETS) {
      const ds = o.invs[a]?.dataset as RecordedDataset;
      expect((ds.quality_hold ?? []).filter((h) => h.outcome === null).map((h) => `${h.target_kind}:${h.target_id}`), `${id} ${a}`).toEqual([]);
      expect((ds.deviation ?? []).map((d) => [d.deviation_id, d.state]), `${id} ${a}`).toEqual([["DEV-1", "closed"]]);
    }
  });
});

describe("F6: the report (C40 as amended; data/schemas/breakout_report.schema.json, additive)", () => {
  let report: BreakoutReport;
  beforeAll(async () => {
    const { input, head } = loadSc12(CONFIG, ["medium_lot", "seed_lot", "sampling"]);
    report = buildBreakoutReport(await runBreakout({ ...input, architectures: input.architectures.filter((a) => PRESETS.includes(a.id)), seeds: [31] }), head);
  }, 120_000);
  const caseIn = (id: string) => report.cases.find((c) => c.case_id === id);

  it("Given the report When it is validated Then it fits the schema", () => {
    const ajv = makeEvalAjv();
    expect(validates(ajv, "breakout_report", report), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("Given A, which reads neither lots nor equipment When its direction 3 rows are read Then each has the status not_reachable, no median and no spread, and says so; never reported zeros", () => {
    const a = caseIn("medium_lot")?.architectures.find((x) => x.id === "a_manual");
    const rows = a?.rows.filter((r) => r.metric.startsWith("identification.direction_3.")) ?? [];
    expect(rows.map((r) => r.metric)).toEqual(["recall", "precision", "false_alarm"].map((m) => `identification.direction_3.${m}`));
    for (const r of rows) {
      expect(r, r.metric).toMatchObject({ status: "not_reachable", n_defined: 0, median: null, lo: null, hi: null });
      expect(r.reason).toContain("not reachable from this record");
    }
  });

  it("Then B, which reads equipment, keeps its direction 3 rows as rows of a record that can look", () => {
    const b = caseIn("medium_lot")?.architectures.find((x) => x.id === "b_lims_lite");
    expect(b?.rows.find((r) => r.metric === "identification.direction_3.recall")?.status).not.toBe("not_reachable");
  });

  it("Then the event prints the horizon with A189 and the origin's contaminated_at with A157 (none for a sampling origin)", () => {
    expect(caseIn("medium_lot")?.event).toMatchObject({ horizon_days: 21, horizon_ref: "A189", contaminated_at: { value: 48, unit: "h", ref: "A157" } });
    expect(caseIn("seed_lot")?.event.contaminated_at).toEqual({ value: 0, unit: "h", ref: "A157" });
    expect(caseIn("sampling")?.event.contaminated_at).toBeNull();
  });

  it("Then the inputs print the release delay under the id the engine reads, A176 (d2, 4 h), and say that A227 has no value yet", () => {
    const release = caseIn("medium_lot")?.inputs.find((i) => i.name === "release_delay");
    expect(release).toMatchObject({ ref: "A176", value: 4, unit: "h", source: "scenario_input" });
    expect(release?.what).toContain("A227");
  });

  it("Then the topology prints with A177 each unit with the instant it consumes or uses the item (a seed lot at the inoculation of its unit, U01 at 8 h) and each lot's prepared_at", () => {
    const lots = caseIn("medium_lot")?.topology.lots ?? [];
    expect(lots.find((l) => l.lot_id === "ML-3")).toMatchObject({ prepared_at_h: 0, uses: [{ unit_id: "U01", at_h: 52 }, { unit_id: "U05", at_h: 62 }] });
    expect(lots.find((l) => l.lot_id === "SL-1")).toMatchObject({ prepared_at_h: 0, uses: [{ unit_id: "U01", at_h: 8 }] });
  });

  it("Then the assumed lag of the seed-lot case is printed as the lag of the event type, 12 h, beside the true lag of 36 h (F7)", () => {
    const inputs = caseIn("seed_lot")?.inputs ?? [];
    expect(inputs.find((i) => i.name === "assumed_lag")).toMatchObject({ ref: "A139", value: 12, source: "decision_setting" });
    expect(inputs.find((i) => i.name === "assumed_lag")?.what).toContain("the lag of the event type");
    expect(inputs.find((i) => i.name === "lag")).toMatchObject({ value: 36, source: "scenario_input" });
  });
});

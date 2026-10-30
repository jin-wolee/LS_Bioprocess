import { beforeAll, describe, expect, it } from "vitest";
import { flatten } from "../../src/evaluate/aggregate.ts";
import type { Metrics } from "../../src/generated/metrics.schema";
import type { ExperimentReport } from "../../src/generated/experiment_report.schema";
import { runOpenLoop } from "../../src/experiments/assembly/open_loop.ts";
import type { OpenLoopResult } from "../../src/experiments/assembly/open_loop.ts";
import { buildReport } from "../../src/experiments/assembly/report.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { makeEvalAjv, validates } from "../support/eval_schemas.ts";
import { seedInput } from "../support/eval_fixture.ts";
import { openLoopInput } from "../support/open_loop_setup.ts";
import { summaryLines } from "../support/report_summary.ts";

// S2c2: the stochastic report (never a gate). Part 1 is typed by hand on cells whose values are set by hand (test-only); part 2 runs two real seeds of the small
// default scenario and checks structure only: the schema, the seed count, the spread fields, the statuses of the types that have no rate. No result is asserted.

const HEAD = { experiment_id: "hand", min_seeds: 20, ablations_of: "C" };
const hand = runSeed(seedInput());
const share = (num: number, den: number, denominator = "all analysis requests") => ({ num, den, denominator, value: den === 0 ? null : num / den });
const HASH = "0".repeat(64);

const cell = (base: Metrics, seed: number, edit: (m: Metrics["metrics"]) => void): Metrics => {
  const c = structuredClone(base);
  c.seed = seed;
  edit(c.metrics);
  return c;
};

const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
// Seed i (1 to 20): A's shares are i/20. C's exact-reconstruction shares are (21 - i)/20 (the same set of values as A: a tie in the median), and its
// attributable shares are min(i + 5, 20)/20. A: lost rerun not evaluable, 3 realised per seed, VR-004 not evaluable. Both: unit_rekey not modelled;
// C: no realised lost rerun in any seed (denominator zero everywhere). The lost rerun has an evidence detector, so its precision and false-alarm rate read
// "not applicable" in every cell (orchestrator ruling of 2026-10-29).
const result = (n = 20): OpenLoopResult => ({
  scenario_id: "hand",
  engine_version: "0.1.0",
  seeds: seeds.slice(0, n),
  review: { timing: "next_shift_start", reject_also: [] },
  outcomes: seeds.slice(0, n).map((i) => ({
    seed: i, truth_log_hash: HASH, key_text: "{}",
    cells: [
      cell(hand.cells[0] as Metrics, i, (m) => {
        m.exact_reconstruction = share(i, 20);
        m.attributable = share(i, 20);
        m.detection.not_modelled = ["unit_rekey"];
        m.detection.not_evaluable = [{ rule: "VR-004", reason: "tolerance not set" }];
        m.detection.by_type.lost_rerun = { evaluable: false, reason: "no audit trail", realised: 3, recall: share(0, 3), precision: "not applicable", false_alarm: "not applicable", by_detector: {} };
      }),
      cell(hand.cells[1] as Metrics, i, (m) => {
        m.exact_reconstruction = share(21 - i, 20);
        m.attributable = share(Math.min(i + 5, 20), 20);
        m.detection.not_modelled = ["unit_rekey"];
        m.detection.by_type.lost_rerun = { evaluable: true, reason: null, realised: 0, recall: share(0, 0), precision: "not applicable", false_alarm: "not applicable", by_detector: { audit_event: 0 } };
      }),
    ],
  })),
});

describe("Stochastic report: rows, statuses and denominators (hand-set cells)", () => {
  const report = buildReport(result(), HEAD);
  const row = (arch: string, metric: string) => report.architectures.find((a) => a.id === arch)?.rows.find((r) => r.metric === metric);

  it("Given 20 seeds Then the report carries the head: versions, scenario, the seed list, the seed count and the minimum of A103", () => {
    expect(report).toMatchObject({ schema_version: "1", engine_version: "0.1.0", experiment_id: "hand", scenario_id: "hand", n_seeds: 20, min_seeds: 20, meets_min_seeds: true });
    expect(report.seeds).toEqual(seeds);
    expect(report.truth_log_hashes).toEqual(seeds.map((seed) => ({ seed, truth_log_hash: HASH })));
  });

  it("Given the review settings of the run Then the report states them, so that a sensitivity variant is a report that says what it varied", () => {
    expect(report.review).toEqual({ timing: "next_shift_start", reject_also: [] });
    const variant = buildReport({ ...result(), review: { timing: "shift_end", reject_also: ["VR-015", "VR-020"] } }, HEAD);
    expect(variant.review).toEqual({ timing: "shift_end", reject_also: ["VR-015", "VR-020"] });
  });

  it("Given 19 seeds Then the report says it does not reach the minimum", () => {
    expect(buildReport(result(19), HEAD)).toMatchObject({ n_seeds: 19, meets_min_seeds: false });
  });

  it("Given the shares i/20 Then the row has the median 0.5 and the spread 0.05 to 0.95 (nearest rank), the seed count and the denominators", () => {
    expect(row("A", "exact_reconstruction")).toEqual({
      metric: "exact_reconstruction", status: "reported", n_seeds: 20, n_defined: 20, median: 0.5, lo: 0.05, hi: 0.95,
      denominator: "all analysis requests", den: { min: 20, median: 20, max: 20 }, reason: null,
    });
  });

  it("Then the report says what the spread is: a percentile range across seeds, not a confidence interval", () => {
    expect(report.interval).toMatch(/5th to the 95th percentile/);
    expect(report.interval).toMatch(/not a confidence interval/);
  });

  it("Given a type with no ledger rate Then every row of it is not_modelled with no number, never zero, and the architecture lists the type", () => {
    for (const f of ["realised", "recall", "precision", "false_alarm"]) {
      expect(row("A", `detection.by_type.unit_rekey.${f}`), f).toMatchObject({ status: "not_modelled", n_defined: 0, median: null, lo: null, hi: null, reason: "no ledger rate for this type in a production run" });
    }
    expect(report.architectures.map((a) => a.not_modelled)).toEqual([["unit_rekey"], ["unit_rekey"]]);
  });

  it("Given a type whose detector could not run Then its recall is not_evaluable with no number, while the count of realised opportunities is still reported (3 in every seed)", () => {
    expect(row("A", "detection.by_type.lost_rerun.recall")).toMatchObject({ status: "not_evaluable", n_defined: 0, median: null, reason: "no audit trail" }); // the reason of the first cell
    expect(row("A", "detection.by_type.lost_rerun.realised")).toMatchObject({ status: "reported", median: 3, lo: 3, hi: 3, denominator: expect.stringContaining("realised opportunities") });
  });

  it("Given an evidence detector Then its precision and false-alarm rate are not_applicable rows with no number and no denominator, in every architecture, whether or not the evidence could run", () => {
    for (const arch of ["A", "C"]) {
      for (const f of ["precision", "false_alarm"]) {
        expect(row(arch, `detection.by_type.lost_rerun.${f}`), `${arch} ${f}`).toEqual({
          metric: `detection.by_type.lost_rerun.${f}`, status: "not_applicable", n_seeds: 20, n_defined: 0, median: null, lo: null, hi: null, denominator: null, den: null, reason: "an evidence check raises no alarm: no precision and no false-alarm rate",
        });
      }
    }
  });

  it("Given a detector counted by name Then its count is a row with the denominator wording; a detector that could not run is not listed at all", () => {
    expect(row("C", "detection.by_type.lost_rerun.by_detector.audit_event")).toMatchObject({ status: "reported", median: 0, lo: 0, hi: 0, denominator: expect.stringContaining("realised opportunities") });
    expect(row("A", "detection.by_type.lost_rerun.by_detector.audit_event")).toBeUndefined();
  });

  it("Given a rate whose denominator is zero in every seed Then the status is none_occurred and no number is given (not 0 and not 100 percent)", () => {
    expect(row("C", "detection.by_type.lost_rerun.recall")).toMatchObject({ status: "none_occurred", n_defined: 0, median: null, lo: null, hi: null, reason: "undefined in every seed: the denominator is zero" });
    expect(row("C", "detection.by_type.lost_rerun.recall")?.den).toEqual({ min: 0, median: 0, max: 0 });
  });

  it("Then the rules that could not run are carried once per architecture with their reason", () => {
    expect(report.architectures.map((a) => a.not_evaluable)).toEqual([[{ rule: "VR-004", reason: "tolerance not set" }], []]);
  });

  it("Then a median or p90 in seconds names the denominator of the share beside it (the started requests, the released ones, the joined ones)", () => {
    const base = hand.cells[0] as Metrics;
    expect(row("A", "holding_time.median_s")?.denominator).toBe(base.metrics.holding_time.started.denominator);
    expect(row("A", "turnaround.p90_s")?.denominator).toBe(base.metrics.turnaround.released.denominator);
    expect(row("A", "alignment_error.median_s")?.denominator).toBe(base.metrics.alignment_error.joined.denominator);
  });

  it("Then every number of the metrics document has a row, except the four settings it repeats (analyzers, days, staffed window, SLA threshold)", () => {
    const echoes = ["utilisation.analyzers", "utilisation.days", "utilisation.staffed_window_s", "holding_time.sla_threshold_s"];
    const paths = flatten((hand.cells[0] as Metrics).metrics).map(([p]) => p).filter((p) => !echoes.includes(p));
    expect(report.architectures[0]?.rows.map((r) => r.metric)).toEqual([...paths, "phantom_effect"]); // the last row is the phantom effect: no contrast in this scenario
    for (const e of echoes) expect(row("A", e)).toBeUndefined();
  });

  it("Then no row of any architecture has a denominator-less ratio: every row that is a share names its denominator", () => {
    for (const a of report.architectures) for (const r of a.rows) if (r.den !== null) expect(r.denominator, `${a.id} ${r.metric}`).not.toBeNull();
  });
});

describe("Stochastic report: the phantom effect size (hand-set cells)", () => {
  const phantom = { analyte: "glucose", group_a: "AN-1", group_b: "AN-2", n_a: 2, n_b: 2, true_effect: -1, recorded_effect: 0, pooled_truth_sd: 2, value: 0.5, denominator: "requests in the contrast" };

  it("Given a scenario with no contrast Then every architecture has one phantom_effect row that reads not applicable, with the reason, and no number (never 0)", () => {
    const report = buildReport(result(), HEAD);
    for (const a of report.architectures) {
      expect(a.rows.filter((r) => r.metric.startsWith("phantom_effect"))).toEqual([{
        metric: "phantom_effect", status: "not_applicable", n_seeds: 20, n_defined: 0, median: null, lo: null, hi: null, denominator: null, den: null, reason: "no contrast in this scenario",
      }]);
    }
  });

  it("Given a contrast Then the phantom effect size is a row with the denominator of the metric, and there is no not-applicable row", () => {
    const withContrast = result();
    for (const o of withContrast.outcomes) for (const c of o.cells) c.metrics.phantom_effect = phantom;
    const report = buildReport(withContrast, HEAD);
    expect(report.architectures[0]?.rows.find((r) => r.metric === "phantom_effect.value")).toMatchObject({ status: "reported", median: 0.5, lo: 0.5, hi: 0.5, denominator: "requests in the contrast", reason: null });
    expect(report.architectures[0]?.rows.find((r) => r.metric === "phantom_effect")).toBeUndefined();
  });
});

describe("Stochastic report: orderings are data (hand-set cells)", () => {
  const report = buildReport(result(), HEAD);
  const order = (metric: string) => report.ranks.find((r) => r.metric === metric)?.order;

  it("Given medians 0.5 (A) and 0.75 (C) Then the ranks list A at 1 and C at 2 as data, with the medians", () => {
    expect(order("attributable")).toEqual([{ architecture: "A", rank: 1, median: 0.5 }, { architecture: "C", rank: 2, median: 0.75 }]);
  });

  it("Given equal medians Then both share rank 1", () => {
    expect(order("exact_reconstruction")).toEqual([{ architecture: "A", rank: 1, median: 0.5 }, { architecture: "C", rank: 1, median: 0.5 }]);
  });

  it("Given a metric that is not reported in an architecture (not modelled, not evaluable, none occurred) Then that architecture is not ranked on it", () => {
    expect(order("detection.by_type.unit_rekey.recall")).toBeUndefined();
    expect(order("detection.by_type.lost_rerun.recall")).toBeUndefined();
  });
});

describe("Stochastic report: roles of the architectures", () => {
  it("Given ids of the form <ablated preset>_minus_<flag> Then the report marks them as ablations of that flag and the others as presets", () => {
    const base = result(20);
    for (const o of base.outcomes) o.cells = [o.cells[0] as Metrics, { ...structuredClone(o.cells[1] as Metrics), architecture: "C_minus_two_clocks" }];
    const report = buildReport(base, HEAD);
    expect(report.architectures.map((a) => [a.id, a.role, a.ablated_flag])).toEqual([["A", "preset", null], ["C_minus_two_clocks", "ablation", "two_clocks"]]);
  });
});

describe("Stochastic report: two real seeds of the small default scenario (structure only)", () => {
  let report: ExperimentReport;
  beforeAll(async () => {
    report = buildReport(await runOpenLoop(openLoopInput([11, 12])), { experiment_id: "experiment1", min_seeds: 20, ablations_of: "c_context" });
  });

  it("Then the report validates against schemas/experiment_report.schema.json", () => {
    const ajv = makeEvalAjv();
    expect(validates(ajv, "experiment_report", report), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("Then it carries the seed count (2), says that 2 seeds do not reach the A103 minimum, and lists the seeds", () => {
    expect([report.n_seeds, report.seeds, report.min_seeds, report.meets_min_seeds]).toEqual([2, [11, 12], 20, false]);
    expect(report.truth_log_hashes.map((h) => h.seed)).toEqual([11, 12]);
  });

  it("Then every architecture has the seed count and, on every row, the spread fields (median, lo, hi) and the seed counts", () => {
    expect(report.architectures.length).toBe(13);
    for (const a of report.architectures) {
      expect(a.n_seeds).toBe(2);
      for (const r of a.rows) {
        expect(r, `${a.id} ${r.metric}`).toHaveProperty("median");
        expect(r).toHaveProperty("lo");
        expect(r).toHaveProperty("hi");
        expect([r.n_seeds, r.n_defined <= 2]).toEqual([2, true]);
        if (r.status === "reported") expect(r.lo as number).toBeLessThanOrEqual(r.hi as number);
      }
    }
  });

  it("Then the roles are three presets and ten ablations, one per flag", () => {
    expect(report.architectures.filter((a) => a.role === "preset").map((a) => a.id)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(report.architectures.filter((a) => a.role === "ablation").map((a) => a.ablated_flag)).toEqual([
      "system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail",
      "material_lot_links", "equipment_links",
    ]);
  });

  it.each(["material_lot_links", "equipment_links"])("Then the block of C without %s equals the block of C in every row: no break-out event exists and nothing reads the flag (ADR-0017, ADR-0020)", (flag) => {
    const rows = (id: string) => report.architectures.find((a) => a.id === id)?.rows;
    expect(rows(`c_context_minus_${flag}`)).toEqual(rows("c_context"));
  });

  it("Then the types without a ledger rate (unit re-key, clock error, replayed file) are not_modelled in every architecture, with no number (never realised 0)", () => {
    for (const a of report.architectures) {
      expect(a.not_modelled, a.id).toEqual(["unit_rekey", "clock_offset", "duplicate_replay"]);
      for (const t of ["unit_rekey", "clock_offset", "duplicate_replay"]) for (const f of ["realised", "recall", "precision", "false_alarm"]) {
        expect(a.rows.find((r) => r.metric === `detection.by_type.${t}.${f}`), `${a.id} ${t} ${f}`).toMatchObject({ status: "not_modelled", median: null, lo: null, hi: null, n_defined: 0 });
      }
    }
  });

  it("Then the lost rerun, whose detector is the audit event, has no precision and no false-alarm rate in any architecture: not_applicable rows, never a number", () => {
    for (const a of report.architectures) {
      for (const f of ["precision", "false_alarm"]) expect(a.rows.find((r) => r.metric === `detection.by_type.lost_rerun.${f}`), `${a.id} ${f}`).toMatchObject({ status: "not_applicable", median: null, lo: null, hi: null, n_defined: 0 });
    }
  });

  it("Then the scenario names no contrast: every architecture has a phantom_effect row that reads not applicable with the reason, and the console summary says so", () => {
    for (const a of report.architectures) expect(a.rows.find((r) => r.metric === "phantom_effect"), a.id).toMatchObject({ status: "not_applicable", median: null, reason: "no contrast in this scenario" });
    expect(summaryLines(report)).toContain("phantom effect: not applicable: no contrast in this scenario");
  });

  it("Then the clock rules, whose tolerances have no ledger entry, are listed as not evaluable with their reason", () => {
    for (const a of report.architectures) expect(a.not_evaluable.map((n) => n.rule), a.id).toEqual(expect.arrayContaining(["VR-003", "VR-004"]));
  });
});

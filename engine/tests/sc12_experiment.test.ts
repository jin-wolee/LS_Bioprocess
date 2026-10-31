import { beforeAll, describe, expect, it } from "vitest";
import { runBreakout, runBreakoutSeed } from "../src/experiments/assembly/breakout.ts";
import type { BreakoutResult } from "../src/experiments/assembly/breakout.ts";
import { buildBreakoutReport } from "../src/experiments/assembly/breakout_report.ts";
import type { BreakoutReport } from "../src/generated/breakout_report.schema";
import { runScenario } from "../src/run.ts";
import { canonicalJson, logHash } from "../src/trace.ts";
import { makeEvalAjv, validates } from "./support/eval_schemas.ts";
import { readJson } from "./support/paths.ts";
import { loadSc12 } from "./support/sc12.ts";

// SC12 Contamination break-out and walk-back, the experiment (spec 11.5, 11.8.4, rule S12): the five scenarios of scenarios/sc12_*.json and the experiment config
// scenarios/experiments/sc12.json, run through the thirteen architectures. Structural relations only (spec 8, anti-gaming rule 8): that the truth is one run shared by every architecture, that
// the report prints the inputs, that a zero denominator says so, that nothing is ordered. No value, sign or ordering of a metric is asserted: SC12 is reported and never gated. The seeds below are
// test-only values, not the seed list of the experiment (that is written in the config, before any run).

const SEEDS = [31, 32];
const CONFIG = readJson("scenarios", "experiments", "sc12.json");
const IDS = [
  "a_manual", "b_lims_lite", "c_context", "c_context_minus_system_issued_id", "c_context_minus_two_clocks", "c_context_minus_available_at", "c_context_minus_instrument_state_snapshot",
  "c_context_minus_append_only_versions", "c_context_minus_write_time_keys", "c_context_minus_ingest_idempotency", "c_context_minus_audit_trail", "c_context_minus_material_lot_links",
  "c_context_minus_equipment_links",
];
const FIVE = ["sc12_medium_lot", "sc12_seed_lot", "sc12_sampling", "sc12_equipment", "sc12_mycoplasma"];

/** Every key of a document, at any depth. */
const keysOf = (node: unknown): string[] => (node && typeof node === "object" ? Object.entries(node).flatMap(([k, v]) => [...(Array.isArray(node) ? [] : [k]), ...keysOf(v)]) : []);

describe("SC12 contamination break-out and walk-back: the experiment config and the five scenarios", () => {
  const { config, input } = loadSc12(CONFIG);

  it("Given the config When it is read Then it names the five scenarios (the mycoplasma one twice, with the nucleic-acid target covering the organism and not) and the sweeps beside the default, over at least 20 neutral seeds", () => {
    expect(config.cases.map((c) => c.scenario).filter((s, i, all) => all.indexOf(s) === i).sort()).toEqual([...FIVE].sort());
    expect(config.cases.slice(0, 6).map((c) => c.case_id)).toEqual(["medium_lot", "seed_lot", "sampling", "equipment", "mycoplasma_nat_covers", "mycoplasma_nat_misses"]);
    expect(config.cases.filter((c) => c.assumed_lag !== undefined).length).toBeGreaterThan(0);
    expect(config.seeds.length).toBeGreaterThanOrEqual(20);
    expect(config.presets).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(input.architectures.map((a) => a.id)).toEqual(IDS);
  });

  it.each([
    ["sc12_medium_lot", "bacterial", "medium_lot"],
    ["sc12_seed_lot", "bacterial", "seed_lot"],
    ["sc12_sampling", "bacterial", "sampling"],
    ["sc12_equipment", "bacterial", "shared_equipment"],
    ["sc12_mycoplasma", "mycoplasma", "medium_lot"],
  ])("Given %s When it is loaded Then the event is %s and enters through %s, and the response delays of A176 and the topology of A177 are scenario inputs", (name, profile, origin) => {
    const c = input.cases.find((x) => x.scenario.scenario_id === name)?.scenario.breakout;
    expect(c?.profile.profile_id).toBe(profile);
    expect(c?.origin.kind).toBe(origin);
    expect([c?.signal_to_response_s, c?.positive_to_hold_s]).toEqual([2 * 3600, 4 * 3600]);
    expect((c?.consumption.length ?? 0) > 0).toBe(true);
  });

  it("Given the config When a case sets nothing Then the walk-back assumes the lag the scenario gives the event, and a swept case says it was swept", () => {
    const by = (id: string) => input.cases.find((c) => c.case_id === id)?.assumed_lag;
    expect(by("medium_lot")).toMatchObject({ seconds: 12 * 3600, ref: "A139", swept: false });
    expect(by("seed_lot")).toMatchObject({ seconds: 36 * 3600, swept: false });
    expect(by("mycoplasma_nat_covers")).toMatchObject({ seconds: 48 * 3600, ref: "A138", swept: false });
    expect(by("medium_lot_assumed_lag_4h")).toMatchObject({ seconds: 4 * 3600, ref: "A139", swept: true });
    expect(by("mycoplasma_assumed_lag_6d")).toMatchObject({ seconds: 144 * 3600, ref: "A138", swept: true });
  });
});

describe("SC12 contamination break-out and walk-back: one truth run, thirteen architectures", () => {
  const { input } = loadSc12(CONFIG, ["medium_lot", "equipment"]);
  const small = { ...input, seeds: SEEDS };
  let result: BreakoutResult;
  beforeAll(async () => {
    result = await runBreakout(small);
  }, 120_000);

  it("Given two seeds When SC12 runs Then every case has one outcome per seed with one cell per architecture, in the order of the config", () => {
    expect(result.cases.map((c) => c.case.case_id)).toEqual(["medium_lot", "equipment"]);
    for (const c of result.cases) {
      expect(c.outcomes.map((o) => o.seed)).toEqual(SEEDS);
      for (const o of c.outcomes) expect(o.cells.map((x) => x.architecture)).toEqual(IDS);
    }
  });

  it("Given each architecture alone When it is recorded and investigated Then the truth log hash equals that of the thirteen together and that of an independent run of the scenario", async () => {
    const review = { timing: "next_shift_start" as const, reject_also: [] };
    for (const c of result.cases) {
      for (const [i, seed] of SEEDS.entries()) {
        const independent = await logHash(runScenario({ ...c.case.scenario, seed }).events);
        expect(c.outcomes[i]?.truth_log_hash).toBe(independent);
        for (const arch of input.architectures) {
          const alone = await runBreakoutSeed(c.case, seed, { ...small, architectures: [arch] }, review);
          expect(alone.truth_log_hash, `${c.case.case_id} ${arch.id} seed ${seed}`).toBe(independent);
        }
      }
    }
  }, 60_000);

  it("Given the same input When SC12 runs again Then the result is byte-identical (determinism)", async () => {
    expect(canonicalJson(await runBreakout(small))).toBe(canonicalJson(result));
  });

  it("Given the medium-lot case and no equipment in it When C and C without equipment_links are scored Then they are equal in every metric (11.8.4: no equipment exists, so C-E equals C); only the reach differs", () => {
    const outcomes = result.cases[0]?.outcomes ?? [];
    for (const o of outcomes) {
      const [c, ce] = ["c_context", "c_context_minus_equipment_links"].map((id) => o.cells.find((x) => x.architecture === id));
      // the flag it reads is the one thing that differs, and it is printed as the reach of the architecture
      expect({ ...c, architecture: "", reach: null }).toEqual({ ...ce, architecture: "", reach: null });
      expect([c?.reach.equipment, ce?.reach.equipment]).toEqual([true, false]);
    }
  });

  it("Given an ablation pair (C against C without material_lot_links) When direction 1 is scored Then it is equal in every seed, because direction 1 reads no lot edge", () => {
    for (const c of result.cases) {
      for (const o of c.outcomes) {
        const [full, without] = ["c_context", "c_context_minus_material_lot_links"].map((id) => o.cells.find((x) => x.architecture === id));
        expect(without?.identification.direction_1, `${c.case.case_id} seed ${o.seed}`).toEqual(full?.identification.direction_1);
      }
    }
  });

  it("Given the equipment case When B (which has equipment_links) and C without material_lot_links are scored Then they read direction 3 alike and contain the same items (11.8.4 note on FX12e)", () => {
    for (const o of result.cases[1]?.outcomes ?? []) {
      const [b, cl] = ["b_lims_lite", "c_context_minus_material_lot_links"].map((id) => o.cells.find((x) => x.architecture === id));
      expect(b?.identification.direction_3).toEqual(cl?.identification.direction_3);
      expect(b?.containment).toEqual(cl?.containment);
    }
  });
});

describe("SC12 contamination break-out and walk-back: the report", () => {
  let report: BreakoutReport;
  beforeAll(async () => {
    const { input, head } = loadSc12(CONFIG, ["medium_lot", "seed_lot", "mycoplasma_nat_covers"]);
    report = buildBreakoutReport(await runBreakout({ ...input, seeds: SEEDS }), head);
  }, 120_000);

  it("Given the report When it is validated Then it fits schemas/breakout_report.schema.json, and with two seeds it says that it does not reach the minimum of A103", () => {
    const ajv = makeEvalAjv();
    expect(validates(ajv, "breakout_report", report), JSON.stringify(ajv.errors)).toBe(true);
    expect([report.n_seeds, report.min_seeds, report.meets_min_seeds]).toEqual([2, 20, false]);
  });

  it("Then it orders no architectures and carries no composite score: no rank, order or score key anywhere, the architectures in the order of the config", () => {
    expect(keysOf(report).filter((k) => /rank|order|score|composite|best|winner/i.test(k))).toEqual([]);
    for (const c of report.cases) expect(c.architectures.map((a) => a.id)).toEqual(IDS);
  });

  it("Then each case prints A176 (both delays), the lag, the assumed lag and, for the bacterial cases, the bioburden volume (A225), as inputs and not as findings", () => {
    const medium = report.cases.find((c) => c.case_id === "medium_lot");
    const input = (name: string) => medium?.inputs.find((i) => i.name === name);
    expect(input("signal_to_response")).toMatchObject({ ref: "A176", value: 2, unit: "h", source: "scenario_input" });
    expect(input("positive_to_hold")).toMatchObject({ ref: "A176", value: 4, unit: "h", source: "scenario_input" });
    expect(input("lag")).toMatchObject({ ref: "A139", value: 12, unit: "h", source: "profile_default" });
    expect(input("assumed_lag")).toMatchObject({ ref: "A139", value: 12, unit: "h", source: "decision_setting" });
    expect(input("bioburden_sample_volume_ml")).toMatchObject({ ref: "A225", value: 2, unit: "mL", source: "scenario_input" });
    expect(report.cases.find((c) => c.case_id === "seed_lot")?.inputs.find((i) => i.name === "lag")).toMatchObject({ value: 36, source: "scenario_input" });
  });

  it("Then the mycoplasma case prints the inputs of the event type (A219 to A224, A226) with their units, and the topology of every case is printed as A177", () => {
    const m = report.cases.find((c) => c.case_id === "mycoplasma_nat_covers");
    expect(m?.inputs.filter((i) => i.source === "scenario_input" && i.name !== "signal_to_response" && i.name !== "positive_to_hold").map((i) => [i.ref, i.unit]).sort()).toEqual([
      ["A219", "h"], ["A220", "d"], ["A221", "factor"], ["A222", "d"], ["A223", "factor"], ["A224", "flag"], ["A226", "mL"],
    ]);
    for (const c of report.cases) expect(c.topology.ref).toBe("A177");
    const lots = report.cases.find((c) => c.case_id === "medium_lot")?.topology.lots ?? [];
    expect(lots.find((l) => l.lot_id === "ML-3")?.units).toEqual(["U01", "U05"]);
    expect(lots.find((l) => l.lot_id === "ML-1")?.units).toEqual(["U01", "U02", "U03"]);
  });

  it("Then the report states the ruling on C29: the effects of mycoplasma come after the signalling unit is stopped and show on a sibling that signals later or with a longer lag", () => {
    expect(report.mycoplasma_note).toContain("지금대로 + 결과에 설명");
    expect(report.mycoplasma_note).toContain("come after the signalling unit is stopped");
    expect(report.mycoplasma_note).toContain("a sibling that signals later or with a longer lag, not on the signalling unit");
  });

  it("Given a ratio whose denominator is zero in every seed (the seed-lot case: every routine sample of U01 is drawn after its inoculation, so none is outside T) Then the row says none_occurred, with no median and a reason, never 0 or 1", () => {
    const row = report.cases.find((c) => c.case_id === "seed_lot")?.architectures.find((a) => a.id === "c_context")?.rows.find((r) => r.metric === "identification.direction_1.false_alarm");
    expect(row).toMatchObject({ status: "none_occurred", n_defined: 0, median: null, lo: null, hi: null });
    expect(row?.reason).toContain("denominator is zero in every seed");
    expect(row?.denominator).toContain("not in T");
  });

  it("Given a record that cannot read direction 3 (A has neither lot nor equipment links) Then its direction 3 rows say so, and one with only equipment links says that it reads equipment only", () => {
    const rows = (id: string) => report.cases.find((c) => c.case_id === "medium_lot")?.architectures.find((a) => a.id === id);
    const a = rows("a_manual");
    expect(a?.reach).toEqual({ direction3: false, lots: false, equipment: false });
    for (const r of a?.rows.filter((x) => x.metric.startsWith("identification.direction_3.")) ?? []) expect(r.reason).toContain("not reachable from this record");
    const b = rows("b_lims_lite");
    expect(b?.reach).toEqual({ direction3: true, lots: false, equipment: true });
    expect(b?.rows.find((r) => r.metric === "identification.direction_3.recall")?.reason).toContain("reads equipment only");
  });

  it("Then recall never stands without precision and the false-alarm rate: every direction has the three rows, each with its denominator in words", () => {
    for (const c of report.cases) {
      for (const a of c.architectures) {
        for (const d of [1, 3]) {
          const rows = ["recall", "precision", "false_alarm"].map((m) => a.rows.find((r) => r.metric === `identification.direction_${d}.${m}`));
          for (const r of rows) {
            expect(r, `${c.case_id} ${a.id} direction ${d}`).toBeDefined();
            expect(r?.denominator?.length ?? 0).toBeGreaterThan(10);
          }
        }
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { MYCOPLASMA_NOTE } from "../../src/experiments/assembly/breakout_report.ts";
import { answerBreakout, BREAKOUT_NEEDS, breakoutOffer } from "../../src/experiments/assembly/lab/breakout.ts";
import type { BreakoutAnswer, BreakoutResult } from "../../src/experiments/assembly/lab/breakout.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import { runScenario } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import { logHash } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { lookup } from "../support/scenarios.ts";
import { BREAKOUT_SCENARIOS, breakoutData } from "./breakout_data.ts";

// S3g, the Worker-facing function of the Break-out screen (docs/design/lab_ui.md sections 3, 4 and 12; spec 11.6, 11.8.12 C40). Expected values are typed by hand: what the design fixes (which
// record can read direction 3, that a record that cannot is not an empty set, the scripted event of the scenario file) is derived from the design and the scenario files; the counts of the
// medium-lot case at seed 9013 are pins typed from a first run of the engine (whose cells stand on the hand-typed fixtures FX12a, FX12e and FX12m of spec 11.8.4), not an oracle of their own.

const data = breakoutData();
const SEED = 9013; // the first seed of data/scenarios/experiments/sc12.json
const ARCHS = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links"];

const must = (a: BreakoutAnswer): BreakoutResult => {
  if (!a.ok) throw new Error(`refused: ${a.code} ${a.message}`);
  return a.result;
};
const run = async (extra: Record<string, unknown> = {}) => answerBreakout(data, { case: "sc12_medium_lot", architectures: ARCHS, seed: SEED, ...extra });
const arch = (r: BreakoutResult, id: string) => r.per_architecture.find((a) => a.architecture === id) ?? (() => { throw new Error(`no ${id}`); })();
const row = (r: BreakoutResult, id: string, metric: string) => arch(r, id).rows.find((x) => x.metric === metric) ?? (() => { throw new Error(`no row ${metric}`); })();

describe("what the build offers", () => {
  it("Given the bundle Then the cases are the five SC12 scenarios in this order with the event type and the origin of each scenario file", () => {
    const offer = breakoutOffer(data);
    expect(offer?.cases).toEqual([
      { id: "sc12_medium_lot", event_type: "bacterial", origin_kind: "medium_lot" },
      { id: "sc12_seed_lot", event_type: "bacterial", origin_kind: "seed_lot" },
      { id: "sc12_sampling", event_type: "bacterial", origin_kind: "sampling" },
      { id: "sc12_equipment", event_type: "bacterial", origin_kind: "shared_equipment" },
      { id: "sc12_mycoplasma", event_type: "mycoplasma", origin_kind: "medium_lot" },
    ]);
    expect([...BREAKOUT_SCENARIOS]).toEqual(offer?.cases.map((c) => c.id));
  });

  it("Given the experiment config Then the seed list is its twenty neutral seeds, typed from the file", () => {
    const seeds = breakoutOffer(data)?.seed_list ?? [];
    expect(seeds).toHaveLength(20);
    expect(seeds.slice(0, 3)).toEqual([9013, 9127, 9239]);
    expect(seeds.at(-1)).toBe(11047);
  });

  it("Given the flags direction 3 needs Then they are the two link flags, and both are flags of the engine", () => {
    expect(BREAKOUT_NEEDS).toEqual({ lots: "material_lot_links", equipment: "equipment_links" });
    for (const f of Object.values(BREAKOUT_NEEDS)) expect([...FLAG_NAMES]).toContain(f);
  });

  it("Given a build that bundles no break-out data Then it offers nothing and a request is refused as invalid_spec", async () => {
    expect(breakoutOffer(labData())).toBeNull();
    const a = await answerBreakout(labData(), { case: "sc12_medium_lot", architectures: ["a_manual"], seed: SEED });
    expect(a).toMatchObject({ ok: false, code: "invalid_spec" });
  });
});

describe("a request is checked, because a link is user input", () => {
  it.each([
    ["an unknown case", { case: "sc12_nope" }, /case/],
    ["a case that is not a string", { case: 3 }, /case/],
    ["no architecture", { architectures: [] }, /architecture/],
    ["architectures that are not a list", { architectures: "a_manual" }, /architecture/],
    ["an unknown architecture", { architectures: ["a_manual", "d_unknown"] }, /d_unknown/],
    ["an architecture named twice", { architectures: ["a_manual", "a_manual"] }, /repeated/],
    ["a date-shaped seed", { seed: 20260101 }, /seed|date/i],
    ["a seed that is not an integer", { seed: "x" }, /seed|integer/i],
  ])("Given %s Then the answer is invalid_spec with a message", async (_, extra, message) => {
    const a = await run(extra);
    expect(a).toMatchObject({ ok: false, code: "invalid_spec" });
    expect(a.ok ? "" : a.message).toMatch(message);
  });
});

describe("the medium-lot case, seed 9013", () => {
  it("Given the request Then the result is a simulation result of the scenario, the seed and the architectures in the order asked, with the engine version", async () => {
    const r = must(await run());
    expect(r).toMatchObject({ kind: "simulation_result", case: "sc12_medium_lot", scenario: "sc12_medium_lot", seed: SEED, architectures: ARCHS });
    expect(r.engine_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.per_architecture.map((a) => a.architecture)).toEqual(ARCHS);
  }, 60_000);

  it("Given the scenario file Then the scripted event and its inputs are printed with their ledger ids (typed from sc12_medium_lot.json)", async () => {
    const r = must(await run());
    expect(r.event).toMatchObject({ type: "bacterial", origin_kind: "medium_lot", origin_id: "ML-3", horizon_days: 21, horizon_ref: "A189", contaminated_at: { value: 48, unit: "h", ref: "A157" } });
    const input = (name: string) => r.inputs.find((i) => i.name === name);
    expect(input("signal_to_response")).toMatchObject({ value: 2, unit: "h", ref: "A176", source: "scenario_input" });
    expect(input("positive_to_hold")).toMatchObject({ value: 4, unit: "h", ref: "A176" });
    expect(input("bioburden_sample_volume_ml")).toMatchObject({ value: 2, unit: "mL", ref: "A225" });
    expect(input("assumed_lag")).toMatchObject({ value: 12, unit: "h", ref: "A139", source: "decision_setting" });
    expect(r.topology.ref).toBe("A177");
    expect(r.topology.lots.find((l) => l.lot_id === "ML-3")).toMatchObject({ kind: "medium", units: ["U01", "U05"], uses: [{ unit_id: "U01", at_h: 52 }, { unit_id: "U05", at_h: 62 }] });
  }, 60_000);

  it("Given the same truth run Then the truth log hash is the one of an independent run of the scenario, and the result holds no hidden field", async () => {
    const r = must(await run());
    const cfg = loadScenario(readJson("data", "scenarios", "sc12_medium_lot.json"), lookup);
    expect(r.truth_log_hash).toBe(await logHash(runScenario({ ...cfg, seed: SEED }).events));
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/contamination_onset|true_value|true_state|"noise"|answer_key|quirk/);
  }, 60_000);

  it("Given the plant Then the observed stream shows the first signal of U01, the deviation, the confirming draws and their results, all in time order", async () => {
    const r = must(await run());
    const types = r.observed.map((e) => e.type);
    expect(types[0]).toBe("signal_observed");
    expect(r.observed[0]).toMatchObject({ type: "signal_observed", unit_id: "U01", signal: "DO", limit: "low" });
    expect(types).toEqual(expect.arrayContaining(["deviation_opened", "unit_stopped", "confirm_sample_drawn", "confirm_result"]));
    expect(r.observed.map((e) => e.t)).toEqual([...r.observed.map((e) => e.t)].sort((a, b) => a - b));
    const drawn = r.observed.filter((e) => e.type === "confirm_sample_drawn").map((e) => (e as { sample_id: string }).sample_id);
    expect(drawn.slice(0, 2)).toEqual(["U01-CONF", "U02-CONF"]); // the `confirm` list of the scenario, one draw per unit at the first decision instant
  }, 60_000);
});

describe("direction 3 and the flags it needs (spec 11.8.2 rule S8)", () => {
  it("Given A, which has neither link flag Then direction 3 is not reachable: no set at all, and every direction 3 row is not_reachable with no value, never recall 0", async () => {
    const r = must(await run());
    const a = arch(r, "a_manual");
    expect(a.reach).toEqual({ direction3: false, lots: false, equipment: false });
    expect(a.walk.direction_3).toBeNull();
    for (const m of ["recall", "precision", "false_alarm"]) {
      const x = row(r, "a_manual", `identification.direction_3.${m}`);
      expect(x).toMatchObject({ status: "not_reachable", value: null, num: null });
      expect(x.reason).toMatch(/^not reachable from this record/);
    }
    // direction 1 needs no flag: the walk-back looked and found the batch and its results
    expect(a.walk.direction_1.length).toBeGreaterThan(0);
    expect(row(r, "a_manual", "identification.direction_1.recall")).toMatchObject({ status: "reported", num: 7, den: 7, value: 1 });
  }, 60_000);

  it("Given B, which has equipment_links but not material_lot_links Then direction 3 is reachable for equipment only, and an empty set is a set that was looked for", async () => {
    const r = must(await run());
    const b = arch(r, "b_lims_lite");
    expect(b.reach).toEqual({ direction3: true, lots: false, equipment: true });
    expect(b.walk.direction_3).toEqual([]); // the walk-back looked at equipment, and the origin is a lot: nothing returned, which is not "not reachable"
    expect(row(r, "b_lims_lite", "identification.direction_3.recall")).toMatchObject({ status: "reported", num: 0, den: 2, value: 0 });
    expect(row(r, "b_lims_lite", "identification.direction_3.precision")).toMatchObject({ status: "none_occurred", num: 0, den: 0, value: null });
    expect(row(r, "b_lims_lite", "identification.direction_3.recall").reason).toMatch(/equipment only/);
  }, 60_000);

  it("Given C Then direction 3 returns the contaminated lot; with material_lot_links off (C minus it) the lot is not in the set", async () => {
    const r = must(await run());
    expect(arch(r, "c_context").reach).toEqual({ direction3: true, lots: true, equipment: true });
    expect(arch(r, "c_context").walk.direction_3).toContainEqual(expect.objectContaining({ kind: "material_lot", id: "ML-3" }));
    expect(row(r, "c_context", "identification.direction_3.recall")).toMatchObject({ status: "reported", num: 2, den: 2, value: 1 });
    const cl = arch(r, "c_context_minus_material_lot_links");
    expect(cl.reach).toEqual({ direction3: true, lots: false, equipment: true });
    expect(cl.walk.direction_3?.some((i) => i.kind === "material_lot")).toBe(false);
    expect(row(r, "c_context_minus_material_lot_links", "identification.direction_3.recall")).toMatchObject({ num: 0, den: 2 });
  }, 60_000);

  it("Given every row Then recall comes with precision and false alarm of the same direction, and there is no composite score, rank or order key", async () => {
    const r = must(await run());
    for (const a of r.per_architecture) {
      const metrics = a.rows.map((x) => x.metric);
      for (const d of [1, 3]) expect(["recall", "precision", "false_alarm"].map((m) => metrics.includes(`identification.direction_${d}.${m}`))).toEqual([true, true, true]);
    }
    const keys = JSON.stringify(r).match(/"[a-z_]+":/g) ?? [];
    expect(keys.filter((k) => /rank|score|order|best|winner/.test(k))).toEqual([]);
  }, 60_000);
});

describe("holds and retro-flags (rule S9, VR-022)", () => {
  it("Given A and B, which lack the flags VR-022 needs Then no result is re-flagged and the record says VR-022 was not evaluable; C re-flags and A and B do not", async () => {
    const r = must(await run());
    const count = (id: string, type: string) => arch(r, id).events.filter((e) => e.type === type).length;
    expect(count("a_manual", "result_reflagged")).toBe(0);
    expect(count("b_lims_lite", "result_reflagged")).toBe(0);
    expect(arch(r, "a_manual").not_evaluable.map((x) => x.rule)).toEqual(["VR-022"]);
    expect(arch(r, "c_context").not_evaluable).toEqual([]);
    expect(count("c_context", "result_reflagged")).toBeGreaterThan(0);
    expect(row(r, "a_manual", "retro_flag_completeness")).toMatchObject({ num: 0, den: 6 });
    expect(row(r, "c_context", "retro_flag_completeness")).toMatchObject({ num: 6, den: 6, value: 1 });
  }, 60_000);

  it("Given the events of an architecture Then they are in time order, and a hold names the item it holds", async () => {
    const r = must(await run());
    const events = arch(r, "c_context").events;
    expect(events.map((e) => e.t)).toEqual([...events.map((e) => e.t)].sort((a, b) => a - b));
    const placed = events.filter((e) => e.type === "hold_placed");
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.every((e) => typeof e.target_id === "string" && typeof e.target_kind === "string")).toBe(true);
    expect(placed.some((e) => e.target_kind === "material_lot" && e.target_id === "ML-3")).toBe(true);
  }, 60_000);
});

describe("determinism and plain data", () => {
  it("Given the same request twice Then the results are equal; asking for C alone gives the C view of the longer request", async () => {
    const a = must(await run());
    const b = must(await run());
    expect(b).toEqual(a);
    const alone = must(await run({ architectures: ["c_context"] }));
    expect(alone.per_architecture[0]).toEqual(arch(a, "c_context"));
  }, 120_000);

  it("Given the result Then it survives structuredClone and JSON unchanged (a message of plain data)", async () => {
    const r = must(await run());
    expect(structuredClone(r)).toEqual(r);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  }, 60_000);
});

describe("the other cases", () => {
  it("Given the mycoplasma case Then the event is the mycoplasma type with the inputs A219 to A224 and A226 printed, and the C29 sentence is the report's", async () => {
    const r = must(await answerBreakout(data, { case: "sc12_mycoplasma", architectures: ["c_context"], seed: SEED }));
    expect(r.event.type).toBe("mycoplasma");
    const refs = r.inputs.map((i) => i.ref);
    for (const id of ["A219", "A220", "A221", "A222", "A223", "A224", "A226", "A138", "A176"]) expect(refs, id).toContain(id);
    expect(r.c29).toBe(MYCOPLASMA_NOTE);
  }, 120_000);

  it("Given a bacterial case Then there is no C29 sentence", async () => {
    expect(must(await run()).c29).toBeNull();
  }, 60_000);

  it.each(BREAKOUT_SCENARIOS)("Given %s Then the case runs under A and C and every row has a status", async (id) => {
    const r = must(await answerBreakout(data, { case: id, architectures: ["a_manual", "c_context"], seed: SEED }));
    expect(r.per_architecture).toHaveLength(2);
    for (const a of r.per_architecture) expect(a.rows).toHaveLength(20); // rule S10 and C40: 20 rows per architecture
  }, 120_000);
});

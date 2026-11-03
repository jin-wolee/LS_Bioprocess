import { beforeAll, describe, expect, it } from "vitest";
import { answerBreakout } from "../../src/experiments/assembly/lab/breakout.ts";
import type { BreakoutResult } from "../../src/experiments/assembly/lab/breakout.ts";
import type { PlantKept } from "../../src/experiments/assembly/lab/plant.ts";
import { answerPlantCase, checkCaseSpec } from "../../src/experiments/assembly/lab/plant_case.ts";
import type { ScenePlan } from "../../src/experiments/assembly/lab/plant_plan.ts";
import { logHash } from "../../src/trace.ts";
import { breakoutData } from "../lab/breakout_data.ts";
import { screenRun } from "../support/breakout_screen.ts";
import { labData } from "../support/lab_data.ts";

// P7b (docs/design/plant_ui.md sections 3.1, 4.1 and 6, rule 11): a break-out case as a plant run, at the level of the engine (the Worker path is engine/tests/lab/worker_case.test.ts). One describe for
// each of the five bundled cases (SC12). Every expected value is typed by hand from the case's own scenario file and the break-out rules of docs/design/simulation_spec.md section 11.8.2:
//   - the six reactors are inoculated at 08:00 plus 15 minutes each: 28800, 29700, 30600, 31500, 32400 and 33300 s (inoculation_start_min 480, inoculation_step_min 15);
//   - a topology entry with `at` of 30 h is 108000 s, 52 h is 187200 s and 62 h is 223200 s; a seed lot is consumed at the inoculation of its unit;
//   - the onset of a unit is its first consumption of the contaminated item at or after the instant it became contaminated (C3); the signal is the first sensor tick at or after onset plus the lag
//     (12 h = 43200 s for the bacterial type, 48 h = 172800 s for mycoplasma, 36 h = 129600 s where the seed-lot file sets it), and the ticks of a unit are 60 s apart from its inoculation (C2);
//   - the first decision is the first signal plus d1 (2 h = 7200 s), and each affected unit stops at its own signal plus d1 (S2); the units of the `confirm` list are drawn at the first decision as
//     `<unit>-CONF`, the later signals draw `<unit>-SIG-CONF` at their own stop (C5); a result arrives at the draw plus the turnaround of its test (5 d, 14 d; 1 d, 8 d, 28 d), `detected` exactly
//     when the unit is affected (S3).

const data = breakoutData();
// the five records of the Break-out form: A, B, C and C without each of the two link flags
const ARCH = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"];
const SEED = 9013;
const INOC = [28800, 29700, 30600, 31500, 32400, 33300];
const H30 = 108000;
const H52 = 187200;
const H62 = 223200;

interface Built {
  plan: ScenePlan;
  kept: PlantKept;
  hashes: { truth: string; cells: Record<string, string> };
}
const build = async (id: string, architectures: string[] = ARCH, seed = SEED, actions: unknown[] = []): Promise<Built> => {
  const out = await answerPlantCase(data, { case: id, architectures, seed, actions });
  if (!out.ok) throw new Error(`${id}: ${out.code}: ${out.message}`);
  return { plan: out.answer.plan, kept: out.kept, hashes: out.answer.hashes };
};

const seedLot = (k: number) => ({ id: `SL-${k}`, kind: "seed", uses: [{ unit: k - 1, t: INOC[k - 1] }] });
const medium = (id: string, units: number[], t: number) => ({ id, kind: "medium", uses: units.map((unit) => ({ unit, t })) });
const SEED_LOTS_1_TO_6 = [1, 2, 3, 4, 5, 6].map(seedLot);

const marksOf = (plan: ScenePlan, kind: string): [number, number, string | null][] =>
  plan.marks.filter((m) => m.kind === kind).map((m): [number, number, string | null] => [m.t, m.unit, m.item]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const confirmSamples = (plan: ScenePlan): [string, number, number, boolean][] =>
  plan.samples.filter((s) => s.kind === "confirm").map((s): [string, number, number, boolean] => [s.id, s.unit, s.drawn_s as number, s.skipped]);
const confirmsOf = (plan: ScenePlan): [string, string, number, string][] =>
  (plan.confirms ?? []).map((c): [string, string, number, string] => [(plan.samples[c.sample] as ScenePlan["samples"][number]).id, c.test, c.result_s, c.outcome]);

let medium_lot: Built;
beforeAll(async () => {
  medium_lot = await build("sc12_medium_lot");
}, 120_000);

describe("SC12 medium lot: the plan of the case", () => {
  it("Given the case at seed 9013 under the five records Then the layout is one bay of six with the bench vessel and the ids of the lots and no equipment, in string order", () => {
    const { plan } = medium_lot;
    expect(plan.seed).toBe(SEED);
    expect(plan.horizon_s).toBe(21 * 86400);
    expect(plan.layout.bays).toEqual([{ size: 6, profile: "bench_manual" }]);
    expect(plan.layout.architectures).toEqual(ARCH);
    expect(plan.layout.items).toEqual({ lots: ["ML-1", "ML-2", "ML-3", "SL-1", "SL-2", "SL-3", "SL-4", "SL-5", "SL-6"], equipment: [] });
  });

  it("Given the topology of the file Then the lots are the three medium lots and the six seed lots, each with the units and the instants that consume it", () => {
    expect(medium_lot.plan.lots).toEqual([medium("ML-1", [0, 1, 2], H30), medium("ML-2", [3, 4, 5], H30), { id: "ML-3", kind: "medium", uses: [{ unit: 0, t: H52 }, { unit: 4, t: H62 }] }, ...SEED_LOTS_1_TO_6]);
    expect(medium_lot.plan.equipment).toEqual([]);
  });

  it("Given the marks of the medium additions Then each use of a lot is a mark of its unit at the same instant with the lot as its item", () => {
    const additions = medium_lot.plan.marks.filter((m) => m.kind === "medium_addition");
    expect(additions).toHaveLength(8); // 6 for ML-1 and ML-2, 2 for ML-3
    const fromLots = medium_lot.plan.lots?.flatMap((l) => (l.kind === "medium" ? l.uses.map((u) => [u.t, u.unit, l.id] as const) : [])).sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
    expect(additions.map((m) => [m.t, m.unit, m.item] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1] || ((a[2] as string) < (b[2] as string) ? -1 : 1))).toEqual(fromLots);
  });

  it("Given ML-3 consumed by U01 at 52 h and U05 at 62 h Then U01 signals at 64 h and U05 at 74 h, one deviation DEV-1 opens at the first, and each unit stops 2 h after its own signal", () => {
    expect(marksOf(medium_lot.plan, "signal_observed")).toEqual([[230400, 0, "DO"], [266400, 4, "DO"]]);
    expect(marksOf(medium_lot.plan, "deviation_opened")).toEqual([[230400, 0, "DEV-1"]]);
    expect(marksOf(medium_lot.plan, "unit_stopped").map(([t, unit]) => [t, unit])).toEqual([[237600, 0], [273600, 4]]);
    // a stopped unit ends at its stop; the other four are harvested by the process's own rule, later than any stop
    const ends = medium_lot.plan.units.map((u) => u.end_s as number);
    expect([ends[0], ends[4]]).toEqual([237600, 273600]);
    expect([1, 2, 3, 5].every((i) => (ends[i] as number) > 273600)).toBe(true);
  });

  it("Given the confirm list U01 and U02 Then the confirming samples are U01-CONF and U02-CONF at the first decision and U05-SIG-CONF at the stop of U05, after the planned samples", () => {
    const { plan } = medium_lot;
    expect(confirmSamples(plan)).toEqual([["U01-CONF", 0, 237600, false], ["U02-CONF", 1, 237600, false], ["U05-SIG-CONF", 4, 273600, false]]);
    const planned = plan.samples.filter((s) => s.kind === "routine");
    expect(planned.length + 3).toBe(plan.samples.length);
    expect(plan.samples.slice(0, planned.length).every((s) => s.kind === "routine")).toBe(true);
    expect(planned.map((s) => s.id)).toEqual(planned.map((s) => s.id).sort());
    const conf = plan.samples.find((s) => s.id === "U01-CONF");
    expect(conf).toMatchObject({ planned_s: 237600, drawn_s: 237600, arrived_s: null, label: null, kind: "confirm", skipped: false, visits: [] });
    expect(conf?.operator).toBeGreaterThanOrEqual(0);
    expect(conf?.operator).toBeLessThan(plan.staff.length);
  });

  it("Given a bioburden test of 5 d and a sterility test of 14 d Then the results fall at the draw plus those days, detected for the affected units only", () => {
    expect(confirmsOf(medium_lot.plan)).toEqual([
      ["U01-CONF", "bioburden", 669600, "detected"],
      ["U02-CONF", "bioburden", 669600, "not_detected"],
      ["U05-SIG-CONF", "bioburden", 705600, "detected"],
      ["U01-CONF", "sterility", 1447200, "detected"],
      ["U02-CONF", "sterility", 1447200, "not_detected"],
      ["U05-SIG-CONF", "sterility", 1483200, "detected"],
    ]);
  });

  it("Given the five records Then each hall has holds, in time order, and the first thing every record does is hold the batch of U01 at the first decision; only a record with lot links holds a lot", () => {
    const { plan } = medium_lot;
    const hall = (id: string) => plan.records.find((r) => r.architecture === id) as ScenePlan["records"][number];
    for (const r of plan.records) {
      const holds = r.holds ?? [];
      expect(holds.length, r.architecture).toBeGreaterThan(0);
      expect(holds.map((h) => h.t), r.architecture).toEqual([...holds.map((h) => h.t)].sort((a, b) => a - b));
      // at one instant the events follow the order of plant_ui.md section 4.1: placed, re-flagged, quarantined, released, rejected, closed
      const order = ["hold_placed", "result_reflagged", "hold_quarantined", "hold_released", "hold_rejected", "deviation_closed"];
      for (const [i, h] of holds.entries()) {
        const before = holds[i - 1];
        if (before && before.t === h.t) expect(order.indexOf(before.event), `${r.architecture} at ${h.t}`).toBeLessThanOrEqual(order.indexOf(h.event));
      }
      expect(new Set(holds.map((h) => JSON.stringify(h))).size, `${r.architecture}: identical entries are one`).toBe(holds.length);
      expect(holds[0], r.architecture).toEqual({ t: 237600, event: "hold_placed", on: "unit", target: 0 });
    }
    const lotHolds = (id: string) => (hall(id).holds ?? []).filter((h) => h.on === "lot");
    for (const id of ["a_manual", "b_lims_lite", "c_context_minus_material_lot_links"]) expect(lotHolds(id), id).toEqual([]);
    expect(lotHolds("c_context")).toContainEqual({ t: 237600, event: "hold_placed", on: "lot", target: 2 }); // ML-3 is the third lot
    expect(lotHolds("c_context_minus_equipment_links")).toContainEqual({ t: 237600, event: "hold_placed", on: "lot", target: 2 });
  });
});

describe("SC12 medium lot: one truth with the Break-out screen", () => {
  it("Given the same case, seed and records Then the truth hash is the screen's truth_log_hash and the digest of each cell is the digest of the screen's cell", async () => {
    const screen = await screenRun(data, "sc12_medium_lot", SEED, ARCH);
    expect(medium_lot.hashes.truth).toBe(screen.truth);
    expect(medium_lot.hashes.cells).toEqual(screen.cells);
    expect(Object.keys(medium_lot.hashes.cells)).toEqual(ARCH);
    expect(await logHash(medium_lot.kept.events)).toBe(screen.truth);
  }, 60_000);

  it("Given the screen's answer for the case Then the holds of each hall are its investigation events, one for one: the same instants and the same items", async () => {
    const screen = await screenRun(data, "sc12_medium_lot", SEED, ARCH);
    const answer = await answerBreakout(data, { case: "sc12_medium_lot", architectures: ARCH, seed: SEED });
    if (!answer.ok) throw new Error(answer.message);
    const result: BreakoutResult = answer.result;
    const { plan } = medium_lot;
    for (const [i, a] of result.per_architecture.entries()) {
      const dataset = (screen.run.investigations[i] as { dataset: { result: { result_id: string; request_id: string }[] } }).dataset;
      const sampleOf = (resultId: string | undefined) => plan.samples.findIndex((s) => s.id === dataset.result.find((r) => r.result_id === resultId)?.request_id);
      const expected = a.events.map((e) => {
        if (e.type === "deviation_closed") return { t: e.t, event: e.type, on: null, target: null };
        if (e.type === "result_reflagged") return { t: e.t, event: e.type, on: "sample", target: sampleOf(e.result_id) };
        const id = e.target_id;
        const [on, target] =
          e.target_kind === "batch" ? ["unit", plan.units.findIndex((u) => u.batch === id)]
          : e.target_kind === "material_lot" ? ["lot", (plan.lots ?? []).findIndex((l) => l.id === id)]
          : e.target_kind === "equipment" ? ["equipment", (plan.equipment ?? []).findIndex((q) => q.id === id)]
          : ["sample", sampleOf(id)];
        return { t: e.t, event: e.type, on, target };
      });
      const key = (h: object) => JSON.stringify(h);
      const unique = [...new Set(expected.map(key))].sort();
      const planned = ((plan.records[i] as ScenePlan["records"][number]).holds ?? []).map(key).sort();
      expect(planned, a.architecture).toEqual(unique);
      expect(expected.every((h) => h.target === null || h.target >= 0), a.architecture).toBe(true);
    }
  }, 60_000);
});

describe("SC12 seed lot: the plan of the case", () => {
  let built: Built;
  beforeAll(async () => {
    built = await build("sc12_seed_lot");
  }, 120_000);

  it("Given SL-A for U01 to U03 and SL-B for U04 to U06 Then the lots are the two seed lots and ML-1, each use at the inoculation of its unit", () => {
    expect(built.plan.layout.items).toEqual({ lots: ["ML-1", "SL-A", "SL-B"], equipment: [] });
    expect(built.plan.lots).toEqual([
      medium("ML-1", [0, 1, 2, 3, 4, 5], H30),
      { id: "SL-A", kind: "seed", uses: [0, 1, 2].map((unit) => ({ unit, t: INOC[unit] })) },
      { id: "SL-B", kind: "seed", uses: [3, 4, 5].map((unit) => ({ unit, t: INOC[unit] })) },
    ]);
  });

  it("Given a lag of 36 h and an origin from the start Then U01, U02 and U03 signal 36 h after their inoculation, and each stops 2 h after its own signal", () => {
    expect(marksOf(built.plan, "signal_observed")).toEqual([[158400, 0, "DO"], [159300, 1, "DO"], [160200, 2, "DO"]]);
    expect(marksOf(built.plan, "deviation_opened")).toEqual([[158400, 0, "DEV-1"]]);
    expect(marksOf(built.plan, "unit_stopped").map(([t, unit]) => [t, unit])).toEqual([[165600, 0], [166500, 1], [167400, 2]]);
  });

  it("Given the confirm list U01 and U04 Then U01-CONF and U04-CONF are drawn at 165600 s, and U02 and U03 draw their own at their stops; U04 is not affected", () => {
    expect(confirmSamples(built.plan)).toEqual([["U01-CONF", 0, 165600, false], ["U04-CONF", 3, 165600, false], ["U02-SIG-CONF", 1, 166500, false], ["U03-SIG-CONF", 2, 167400, false]]);
    const outcome = (id: string) => confirmsOf(built.plan).filter((c) => c[0] === id).map((c) => c[3]);
    expect(outcome("U01-CONF")).toEqual(["detected", "detected"]);
    expect(outcome("U04-CONF")).toEqual(["not_detected", "not_detected"]);
    expect(outcome("U02-SIG-CONF")).toEqual(["detected", "detected"]);
    expect(outcome("U03-SIG-CONF")).toEqual(["detected", "detected"]);
  });

  it("Given the same case Then its truth hash and cells are the Break-out screen's", async () => {
    const screen = await screenRun(data, "sc12_seed_lot", SEED, ARCH);
    expect(built.hashes).toEqual({ truth: screen.truth, cells: screen.cells });
  }, 60_000);
});

describe("SC12 sampling: the plan of the case", () => {
  let built: Built;
  beforeAll(async () => {
    built = await build("sc12_sampling");
  }, 120_000);

  it("Given the same topology as the medium-lot case with a sampling origin Then the lots are the same entries, and nothing in them says which case has a contaminated lot", () => {
    expect(built.plan.lots).toEqual(medium_lot.plan.lots);
    expect(built.plan.layout.items).toEqual(medium_lot.plan.layout.items);
  });

  it("Given the origin is the draw of U01-D02-1 Then U01 alone signals, on the first tick at or after that draw plus 12 h, and stops 2 h later", () => {
    const draw = built.plan.samples.find((s) => s.id === "U01-D02-1")?.drawn_s as number;
    expect(draw).toBeGreaterThan(86400 * 2); // drawn on day 2
    const signal = 28800 + Math.ceil((draw + 43200 - 28800) / 60) * 60; // the ticks of U01 start at its inoculation, 60 s apart (C2)
    expect(marksOf(built.plan, "signal_observed")).toEqual([[signal, 0, "DO"]]);
    expect(marksOf(built.plan, "deviation_opened")).toEqual([[signal, 0, "DEV-1"]]);
    expect(marksOf(built.plan, "unit_stopped").map(([t, unit]) => [t, unit])).toEqual([[signal + 7200, 0]]);
    expect(confirmSamples(built.plan)).toEqual([["U01-CONF", 0, signal + 7200, false], ["U02-CONF", 1, signal + 7200, false]]);
    expect(confirmsOf(built.plan).filter((c) => c[1] === "bioburden")).toEqual([["U01-CONF", "bioburden", signal + 7200 + 432000, "detected"], ["U02-CONF", "bioburden", signal + 7200 + 432000, "not_detected"]]);
  });

  it("Given the same case Then its truth hash and cells are the Break-out screen's", async () => {
    const screen = await screenRun(data, "sc12_sampling", SEED, ARCH);
    expect(built.hashes).toEqual({ truth: screen.truth, cells: screen.cells });
  }, 60_000);
});

describe("SC12 equipment: the plan of the case", () => {
  let built: Built;
  beforeAll(async () => {
    built = await build("sc12_equipment");
  }, 120_000);

  it("Given the transfer lines TL-1 and TL-2 Then the plan lists them as equipment with the unit and the instant of each use, and no ML-3 among the lots", () => {
    expect(built.plan.layout.items).toEqual({ lots: ["ML-1", "ML-2", "SL-1", "SL-2", "SL-3", "SL-4", "SL-5", "SL-6"], equipment: ["TL-1", "TL-2"] });
    expect(built.plan.equipment).toEqual([
      { id: "TL-1", uses: [{ unit: 0, t: H52 }, { unit: 1, t: H62 }] },
      { id: "TL-2", uses: [{ unit: 2, t: H52 }, { unit: 3, t: H62 }] },
    ]);
    expect(built.plan.lots).toEqual([medium("ML-1", [0, 1, 2], H30), medium("ML-2", [3, 4, 5], H30), ...SEED_LOTS_1_TO_6]);
    const uses = built.plan.marks.filter((m) => m.kind === "equipment_use").map((m) => [m.t, m.unit, m.item] as const);
    expect(uses).toHaveLength(4);
  });

  it("Given TL-1 used by U01 at 52 h and by U02 at 62 h Then U01 signals at 64 h and U02 at 74 h, and U01, U02 and the later draw of U02 are confirmed", () => {
    expect(marksOf(built.plan, "signal_observed")).toEqual([[230400, 0, "DO"], [266400, 1, "DO"]]);
    expect(confirmSamples(built.plan)).toEqual([["U01-CONF", 0, 237600, false], ["U02-CONF", 1, 237600, false], ["U02-SIG-CONF", 1, 273600, false]]);
    expect(confirmsOf(built.plan).filter((c) => c[1] === "sterility")).toEqual([
      ["U01-CONF", "sterility", 1447200, "detected"],
      ["U02-CONF", "sterility", 1447200, "detected"],
      ["U02-SIG-CONF", "sterility", 1483200, "detected"],
    ]);
  });

  it("Given the records Then only a record with equipment links holds an equipment item", () => {
    const equipmentHolds = (id: string) => (built.plan.records.find((r) => r.architecture === id)?.holds ?? []).filter((h) => h.on === "equipment");
    for (const id of ["a_manual", "c_context_minus_equipment_links"]) expect(equipmentHolds(id), id).toEqual([]);
    expect(equipmentHolds("c_context").length).toBeGreaterThan(0);
    expect(equipmentHolds("b_lims_lite").length).toBeGreaterThan(0);
  });

  it("Given the same case Then its truth hash and cells are the Break-out screen's", async () => {
    const screen = await screenRun(data, "sc12_equipment", SEED, ARCH);
    expect(built.hashes).toEqual({ truth: screen.truth, cells: screen.cells });
  }, 60_000);
});

describe("SC12 mycoplasma: the plan of the case", () => {
  let built: Built;
  beforeAll(async () => {
    built = await build("sc12_mycoplasma");
  }, 120_000);

  it("Given a horizon of 33 days and the medium-lot topology Then the horizon is 33 days and the lots are those of the medium-lot case", () => {
    expect(built.plan.horizon_s).toBe(33 * 86400);
    expect(built.plan.lots).toEqual(medium_lot.plan.lots);
  });

  it("Given a lag of 48 h Then U01 signals at 100 h and U05 at 110 h, and each stops 2 h later", () => {
    expect(marksOf(built.plan, "signal_observed")).toEqual([[360000, 0, "DO"], [396000, 4, "DO"]]);
    expect(marksOf(built.plan, "deviation_opened")).toEqual([[360000, 0, "DEV-1"]]);
    expect(marksOf(built.plan, "unit_stopped").map(([t, unit]) => [t, unit])).toEqual([[367200, 0], [403200, 4]]);
  });

  it("Given a nucleic-acid test of 1 d, indicator cells of 8 d and a culture of 28 d Then the nine results fall at the draw plus those days", () => {
    expect(confirmsOf(built.plan)).toEqual([
      ["U01-CONF", "nucleic_acid_test", 453600, "detected"],
      ["U02-CONF", "nucleic_acid_test", 453600, "not_detected"],
      ["U05-SIG-CONF", "nucleic_acid_test", 489600, "detected"],
      ["U01-CONF", "mycoplasma_indicator_cells", 1058400, "detected"],
      ["U02-CONF", "mycoplasma_indicator_cells", 1058400, "not_detected"],
      ["U05-SIG-CONF", "mycoplasma_indicator_cells", 1094400, "detected"],
      ["U01-CONF", "mycoplasma_culture", 2786400, "detected"],
      ["U02-CONF", "mycoplasma_culture", 2786400, "not_detected"],
      ["U05-SIG-CONF", "mycoplasma_culture", 2822400, "detected"],
    ]);
  });

  it("Given the same case Then its truth hash and cells are the Break-out screen's", async () => {
    const screen = await screenRun(data, "sc12_mycoplasma", SEED, ARCH);
    expect(built.hashes).toEqual({ truth: screen.truth, cells: screen.cells });
  }, 60_000);
});

describe("A case is checked as the Break-out request is", () => {
  const ask = (extra: Record<string, unknown>, d = data) => checkCaseSpec(d, { case: "sc12_medium_lot", architectures: ["a_manual", "c_context"], seed: SEED, actions: [], ...extra });

  it("Given a build with no SC12 file (the public build) Then a case is refused as the breakout request refuses it: invalid_spec with the same message", async () => {
    const refused = ask({}, labData());
    expect(refused).toEqual({ ok: false, code: "invalid_spec", message: "this build does not offer the Break-out screen" });
    const screen = await answerBreakout(labData(), { case: "sc12_medium_lot", architectures: ["a_manual"], seed: SEED });
    expect(screen).toEqual(refused);
  });

  it.each([
    ["an unknown case", { case: "sc12_nope" }, "unknown case"],
    ["no architecture", { architectures: [] }, "architectures"],
    ["an unknown architecture", { architectures: ["nope"] }, "unknown architecture"],
    ["a repeated architecture", { architectures: ["a_manual", "a_manual"] }, "repeated"],
    ["a date-shaped seed", { seed: 20260101 }, ""],
  ])("Given %s Then invalid_spec", (_, extra, word) => {
    const refused = ask(extra);
    expect(refused).toMatchObject({ ok: false, code: "invalid_spec" });
    if (!refused.ok) expect(refused.message).toContain(word);
  });

  it("Given a key the form does not have, or a run beside the case Then invalid_spec", () => {
    expect(ask({ colour: "red" })).toMatchObject({ ok: false, code: "invalid_spec", message: expect.stringContaining("colour") });
    expect(ask({ run: {} })).toMatchObject({ ok: false, code: "invalid_spec" });
  });

  it("Given set_capture_path Then it is refused as unknown_target with its index, as the breakout request refuses it", () => {
    const actions = [{ kind: "add_feed", at: 100020, unit_id: "U03" }, { kind: "set_capture_path", at: 0, path: "adapter_ingest" }];
    expect(ask({ actions })).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 1 });
  });

  it("Given a feed on U01 before it is inoculated Then it is refused as outside_window with its index", () => {
    expect(ask({ actions: [{ kind: "add_feed", at: 1020, unit_id: "U01" }] })).toMatchObject({ ok: false, code: "refused", reason: "outside_window", index: 0 });
  });
});

describe("An action on a case", () => {
  it("Given a feed on U03 at day 3 Then the truth is the one the Break-out screen gives for the same actions, and not the truth without the feed", async () => {
    const actions = [{ kind: "add_feed", at: 3 * 86400 + 36000, unit_id: "U03" }];
    const built = await build("sc12_medium_lot", ["a_manual", "c_context"], SEED, actions);
    const screen = await answerBreakout(data, { case: "sc12_medium_lot", architectures: ["a_manual", "c_context"], seed: SEED, actions });
    if (!screen.ok) throw new Error(screen.message);
    expect(built.hashes.truth).toBe(screen.result.truth_log_hash);
    expect(built.hashes.truth).not.toBe(medium_lot.hashes.truth);
    expect(built.plan.marks.some((m) => m.unit === 2 && m.kind === "feed" && m.source === "scripted" && m.t === 3 * 86400 + 36000)).toBe(true);
  }, 60_000);
});

// The plan is made from the very run its truth hash names (a second projection of the truth log, written here, which the plan builder does not use): every draw, signal, medium addition, equipment use and
// confirming result of the log is in the plan at its instant, and the plan holds nothing else of those kinds.
describe.each(["sc12_medium_lot", "sc12_seed_lot", "sc12_sampling", "sc12_equipment", "sc12_mycoplasma"])("%s: the plan and the truth log it was made from", (id) => {
  let built: Built;
  beforeAll(async () => {
    built = await build(id, ["a_manual", "c_context"]);
  }, 120_000);

  it("Given the case Then the draws, the signals, the lot and equipment uses and the confirming results of the plan are those of the truth log, and the seed is the request's", () => {
    const { plan, kept } = built;
    const log = kept.events;
    const unit = (unit_id: string): number => Number(unit_id.slice(1)) - 1;
    const sorted = <T>(rows: T[]): string[] => rows.map((r) => JSON.stringify(r)).sort();
    expect(plan.seed).toBe(SEED);
    expect(sorted(plan.samples.filter((s) => s.kind === "routine" && !s.skipped && s.drawn_s !== null).map((s) => [s.id, s.drawn_s])))
      .toEqual(sorted(log.flatMap((e) => (e.type === "sample_drawn" ? [[e.sample_id, e.t]] : []))));
    expect(sorted(plan.marks.filter((m) => m.kind === "signal_observed").map((m) => [m.t, m.unit])))
      .toEqual(sorted(log.flatMap((e) => (e.type === "signal_observed" ? [[e.t, unit(e.unit_id)]] : []))));
    expect(sorted((plan.lots ?? []).flatMap((l) => l.uses.map((u) => [l.id, l.kind, u.unit, u.t]))))
      .toEqual(sorted(log.flatMap((e) => (e.type === "inoculation" && e.seed_lot_id !== undefined ? [[e.seed_lot_id, "seed", unit(e.unit_id), e.t]] : e.type === "process_event" && e.lot_id !== undefined ? [[e.lot_id, "medium", unit(e.unit_id), e.t]] : []))));
    expect(sorted((plan.equipment ?? []).flatMap((q) => q.uses.map((u) => [q.id, u.unit, u.t]))))
      .toEqual(sorted(log.flatMap((e) => (e.type === "process_event" && e.equipment_id !== undefined ? [[e.equipment_id, unit(e.unit_id), e.t]] : []))));
    expect(sorted(confirmsOf(plan))).toEqual(sorted(log.flatMap((e) => (e.type === "confirm_result" ? [[e.sample_id, e.test, e.t, e.outcome]] : []))));
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import type { ScenarioRun } from "../../src/run.ts";
import { runScenario } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import { canonicalKey, streamSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { lookup, rawScenario } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";
import { H, configOf, docOf, eventsOf, fx12a, fx12e, h, q, runOfDoc, set } from "./support.ts";
import { docOfM, fx12m, mycoplasmaInputs } from "./support_m.ts";

// The truth side of the fixes from the S3 adversary pass (spec 11.8.13): F4 (a multiplier moment at the inoculation), F5 (the loader's refusals), F8 (each signal draws its own confirming sample, the
// author's ruling of 2026-10-31) and F9 (one pH truth). Each case starts from the input of the adversary's probe or from the fixture text; every expected value is typed from the amended rule
// (C5, C6, C7, C8, C29, C33, C1, rule S2) before the code, never read off the engine. Instants the run decides (a routine draw) are read as the given of a case, never as its answer.

const refusedAt = (doc: Json): string => {
  try {
    loadScenario(doc, lookup);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("the loader accepted the scenario");
};
interface Q { value: number }
/** The parts of an SC12 scenario file the cases below change. */
interface Raw {
  settings: Record<string, Q>;
  breakout: { origin: Json; confirm: string[]; inputs: Record<string, Q>; topology: { lots: { lot_id: string; prepared_at: Q }[] } };
}
const sc12 = (name: string, change: (d: Raw) => void): Json => {
  const d = structuredClone(rawScenario(name)) as unknown as Raw;
  change(d);
  return d as unknown as Json;
};
/** An entry a case changes; a missing one is a broken test, not a refusal. */
const entry = <T>(x: T | undefined, what: string): T => {
  if (x === undefined) throw new Error(`no ${what} in the scenario`);
  return x;
};

describe("F4: a multiplier moment at the inoculation instant applies (C29 as amended)", () => {
  // The probe's input: sc12_mycoplasma with a seed-lot origin (SL-1, contaminated from 0 h, used by U01 alone), so the onset of U01 is its inoculation; a plateau delay of 0 d and a growth factor
  // of 0, so the plateau falls at the inoculation itself.
  let run: ScenarioRun;
  beforeAll(() => {
    const doc = sc12("sc12_mycoplasma", (d) => {
      d.breakout.origin = { kind: "seed_lot", lot_id: "SL-1", contaminated_at: { value: 0, unit: "h", ref: "A157" } };
      entry(d.breakout.inputs.mycoplasma_plateau_delay_d, "N2").value = 0;
      entry(d.breakout.inputs.mycoplasma_growth_multiplier_after_plateau, "N3").value = 0;
    });
    run = runScenario({ ...loadScenario(doc, lookup), seed: 9013 });
  });

  it("Given an onset at the inoculation and N2 of 0 d When the unit runs Then the growth factor 0 is in effect from the inoculation instant itself", () => {
    const r = run.process.byUnit.get("U01");
    expect(r?.factors).toEqual([{ t: r?.inoculated_s, mu: 0, kd: 1 }]);
  });

  it("Then the viable density never rises above its value at the inoculation (no growth from the first step; death goes on)", () => {
    const r = run.process.byUnit.get("U01");
    const x = Array.from(r?.x.subarray(0, r.n) ?? []);
    expect(Math.max(...x)).toBe(x[0]);
  });
});

describe("F5: the loader refuses what the rules and the logical bounds of the ledger forbid, by input and id", () => {
  it("Given the probe's medium lot ML-3 prepared at 100 h and consumed by U01 at 52 h When loaded Then it is refused, naming the lot's prepared_at, the first consumption and A177 (C7)", () => {
    const doc = sc12("sc12_medium_lot", (d) => {
      entry(d.breakout.topology.lots.find((l) => l.lot_id === "ML-3"), "ML-3").prepared_at.value = 100;
    });
    expect(refusedAt(doc)).toMatch(/breakout topology\.lots ML-3 prepared_at 100 h is after its first consumption, by U01 at 52 h; a lot is prepared before it is consumed \(A177\)/);
  });

  it("Given a seed lot prepared after the inoculation of its unit (SL-1 at 1 h, U01 inoculated at 0 h) When loaded Then it is refused the same way", () => {
    const block = fx12a() as { topology: { lots: { lot_id: string; prepared_at: Json }[] } };
    (block.topology.lots.find((l) => l.lot_id === "SL-1") as { prepared_at: Json }).prepared_at = h(1);
    expect(refusedAt(docOf(block as Json))).toMatch(/topology\.lots SL-1 prepared_at 1 h is after its first consumption, by U01 at 0 h.*\(A177\)/);
  });

  it("Given a lot prepared exactly at its first consumption When loaded Then it is accepted", () => {
    const block = fx12a() as { topology: { lots: { lot_id: string; prepared_at: Json }[] } };
    (block.topology.lots.find((l) => l.lot_id === "ML-2") as { prepared_at: Json }).prepared_at = h(5);
    expect(configOf(docOf(block as Json)).breakout).toBeDefined();
  });

  it.each([
    // below 0 both are refused already as negative (mycoplasma_loader.test.ts); these are the bounds the ledger adds
    ["mycoplasma_growth_multiplier_after_plateau", 5, /inputs\.mycoplasma_growth_multiplier_after_plateau 5 is above 1: .*0 to 1 \(A221\)/],
    ["mycoplasma_growth_multiplier_after_plateau", 1.01, /inputs\.mycoplasma_growth_multiplier_after_plateau 1\.01 is above 1: .*\(A221\)/],
    ["mycoplasma_death_multiplier_after_fall", 0.1, /inputs\.mycoplasma_death_multiplier_after_fall 0\.1 is below 1: .*\(A223\)/],
  ])("Given the input %s at %s When loaded Then it is refused at its logical bound, naming the input and its id", (name, value, message) => {
    const inputs = mycoplasmaInputs() as Record<string, { value: number }>;
    (inputs[name] as { value: number }).value = value;
    expect(refusedAt(docOfM({ ...fx12m(), inputs } as Json))).toMatch(message);
  });

  it("Given the bounds themselves (growth 0 and 1, death 1) When loaded Then each is accepted", () => {
    for (const o of [{ growth: 0 }, { growth: 1 }, { death: 1 }]) expect(configOf(docOfM(fx12m(o))).breakout, JSON.stringify(o)).toBeDefined();
  });

  it("Given delays outside the plausible ranges of the source (A220 at 5 d, A222 at 1 d) When loaded Then they are accepted and kept as given: a plausible range is no bound", () => {
    const b = configOf(docOfM(fx12m({ plateau: 5, fall: 1 }))).breakout;
    expect([b?.inputs.mycoplasma_plateau_delay_d, b?.inputs.mycoplasma_viability_fall_delay_d]).toEqual([q(5, "d", "A220"), q(1, "d", "A222")]);
  });

  it("Given the probe's sampling origin (U01-D02-1) and a horizon of 17 d When loaded Then it is refused at load: with the draw at the end of its day, 72 h, the sterility result of U01 comes at 422 h and needs 18 d (C6)", () => {
    // typed: onset 72 h; signal at the first tick at or after 72 + 12 = 84 h (U01 is inoculated at 8 h on the minute grid); decision 86 h; sterility 86 + 336 = 422 h = 17.6 d, so 18 d.
    const message = refusedAt(sc12("sc12_sampling", (d) => void (entry(d.settings.horizon_days, "horizon").value = 17)));
    expect(message).toMatch(/horizon_days 17 ends before the sterility result of U01 at 422 h; the latest confirming result needs a horizon of at least 18 d \(A189\)/);
    expect(message).toMatch(/U01-D02-1 at 72 h, the end of its day/);
  });

  it("Given the same sampling origin and a horizon of 18 d When loaded Then it is accepted", () => {
    expect(loadScenario(sc12("sc12_sampling", (d) => void (entry(d.settings.horizon_days, "horizon").value = 18)), lookup).breakout).toBeDefined();
  });

  it("Given the probe's sampling origin with a confirm list naming U07, a unit the run does not have When loaded Then it is refused at load, naming the unit", () => {
    expect(refusedAt(sc12("sc12_sampling", (d) => void (d.breakout.confirm = ["U01", "U07"])))).toMatch(/breakout confirm names the unit U07, which is not a unit of the run/);
  });
});

describe("F8: each later signal draws its own confirming sample (rule S2 as ruled; C5, C6, C8)", () => {
  let run: ScenarioRun;
  beforeAll(() => {
    run = runOfDoc(docOf(fx12e()));
  });

  it("Given FX12e When the signal of U02 at 21 h is answered at 23 h Then U02-SIG-CONF is drawn from U02 at 23 h, besides the first signal's U01-CONF and U02-CONF at 19 h, each with the two tests (42 mL)", () => {
    expect(eventsOf(run, "confirm_sample_drawn").map((e) => [e.sample_id, e.unit_id, e.batch_id, e.t, e.volume_ul])).toEqual([
      ["U01-CONF", "U01", "B-U01", H(19), 42_000],
      ["U02-CONF", "U02", "B-U02", H(19), 42_000],
      ["U02-SIG-CONF", "U02", "B-U02", H(23), 42_000],
    ]);
    expect(eventsOf(run, "confirm_sample_drawn")[2]?.tests.map((t) => [t.aliquot_id, t.test])).toEqual([["U02-SIG-CONF-A1", "bioburden"], ["U02-SIG-CONF-A2", "sterility"]]);
  });

  it("Then its results arrive at 143 h and 359 h, detected (U02 is affected)", () => {
    expect(eventsOf(run, "confirm_result").filter((e) => e.sample_id === "U02-SIG-CONF").map((e) => [e.test, e.t, e.outcome])).toEqual([
      ["bioburden", H(143), "detected"],
      ["sterility", H(359), "detected"],
    ]);
  });

  it("Given FX12a (one affected unit) When it runs Then no later signal exists and the draws are those of the first signal only", () => {
    expect(eventsOf(runOfDoc(docOf(fx12a())), "confirm_sample_drawn").map((e) => e.sample_id)).toEqual(["U01-CONF", "U02-CONF"]);
  });

  it("Given FX12e When every stream key is enumerated Then the later draw has a key of its own, (seed, U02-SIG-CONF, -, 0, confirm), and no key or stream seed repeats", () => {
    const keys: StreamKey[] = [];
    runOfDoc(docOf(fx12e()), { onKey: (k) => keys.push(k) });
    expect(keys.filter((k) => k[4] === "confirm")).toEqual([[1, "U01-CONF", "-", 0, "confirm"], [1, "U02-CONF", "-", 0, "confirm"], [1, "U02-SIG-CONF", "-", 0, "confirm"]]);
    expect(new Set(keys.map(canonicalKey)).size).toBe(keys.length);
    expect(new Set(keys.map(streamSeed)).size).toBe(keys.length);
  });

  it("Given FX12e and a horizon of 14 d When loaded Then the horizon check counts the later draw: the sterility result of U02 at 359 h needs 15 d", () => {
    expect(refusedAt(docOf(fx12e(), { horizon_days: 14 }))).toMatch(/horizon_days 14 ends before the sterility result of U02 at 359 h; the latest confirming result needs a horizon of at least 15 d \(A189\)/);
  });

  it("Given a vessel cap of 60 mL (3 % of 2 L) When U02 is drawn at 19 h and again at 23 h Then the cap counts the first confirming draw and the second is skipped (42 + 42 mL > 60 mL)", () => {
    const capped = runOfDoc(docOf(fx12e(), { volume_cap_pct: 3 }));
    expect(eventsOf(capped, "confirm_sample_drawn").map((e) => e.sample_id)).toEqual(["U01-CONF", "U02-CONF"]);
    expect(eventsOf(capped, "draw_skipped_volume_budget").filter((e) => e.sample_id.endsWith("-CONF"))).toEqual([
      { type: "draw_skipped_volume_budget", t: H(23), sample_id: "U02-SIG-CONF", unit_id: "U02", batch_id: "B-U02", volume_ul: 42_000, cumulative_ul: 42_000 },
    ]);
  });
});

describe("F9: one pH truth: a sample drawn during the ramp carries the fallen pH of the sensor truth (C1 as amended)", () => {
  // typed: U01 takes the contaminated ML-2 at 5 h; lag and ramp both 36 h (A139 top, ramp at most the lag), so the pH falls by 0.3 (A141) from 5 h to 41 h and holds to the stop at 43 h. The
  // routine draws of day 1 (from 32 h, the staffed start) fall inside that span. Expected pH of a sample drawn at t: 7.0 - 0.3 x min(1, (t - 5 h) / 36 h); 7.0 for U02 and U03 and before 5 h.
  let run: ScenarioRun;
  beforeAll(() => {
    run = runOfDoc(docOf(set(set(fx12a(), "lag", h(36, "A139")), "ramp", h(36, "A141"))));
  });
  const expected = (t: number): number => 7 - 0.3 * Math.min(1, Math.max(0, t - H(5)) / H(36));

  it("Given the routine samples of U01 drawn before its stop When their true state is read Then each carries the pH of the ramp at its draw", () => {
    const u01 = run.samples.filter((s) => s.unit_id === "U01" && s.true_state !== undefined);
    expect(u01.length).toBeGreaterThan(0); // the given: at least one routine draw of day 1 falls before the stop at 43 h
    for (const s of u01) expect(s.true_state?.ph, s.sample_id).toBeCloseTo(expected(s.drawn_s), 12);
    expect(u01.some((s) => (s.true_state?.ph as number) < 7)).toBe(true);
  });

  it("Then the truth log carries the same pH in each sample_drawn event, and a sample drawn on a sensor tick has exactly the sensor's true pH of that tick", () => {
    const sensor = run.sensors.find((x) => x.unit_id === "U01" && x.signal === "pH");
    for (const e of eventsOf(run, "sample_drawn").filter((x) => x.unit_id === "U01")) {
      expect(e.true_state?.ph, e.sample_id).toBeCloseTo(expected(e.t), 12);
      const j = (e.t - (sensor?.t0_s ?? 0)) / (sensor?.cadence_s ?? 60);
      if (Number.isInteger(j)) expect(e.true_state?.ph).toBe(sensor?.truth[j]);
    }
  });

  it("Then the units that are not affected keep the set point, 7.0, in every sample", () => {
    for (const s of run.samples.filter((x) => x.unit_id !== "U01" && x.true_state !== undefined)) expect(s.true_state?.ph, s.sample_id).toBe(7);
  });

  it("Given the mycoplasma profile, which lists no pH signal (C31) When its samples are read Then their pH stays at the set point", () => {
    const m = runOfDoc(docOfM(fx12m()));
    expect(m.samples.filter((s) => s.true_state !== undefined).every((s) => s.true_state?.ph === 7)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { loadScenario } from "../../src/scenario.ts";
import { lookup } from "../support/scenarios.ts";
import { configOf, docOf, fx12a, fx12e, h, set } from "./support.ts";

// Spec 11.8.5 row 2: the loader refuses a script it cannot run, and each message names the input at fault (and, where the input has one, its ledger id). The first block checks that the
// two layouts load; every case after it changes exactly one thing. The messages are written here before the loader exists: they are the contract.

const refused = (block: ReturnType<typeof fx12a>, settings: Record<string, number> = {}): string => {
  try {
    configOf(docOf(block, settings));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("the loader accepted the scenario");
};

describe("Loader: the two fixture layouts are accepted, a scenario without a break-out block is untouched", () => {
  it("Given FX12a and FX12e as data When they are loaded Then the loader accepts them and keeps the block", () => {
    expect(configOf(docOf(fx12a())).breakout).toBeDefined();
    expect(configOf(docOf(fx12e())).breakout).toBeDefined();
  });

  it("Given no breakout block When the scenario is loaded Then the configuration has no breakout key at all (absent, not undefined)", () => {
    expect("breakout" in configOf(docOf())).toBe(false);
  });

  it("Given a lookup that answers the breakout kind with a profile of another kind When the scenario is loaded Then the one profile loader refuses it and the message says so", () => {
    const wrong = (kind: Parameters<typeof lookup>[0], id: string): unknown => (kind === "breakout" ? lookup("bioreactor", "bench_manual") : lookup(kind, id));
    expect(() => loadScenario(docOf(fx12a()), wrong)).toThrow(/breakout profile bacterial could not be loaded.*bench_manual is a bioreactor profile, a breakout profile is needed/);
  });

  it("Given the profile file with a test that names a volume nobody supplies When the scenario is loaded Then the profile reader refuses it by name", () => {
    const broken = (kind: Parameters<typeof lookup>[0], id: string): unknown => {
      const doc = structuredClone(lookup(kind, id)) as { tests?: { volume: string }[] };
      if (kind === "breakout" && doc.tests?.[1]) doc.tests[1].volume = "no_such_volume";
      return doc;
    };
    expect(() => loadScenario(docOf(fx12a()), broken)).toThrow(/breakout profile bacterial.*sterility names no_such_volume, which is neither a param nor a scenario input/);
  });

  it("Given an unknown profile id When the scenario is loaded Then it is refused naming the profile", () => {
    expect(refused(set(fx12a(), "profile", "viral"))).toMatch(/breakout profile.*viral/);
  });
});

describe("Loader: inputs without a default are required, each refused by name", () => {
  it("Given no signal_to_response When loaded Then the message names response.signal_to_response and A176", () => {
    expect(refused(set(fx12a(), "response.signal_to_response", undefined))).toMatch(/response\.signal_to_response.*A176/);
  });

  it("Given no positive_to_hold When loaded Then the message names response.positive_to_hold and A176", () => {
    expect(refused(set(fx12a(), "response.positive_to_hold", undefined))).toMatch(/response\.positive_to_hold.*A176/);
  });

  it("Given no response at all When loaded Then the message names response and A176", () => {
    expect(refused(set(fx12a(), "response", undefined))).toMatch(/response.*A176/);
  });

  it("Given no topology When loaded Then the message names topology and A177", () => {
    expect(refused(set(fx12a(), "topology", undefined))).toMatch(/topology.*A177/);
  });

  it("Given no bioburden volume When loaded Then the message names inputs.bioburden_sample_volume_ml and A225, whether the key or the whole inputs object is missing", () => {
    expect(refused(set(fx12a(), "inputs", undefined))).toMatch(/inputs\.bioburden_sample_volume_ml.*A225/);
    expect(refused(set(fx12a(), "inputs.bioburden_sample_volume_ml", undefined))).toMatch(/inputs\.bioburden_sample_volume_ml.*A225/);
  });

  it("Given an input the profile does not declare When loaded Then it is refused by name (a silent no-op would mislead)", () => {
    expect(refused(set(fx12a(), "inputs.nat_sample_volume_ml", { value: 1, unit: "mL", ref: "A226" }))).toMatch(/inputs\.nat_sample_volume_ml.*bacterial/);
  });

  it("Given a volume in the wrong unit When loaded Then the message names the input and the unit it expects", () => {
    expect(refused(set(fx12a(), "inputs.bioburden_sample_volume_ml", { value: 2000, unit: "uL", ref: "A225" }))).toMatch(/inputs\.bioburden_sample_volume_ml.*uL.*mL/);
  });

  it("Given a delay that is not in hours When loaded Then the message names the delay and the unit", () => {
    expect(refused(set(fx12a(), "response.signal_to_response", { value: 120, unit: "min", ref: "A176" }))).toMatch(/response\.signal_to_response.*min.*h/);
  });
});

describe("Loader: the ramp ends inside the lag (rule S1, ruling D4)", () => {
  it("Given a ramp of 14 h and the profile lag of 12 h When loaded Then it is refused naming the ramp, the lag and A139 and A141", () => {
    expect(refused(set(fx12a(), "ramp", h(14, "A141")))).toMatch(/ramp 14 h.*lag 12 h.*A139.*A141/);
  });

  it("Given a lag of 4 h (the low end of A139) and the profile ramp of 6 h When loaded Then it is refused: a short lag needs a short ramp", () => {
    expect(refused(set(fx12a(), "lag", h(4, "A139")))).toMatch(/ramp 6 h.*lag 4 h/);
  });

  it("Given a ramp equal to the lag When loaded Then it is accepted (the ramp may fill the lag)", () => {
    expect(() => configOf(docOf(set(fx12a(), "ramp", h(12, "A141"))))).not.toThrow();
  });

  it("Given a ramp of zero When loaded Then it is refused (the ramp is above 0)", () => {
    expect(refused(set(fx12a(), "ramp", h(0, "A141")))).toMatch(/ramp.*above 0/);
  });
});

describe("Loader: unknown lots, equipment and units are refused by name", () => {
  it("Given a consumption of a lot that is not declared When loaded Then the message names the lot and topology.lots", () => {
    expect(refused(set(fx12a(), "topology.consumption.3.lot_id", "ML-9"))).toMatch(/ML-9.*topology\.lots/);
  });

  it("Given a use of an item that is not declared When loaded Then the message names the item and topology.equipment", () => {
    expect(refused(set(fx12e(), "topology.use.1.equipment_id", "TL-9"))).toMatch(/TL-9.*topology\.equipment/);
  });

  it("Given an origin lot that is not declared When loaded Then the message names the lot and topology.lots", () => {
    expect(refused(set(fx12a(), "origin.lot_id", "ML-9"))).toMatch(/origin.*ML-9.*topology\.lots/);
  });

  it("Given an origin item that is not declared When loaded Then the message names the item and topology.equipment", () => {
    expect(refused(set(fx12e(), "origin.equipment_id", "TL-9"))).toMatch(/origin.*TL-9.*topology\.equipment/);
  });

  it("Given a seed-lot origin that names a medium lot When loaded Then it is refused naming the lot and its kind", () => {
    expect(refused(set(set(fx12a(), "origin.kind", "seed_lot"), "origin.lot_id", "ML-2"))).toMatch(/ML-2.*medium.*seed_lot/);
  });

  it("Given a unit that is not in the run When loaded Then the message names the unit (consumption, use, confirm list, origin)", () => {
    expect(refused(set(fx12a(), "topology.consumption.3.unit_id", "U09"))).toMatch(/U09/);
    expect(refused(set(fx12e(), "topology.use.0.unit_id", "U9"))).toMatch(/U9/);
    expect(refused(set(fx12a(), "confirm", ["U01", "U09"]))).toMatch(/confirm.*U09/);
    expect(refused({ ...set(fx12a(), "origin", { kind: "unit_equipment", unit_id: "U07", at: h(5, "A157") }) })).toMatch(/origin.*U07/);
  });

  it("Given an origin that reaches no unit When loaded Then it is refused (there would be no event)", () => {
    expect(refused(set(set(fx12a(), "origin.lot_id", "ML-3"), "origin.contaminated_at", h(10, "A157")))).toMatch(/origin.*ML-3.*reaches no unit/);
  });
});

describe("Loader: lots are consumed as the topology says", () => {
  it("Given a seed lot consumed with an instant When loaded Then it is refused: a seed lot is consumed at the inoculation of its unit", () => {
    expect(refused(set(fx12a(), "topology.consumption.0.at", h(0)))).toMatch(/SL-1.*seed.*inoculation.*at/);
  });

  it("Given a medium lot consumed without an instant When loaded Then it is refused naming the lot", () => {
    expect(refused(set(fx12a(), "topology.consumption.3.at", undefined))).toMatch(/ML-1.*medium.*needs.*at/);
  });

  it("Given two seed lots for one unit When loaded Then it is refused (a batch has at most one seed lot, K17)", () => {
    expect(refused(set(fx12a(), "topology.consumption.1.unit_id", "U01"))).toMatch(/U01.*SL-1.*SL-2.*one seed lot/);
  });

  it("Given a consumption before the inoculation of the unit When loaded Then it is refused (a batch record starts at the inoculation)", () => {
    expect(refused(set(fx12a(), "topology.consumption.3.at", h(-1)))).toMatch(/U01.*ML-1.*before.*inoculat/);
  });
});

describe("Loader: no consumption or use of the contaminated item at or after the first decision (rule S4, ruling D5)", () => {
  it("Given U02 using the contaminated TL-1 at 25 h and a first decision at 19 h When loaded Then it is refused naming U02, TL-1, 25 h and 19 h", () => {
    expect(refused(set(fx12e(), "topology.use.1.at", h(25)))).toMatch(/U02.*TL-1.*25 h.*first decision.*19 h/);
  });

  it("Given U03 consuming the contaminated ML-2 at 20 h When loaded Then it is refused naming U03, ML-2, 20 h and 19 h", () => {
    const block = set(fx12a(), "topology.consumption", [...(fx12a().topology as { consumption: object[] }).consumption, { unit_id: "U03", lot_id: "ML-2", at: h(20) }]);
    expect(refused(block)).toMatch(/U03.*ML-2.*20 h.*first decision.*19 h/);
  });

  it("Given a use exactly at the first decision, 19 h, When loaded Then it is refused too (every affected unit is affected before the confirming draws)", () => {
    expect(refused(set(fx12e(), "topology.use.1.at", h(19)))).toMatch(/U02.*TL-1.*19 h.*first decision/);
  });

  it("Given a use one hour before the first decision, 18 h, When loaded Then it is accepted", () => {
    expect(() => configOf(docOf(set(fx12e(), "topology.use.1.at", h(18))))).not.toThrow();
  });

  it("Given a seed lot contaminated and a unit inoculated from it after the first decision When loaded Then it is refused naming the inoculation", () => {
    const block = {
      profile: "bacterial", origin: { kind: "seed_lot", lot_id: "SL-1", contaminated_at: h(0, "A157") },
      topology: { lots: [{ lot_id: "SL-1", kind: "seed", prepared_at: h(0) }], consumption: [{ unit_id: "U01", lot_id: "SL-1" }, { unit_id: "U03", lot_id: "SL-1" }] },
      response: { signal_to_response: h(2, "A176"), positive_to_hold: h(4, "A176") }, confirm: ["U01"], inputs: { bioburden_sample_volume_ml: { value: 2, unit: "mL", ref: "A225" } },
    };
    // U03 is inoculated 36 h after U01 (cohorts of two, 1 d apart is 24 h; with cohort_interval_d 1.5): its inoculation is after the first decision at 14 h
    expect(refused(block, { cohort_size: 2, cohort_interval_d: 1.5 })).toMatch(/U03.*inoculated from the contaminated seed lot SL-1.*first decision/);
  });
});

describe("Loader: the horizon holds the last result (rule S3)", () => {
  it("Given FX12a with horizon_days 14 When loaded Then it is refused, naming the sterility result and the 15 d the horizon needs", () => {
    expect(refused(fx12a(), { horizon_days: 14 })).toMatch(/horizon_days 14.*sterility.*U0[12].*355 h.*15 d/);
  });

  it("Given horizon_days 15 (360 h, after the last result at 355 h) When loaded Then it is accepted", () => {
    expect(() => configOf(docOf(fx12a(), { horizon_days: 15 }))).not.toThrow();
  });

  it("Given only U02 in the confirm list When horizon_days is 14 Then the same refusal names U02 (the latest result is taken over the confirmed units)", () => {
    expect(refused(set(fx12a(), "confirm", ["U02"]), { horizon_days: 14 })).toMatch(/horizon_days 14.*sterility.*U02.*15 d/);
  });
});

describe("Loader: stops and confirming draws happen while the units run", () => {
  it("Given a confirm list that names a unit inoculated after the first decision When loaded Then it is refused: not running at the first decision", () => {
    // cohorts of two, one cohort a day: U03 is inoculated at 24 h, the first decision is at 19 h; U03 takes no medium in this layout (a medium at 1 h would be before its inoculation)
    const topology = fx12a().topology as { consumption: { unit_id: string }[] };
    const block = set(set(fx12a(), "topology.consumption", topology.consumption.filter((c) => c.unit_id !== "U03")), "confirm", ["U01", "U03"]);
    expect(refused(block, { cohort_size: 2 })).toMatch(/confirm.*U03.*not running at the first decision.*19 h.*24 h/);
  });

  it("Given a unit that is scheduled to end before its own stop When loaded Then it is refused naming the unit, the stop and the end", () => {
    // production_days 0.5: U01 ends at 12 h; its stop would be at 19 h
    expect(refused(fx12a(), { production_days: 0.5 })).toMatch(/stops U01 at 19 h.*U01 runs only until 12 h/);
  });
});

import { describe, expect, it } from "vitest";
import type { Json } from "../support/schemas.ts";
import { configOf, h, q, set } from "./support.ts";
import { docOfM, fx12m, loadedWith } from "./support_m.ts";

// Spec 11.8.4 FX12m, loader row: "horizon_days 30 is refused, naming the culture and the 31 d needed; 31 is accepted. A scenario without N1 to N8 (any one) is refused naming it." Spec 11.8.3 and
// ledger A219 to A226: every mycoplasma magnitude with no source is a required scenario input with no default; the loader refuses one that is missing by name and id. The inputs the mycoplasma
// profile needs are A219 (the DO rise ramp), A220 and A221 (the plateau), A222 and A223 (the viability fall), A224 (the nucleic-acid target) and A226 (the nucleic-acid volume). The bioburden volume
// (A225) belongs to the bacterial profile and the release delay (A227) is read by no step of the truth run, so neither is an input of this profile. Messages are the contract, written before the code.

const refused = (block: Json, settings: Record<string, number> = {}): string => {
  try {
    configOf(docOfM(block, settings));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("the loader accepted the scenario");
};

describe("Horizon (rule S3): the scenario must hold the latest confirming result", () => {
  it("Given a horizon of 30 d When the scenario is loaded Then it is refused, naming the culture, its instant 727 h and the 31 d needed", () => {
    expect(refused(fx12m(), { horizon_days: 30 })).toMatch(/horizon_days 30 ends before the mycoplasma_culture result of U01 at 727 h; the latest confirming result needs a horizon of at least 31 d \(A189\)/);
  });

  it("Given a horizon of 31 d When the scenario is loaded Then it is accepted", () => {
    expect(configOf(docOfM(fx12m(), { horizon_days: 31 })).breakout).toBeDefined();
  });

  it("Given the 21 d default horizon of the scenario When the scenario is loaded Then it is refused too (a 28 d culture needs a longer scenario)", () => {
    expect(refused(fx12m(), { horizon_days: 21 })).toMatch(/horizon_days 21 ends before the mycoplasma_culture result.*at least 31 d/);
  });
});

describe("Inputs without a default (A219 to A224, A226): each is refused by name and id when it is missing", () => {
  it.each([
    ["mycoplasma_do_rise_ramp_h", "A219"],
    ["mycoplasma_plateau_delay_d", "A220"],
    ["mycoplasma_growth_multiplier_after_plateau", "A221"],
    ["mycoplasma_viability_fall_delay_d", "A222"],
    ["mycoplasma_death_multiplier_after_fall", "A223"],
    ["nat_target_covers_organism", "A224"],
    ["nat_sample_volume_ml", "A226"],
  ])("Given no %s When the scenario is loaded Then the message names inputs.%s and %s and says it has no default", (name, id) => {
    const message = refused(set(fx12m(), `inputs.${name}`, undefined));
    expect(message).toContain(`inputs.${name}`);
    expect(message).toContain(id);
    expect(message).toMatch(/profile mycoplasma/);
    expect(message).toMatch(/no default/);
  });

  it("Given no inputs at all When the scenario is loaded Then the first input the profile declares is named, with A219", () => {
    expect(refused(set(fx12m(), "inputs", undefined))).toMatch(/inputs\.mycoplasma_do_rise_ramp_h.*A219/);
  });

  it("Given the bioburden volume of the bacterial profile When it is given to the mycoplasma profile Then it is refused: it is not an input of this profile", () => {
    expect(refused(set(fx12m(), "inputs.bioburden_sample_volume_ml", q(2, "mL", "A225")))).toMatch(/inputs\.bioburden_sample_volume_ml.*mycoplasma/);
  });

  it("Given every input When the scenario is loaded Then the inputs are kept as given, to be printed with every result", () => {
    const inputs = configOf(docOfM(fx12m())).breakout?.inputs;
    expect(Object.keys(inputs ?? {})).toEqual([
      "mycoplasma_do_rise_ramp_h", "mycoplasma_plateau_delay_d", "mycoplasma_growth_multiplier_after_plateau", "mycoplasma_viability_fall_delay_d", "mycoplasma_death_multiplier_after_fall", "nat_target_covers_organism", "nat_sample_volume_ml",
    ]);
  });
});

describe("Values the engine cannot run, each refused by name", () => {
  it("Given a ramp longer than the lag (49 h against 48 h) When loaded Then it is refused: the ramp ends at the first signal, inside the lag (rule S1, ruling D4)", () => {
    expect(refused(set(fx12m(), "inputs.mycoplasma_do_rise_ramp_h", h(49, "A219")))).toMatch(/ramp 49 h is longer than the lag 48 h: the ramp ends at the first signal, inside the lag \(A138, A219\)/);
  });

  it("Given a ramp equal to the lag When loaded Then it is accepted (the rise may fill the lag)", () => {
    expect(configOf(docOfM(set(fx12m(), "inputs.mycoplasma_do_rise_ramp_h", h(48, "A219")))).breakout?.ramp_s).toBe(48 * 3600);
  });

  it("Given a lag shorter than the ramp of the input (a lag of 6 h against a ramp of 12 h) When loaded Then it is refused the same way", () => {
    expect(refused(set(fx12m(), "lag", h(6, "A138")))).toMatch(/ramp 12 h is longer than the lag 6 h/);
  });

  it("Given a ramp of zero When loaded Then it is refused (A219: above 0)", () => {
    expect(refused(set(fx12m(), "inputs.mycoplasma_do_rise_ramp_h", h(0, "A219")))).toMatch(/ramp 0 h must be above 0 \(A219\)/);
  });

  it("Given the `ramp` field of the block When it is given to a profile that takes its ramp from an input Then it is refused, naming the input and A219 (two ways to say one thing would mislead)", () => {
    expect(refused(set(fx12m(), "ramp", h(12, "A219")))).toMatch(/ramp.*mycoplasma.*inputs\.mycoplasma_do_rise_ramp_h.*A219/);
  });

  it("Given a nucleic-acid flag that is neither 0 nor 1 When loaded Then it is refused naming the input and A224", () => {
    expect(refused(set(fx12m(), "inputs.nat_target_covers_organism", q(2, "flag", "A224")))).toMatch(/inputs\.nat_target_covers_organism.*0 or 1.*A224/);
  });

  it("Given a negative multiplier or a negative delay When loaded Then each is refused naming its input", () => {
    expect(refused(set(fx12m(), "inputs.mycoplasma_growth_multiplier_after_plateau", q(-0.1, "factor", "A221")))).toMatch(/inputs\.mycoplasma_growth_multiplier_after_plateau.*must not be negative/);
    expect(refused(set(fx12m(), "inputs.mycoplasma_death_multiplier_after_fall", q(-1, "factor", "A223")))).toMatch(/inputs\.mycoplasma_death_multiplier_after_fall.*must not be negative/);
    expect(refused(set(fx12m(), "inputs.mycoplasma_plateau_delay_d", q(-1, "d", "A220")))).toMatch(/inputs\.mycoplasma_plateau_delay_d.*must not be negative/);
  });

  it("Given a delay in hours, a multiplier in days or a volume in microlitres When loaded Then each is refused naming the input, the unit given and the unit the profile declares", () => {
    expect(refused(set(fx12m(), "inputs.mycoplasma_plateau_delay_d", h(48, "A220")))).toMatch(/inputs\.mycoplasma_plateau_delay_d.*unit h.*expects d/);
    expect(refused(set(fx12m(), "inputs.mycoplasma_growth_multiplier_after_plateau", q(0.5, "d", "A221")))).toMatch(/inputs\.mycoplasma_growth_multiplier_after_plateau.*unit d.*expects factor/);
    expect(refused(set(fx12m(), "inputs.nat_sample_volume_ml", q(1000, "uL", "A226")))).toMatch(/inputs\.nat_sample_volume_ml.*uL.*mL/);
  });

  it("Given a nucleic-acid volume of zero When loaded Then it is refused (A226: above 0)", () => {
    expect(refused(set(fx12m(), "inputs.nat_sample_volume_ml", q(0, "mL", "A226")))).toMatch(/inputs\.nat_sample_volume_ml must be above 0.*A226/);
  });
});

describe("The profile reader refuses a profile the engine cannot read, naming the profile and the name at fault", () => {
  type Doc = {
    params: Record<string, unknown>;
    ramp_input?: string;
    scenario_inputs: Record<string, { unit: string; ref: string }>;
    host_effects: { delay: string; growth?: string; death?: string }[];
    tests: { covered_by?: string }[];
  };
  const refusedProfile = (edit: (p: Doc) => void): string => {
    try {
      loadedWith(docOfM(fx12m()), (p) => edit(p as unknown as Doc));
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("the loader accepted the profile");
  };

  it("Given a host effect that names an input the profile does not declare When loaded Then it is refused naming the profile, the effect and the name", () => {
    expect(refusedProfile((p) => void (p.host_effects[0] = { delay: "no_such_input" }))).toMatch(/breakout profile mycoplasma could not be loaded.*a host effect names no_such_input, which is not a scenario input/);
  });

  it("Given a delay declared in hours or a multiplier declared in days When loaded Then each is refused naming the unit declared and the unit the engine expects", () => {
    expect(refusedProfile((p) => void (p.scenario_inputs.mycoplasma_plateau_delay_d = { unit: "h", ref: "A220" }))).toMatch(/a host effect names mycoplasma_plateau_delay_d, declared in h, the engine expects d/);
    expect(refusedProfile((p) => void (p.scenario_inputs.mycoplasma_growth_multiplier_after_plateau = { unit: "d", ref: "A221" }))).toMatch(/names mycoplasma_growth_multiplier_after_plateau, declared in d, the engine expects factor/);
  });

  it("Given a coverage input declared as a factor When loaded Then it is refused: the engine expects a flag", () => {
    expect(refusedProfile((p) => void (p.scenario_inputs.nat_target_covers_organism = { unit: "factor", ref: "A224" }))).toMatch(/test nucleic_acid_test names nat_target_covers_organism, declared in factor, the engine expects flag/);
  });

  it("Given a ramp with a default and a ramp input When loaded Then it is refused: a ramp has one source", () => {
    expect(refusedProfile((p) => void (p.params.signal_ramp_h = { value: 6, unit: "h", ref: "A141" }))).toMatch(/a default ramp \(signal_ramp_h\) and a ramp_input; a ramp has one source/);
  });

  it("Given a ramp input that is not declared, or declared in days When loaded Then each is refused", () => {
    expect(refusedProfile((p) => void (p.ramp_input = "no_such_input"))).toMatch(/ramp_input names no_such_input, which is not a scenario input/);
    expect(refusedProfile((p) => void (p.scenario_inputs.mycoplasma_do_rise_ramp_h = { unit: "d", ref: "A219" }))).toMatch(/ramp_input names mycoplasma_do_rise_ramp_h, declared in d, the engine expects h/);
  });

  it("Given a profile with neither a default ramp nor a ramp input When loaded Then it is refused naming the missing parameter", () => {
    expect(refusedProfile((p) => void delete p.ramp_input)).toMatch(/parameter signal_ramp_h is missing/);
  });
});

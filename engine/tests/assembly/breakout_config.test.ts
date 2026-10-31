import { describe, expect, it } from "vitest";
import { parseBreakoutConfig, patchScenario } from "../../src/experiments/assembly/breakout_config.ts";
import { loadScenario } from "../../src/scenario.ts";
import { readJson } from "../support/paths.ts";
import { lookup, rawScenario } from "../support/scenarios.ts";

// The config of the break-out experiment SC12 and the scenario patch of a swept case. The refusals are the rules of every seed list (neutral integers, no repeat, none date-shaped, at least the A103
// minimum of 20) and the shape of a case. Expected messages are typed by hand from the rules in the brief of the experiment-config (prompts/20 Step 4).

const SEEDS = Array.from({ length: 20 }, (_, i) => 100 + 7 * i);
const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: "1", experiment_id: "x", presets: ["a_manual"], ablations_of: "c_context", seeds: SEEDS, cases: [{ case_id: "c1", scenario: "sc12_medium_lot" }], ...over,
});
const P = (value: number, unit: string, ref: string) => ({ value, unit, ref });

describe("The break-out experiment config", () => {
  it("Given the file scenarios/experiments/sc12.json Then it parses with the A103 minimum", () => {
    const c = parseBreakoutConfig(readJson("scenarios", "experiments", "sc12.json"), 20);
    expect(c.experiment_id).toBe("sc12");
    expect(c.cases.length).toBeGreaterThan(6);
    expect(c.cases.every((x) => x.set !== undefined)).toBe(true);
  });

  it.each([
    ["19 seeds", { seeds: SEEDS.slice(0, 19) }, /at least 20 seeds/],
    ["a date-shaped seed", { seeds: [...SEEDS.slice(0, 19), 20301231] }, /date-shaped/],
    ["a repeated seed", { seeds: [...SEEDS.slice(0, 19), SEEDS[0]] }, /repeated/],
    ["a negative seed", { seeds: [...SEEDS.slice(0, 19), -1] }, /non-negative integer/],
    ["an unknown key", { sneaky: 1 }, /unknown key sneaky/],
    ["no cases", { cases: [] }, /cases must be a non-empty list/],
    ["a case listed twice", { cases: [{ case_id: "c1", scenario: "s" }, { case_id: "c1", scenario: "s" }] }, /case c1 is listed twice/],
    ["a case with an unknown key", { cases: [{ case_id: "c1", scenario: "s", seed: 5 }] }, /unknown key seed in a case/],
    ["a set path outside the block", { cases: [{ case_id: "c1", scenario: "s", set: { "settings.reactor_count": P(3, "reactors", "A001") } }] }, /not inputs.<name> or response.<name>/],
    ["a set value that is a bare number", { cases: [{ case_id: "c1", scenario: "s", set: { "inputs.x": 3 } }] }, /not \{value, unit, ref\}/],
    ["an assumed lag that is a bare number", { cases: [{ case_id: "c1", scenario: "s", assumed_lag: 12 }] }, /not \{value, unit, ref\}/],
  ])("Given %s When the config is parsed Then it is refused with the reason", (_what, over, message) => {
    expect(() => parseBreakoutConfig(doc(over), 20)).toThrow(message);
  });
});

describe("The scenario of a swept case", () => {
  it("Given a set on an input and on a response delay When the scenario is patched Then the copy has them, the original is unchanged, and the loader accepts the copy", () => {
    const raw = rawScenario("sc12_mycoplasma");
    const patched = patchScenario(raw, { "inputs.nat_target_covers_organism": P(0, "flag", "A224"), "response.signal_to_response": P(6, "h", "A176") }, "c1") as { breakout: { inputs: Record<string, unknown>; response: Record<string, unknown> } };
    expect(patched.breakout.inputs.nat_target_covers_organism).toEqual(P(0, "flag", "A224"));
    expect(patched.breakout.response.signal_to_response).toEqual(P(6, "h", "A176"));
    expect((raw as { breakout: { inputs: Record<string, unknown> } }).breakout.inputs.nat_target_covers_organism).toEqual(P(1, "flag", "A224"));
    const loaded = loadScenario(patched, lookup).breakout;
    expect(loaded?.signal_to_response_s).toBe(6 * 3600);
    expect(loaded?.tests.find((t) => t.test === "nucleic_acid_test")?.covers).toBe(false);
  });

  it("Given a set on an input the scenario does not have When it is patched Then it is refused, naming the case, and nothing is added", () => {
    expect(() => patchScenario(rawScenario("sc12_medium_lot"), { "inputs.nat_target_covers_organism": P(0, "flag", "A224") }, "c9")).toThrow(/c9: the scenario has no breakout.inputs.nat_target_covers_organism to set/);
    expect(() => patchScenario(rawScenario("default"), { "response.signal_to_response": P(6, "h", "A176") }, "c9")).toThrow(/c9: the scenario has no breakout/);
  });

  it("Given a set value that is wrong for the loader (a flag of 2) When the scenario is loaded Then the loader refuses it by name and id", () => {
    const patched = patchScenario(rawScenario("sc12_mycoplasma"), { "inputs.nat_target_covers_organism": P(2, "flag", "A224") }, "c1");
    expect(() => loadScenario(patched, lookup)).toThrow(/nat_target_covers_organism must be 0 or 1 \(A224\)/);
  });
});

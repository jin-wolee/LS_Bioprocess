import { describe, expect, it } from "vitest";
import { loadScenario } from "../../src/scenario.ts";
import { lookup, patched, rawScenario } from "../support/scenarios.ts";
import { isValid, makeAjv } from "../support/schemas.ts";

const scenario = (value: number) => patched(rawScenario("default"), { settings: { rerun_probability: value } });

describe("S-02: scenario rerun bounds", () => {
  it.each([-0.01, 1, 1.01])("the loader rejects %s", (value) => {
    expect(() => loadScenario(scenario(value), lookup)).toThrow(/rerun_probability/);
  });
  it.each([0, 1 - Number.EPSILON])("the loader accepts %s", (value) => {
    expect(loadScenario(scenario(value), lookup).analysis.rerunP).toBe(value);
  });
  it.each([-0.01, 1, 1.01])("the schema rejects %s", (value) => {
    expect(isValid(makeAjv(), "scenario", scenario(value))).toBe(false);
  });
  it.each([0, 1 - Number.EPSILON])("the schema accepts %s", (value) => {
    expect(isValid(makeAjv(), "scenario", scenario(value))).toBe(true);
  });
});


describe("scenario settings retain the parameter contract", () => {
  const ajv = makeAjv();
  const base = { value: 0.25, unit: "fraction", ref: "A001" };
  const invalid = [
    { value: 0.25, unit: "fraction" },
    { value: 0.25, ref: "A001" },
    { unit: "fraction", ref: "A001" },
    { ...base, value: "0.25" },
    { ...base, unit: "" },
    { ...base, ref: "invalid" },
    { ...base, extra: true },
    0.25,
  ];
  for (const name of ["rerun_probability", "second_sample_fraction"]) {
    it.each(invalid)(`${name} rejects malformed parameter %j`, (parameter) => {
      const doc = scenario(0.25);
      (doc.settings as Record<string, unknown>)[name] = parameter;
      expect(isValid(ajv, "scenario", doc)).toBe(false);
    });
    it(`${name} accepts the complete parameter`, () => {
      const doc = scenario(0.25);
      (doc.settings as Record<string, unknown>)[name] = base;
      expect(isValid(ajv, "scenario", doc)).toBe(true);
    });
  }
});

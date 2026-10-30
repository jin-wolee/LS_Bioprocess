import { describe, expect, it } from "vitest";
import { checkRunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { labData } from "../support/lab_data.ts";

// Section 4 of docs/design/lab_ui.md: the Worker does not trust a RunSpec, because a link is user input. It checks the scenario id, the names of the settings
// against a whitelist, the architecture ids and the seeds (the rules of the experiment config) and answers invalid_spec.

const data = labData();
const home = { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1] };
/** The spec without one key. */
const without = (spec: Record<string, unknown>, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(spec).filter(([k]) => k !== key));
const refused = (spec: unknown): string => {
  const checked = checkRunSpec(spec, data);
  if (checked.ok) throw new Error(`expected a refusal, got ${JSON.stringify(checked.spec)}`);
  return checked.message;
};

describe("checkRunSpec: a valid spec", () => {
  it("Given the Home spec When it is checked Then it is accepted and returned with the fields as sent", () => {
    expect(checkRunSpec(home, data)).toEqual({ ok: true, spec: home });
  });

  it("Given a spec without settings When it is checked Then settings read as an empty object", () => {
    expect(checkRunSpec(without(home, "settings"), data)).toEqual({ ok: true, spec: home });
  });

  it("Given a setting of the scenario and a known architecture When it is checked Then both pass (the form is limited later, by the run)", () => {
    const spec = { ...home, settings: { reactor_count: 6 }, architectures: ["a_manual", "c_context_minus_audit_trail"], seeds: [1009, 1103] };
    expect(checkRunSpec(spec, data)).toEqual({ ok: true, spec });
  });
});

describe("checkRunSpec: invalid_spec", () => {
  it.each([null, 7, "default", [], undefined])("Given %j as the spec Then it is refused", (spec) => {
    expect(refused(spec)).toMatch(/spec must be an object/);
  });

  it("Given a key outside the spec (a way to ask for the truth log) Then it is refused by name", () => {
    expect(refused({ ...home, events: true })).toMatch(/unknown key "events"/);
    expect(refused({ ...home, answer_key: true })).toMatch(/unknown key "answer_key"/);
  });

  it("Given another schema_version Then it is refused", () => {
    expect(refused({ ...home, schema_version: "2" })).toMatch(/schema_version must be "1"/);
  });

  it.each(["sc02_shift_burst", "", 3, "../default"])("Given the scenario %j, which is not bundled, Then it is refused and the bundled ids are named", (scenario) => {
    expect(refused({ ...home, scenario })).toMatch(/unknown scenario.*bundled: default/);
  });

  it("Given a setting that is not in the scenario Then it is refused by name", () => {
    expect(refused({ ...home, settings: { not_a_setting: 1 } })).toMatch(/unknown setting "not_a_setting"/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "6", null, true])("Given the value %j for a setting Then it is refused", (value) => {
    expect(refused({ ...home, settings: { reactor_count: value } })).toMatch(/setting reactor_count must be a finite number/);
  });

  it("Given settings that are not an object Then it is refused", () => {
    expect(refused({ ...home, settings: [1] })).toMatch(/settings must be an object/);
  });

  it("Given an architecture id that does not exist Then it is refused by name", () => {
    expect(refused({ ...home, architectures: ["a_manual", "d_unknown"] })).toMatch(/unknown architecture "d_unknown"/);
    expect(refused({ ...home, architectures: ["c_context_minus_no_such_flag"] })).toMatch(/unknown architecture/);
  });

  it("Given architectures that are not a list, or that repeat an id Then it is refused", () => {
    expect(refused({ ...home, architectures: "a_manual" })).toMatch(/architectures must be a list/);
    expect(refused({ ...home, architectures: ["a_manual", "a_manual"] })).toMatch(/architecture "a_manual" is repeated/);
  });

  it.each([
    [[], /seeds must name at least one seed$/],
    [[1.5], /seed 1.5 must be a non-negative integer/],
    [[-1], /seed -1 must be a non-negative integer/],
    [[1, 1], /a seed is repeated/],
    [[20260101], /seed 20260101 is date-shaped/],
    ["1", /seeds must be a list/],
  ])("Given the seeds %j Then it is refused with the rule of the experiment config", (seeds, message) => {
    expect(refused({ ...home, seeds })).toMatch(message);
  });

  it("Given a missing field Then it is refused by name", () => {
    expect(refused(without(home, "seeds"))).toMatch(/seeds must be a list/);
    expect(refused(without(home, "architectures"))).toMatch(/architectures must be a list/);
  });
});

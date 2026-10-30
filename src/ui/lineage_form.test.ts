import { describe, expect, it } from "vitest";
import { READY } from "./fixture.ts";
import { architecturesOf, defaultLineageForm, lineageRequest, seedOf } from "./lineage_form.ts";

// The form of the Lineage screen makes the `lineage` request of lab_ui.md section 4 and nothing else: a scenario, one seed, the records to compare, and the pick.

const ready = { ...READY, scenarios: [...READY.scenarios, { id: "sc03_feed_in_gap", description: "SC3", settings: [], profiles: {} }] };

describe("seedOf", () => {
  it.each([["1", 1], [" 41 ", 41], ["0", 0], ["007", 7]])("Given %j Then %s", (text, seed) => expect(seedOf(text)).toBe(seed));
  it.each(["", "-1", "1.5", "abc", "1e3", "1 2", "12345678901234567890"])("Given %j Then it is no seed", (text) => expect(seedOf(text)).toBeNull());
});

describe("defaultLineageForm", () => {
  it("Given a build that has the SC3 scenario Then the form starts on it, with seed 1, the rule, and the presets A, B and C", () => {
    expect(defaultLineageForm(ready)).toEqual({ scenario: "sc03_feed_in_gap", seed: "1", pick: "rule", sample: "", archs: ["a_manual", "b_lims_lite", "c_context"], ablation: "" });
  });

  it("Given a build without it Then the form starts on the first scenario", () => {
    expect(defaultLineageForm(READY).scenario).toBe("default");
  });
});

describe("lineageRequest", () => {
  const form = defaultLineageForm(ready);

  it("Given the default form Then the request names the scenario, the one seed, A, B and C, and the SC3 rule", () => {
    expect(lineageRequest(form, 7)).toEqual({
      type: "lineage", id: 7, seed: 1, pick: { rule: "sc3" },
      spec: { schema_version: "1", scenario: "sc03_feed_in_gap", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: [1] },
    });
  });

  it("Given a sample the reader chose and an ablation of C Then the pick is that sample and the ablation is the last column", () => {
    const own = { ...form, pick: "reader" as const, sample: " U03-D10-2 ", ablation: "c_context_minus_audit_trail", archs: ["a_manual"] };
    expect(architecturesOf(own)).toEqual(["a_manual", "c_context_minus_audit_trail"]);
    expect(lineageRequest(own, 8)).toMatchObject({ pick: { sample_id: "U03-D10-2" }, spec: { architectures: ["a_manual", "c_context_minus_audit_trail"] } });
  });

  it("Given a form that cannot make a request (a bad seed, no record, a reader pick with no sample) Then none is made", () => {
    expect(lineageRequest({ ...form, seed: "x" }, 1)).toBeNull();
    expect(lineageRequest({ ...form, archs: [] }, 1)).toBeNull();
    expect(lineageRequest({ ...form, pick: "reader", sample: " " }, 1)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { DECISION_SCENARIO, canShow, challengeStart, defaultChallengeForm, formFor, seedChoices } from "./challenge_form.ts";
import { READY } from "./fixture.ts";

// The start form of the Challenge screen makes the `challenge_start` request of lab_ui.md section 4. Which records can be searched comes from `ready.challenge_records` (typed in the
// fixture: A for both variants, B for the sample variant, C for neither, C without system_issued_id for both, C without audit_trail for neither).

describe("canShow", () => {
  it("Given the sample variant Then A, B and C without system_issued_id can be searched; C and the other ablations cannot, with the reason", () => {
    expect(canShow(READY, "sample", "a_manual")).toEqual({ ok: true });
    expect(canShow(READY, "sample", "b_lims_lite")).toEqual({ ok: true });
    expect(canShow(READY, "sample", "c_context_minus_system_issued_id")).toEqual({ ok: true });
    expect(canShow(READY, "sample", "c_context")).toEqual({ ok: false, reason: "challenge.shown.disabled.all_prevented" }); // "every drawn type is prevented in C"
    expect(canShow(READY, "sample", "c_context_minus_audit_trail")).toEqual({ ok: false, reason: "challenge.shown.disabled.no_type" });
  });

  it("Given the decision variant Then only the records without system_issued_id can be searched, and the reason is that flag", () => {
    expect(canShow(READY, "decision", "a_manual")).toEqual({ ok: true });
    expect(canShow(READY, "decision", "c_context_minus_system_issued_id")).toEqual({ ok: true });
    for (const id of ["b_lims_lite", "c_context", "c_context_minus_audit_trail"]) expect(canShow(READY, "decision", id), id).toEqual({ ok: false, reason: "challenge.shown.disabled.system_issued_id" });
  });
});

describe("the form", () => {
  it("Given the sample variant Then the seed is the first of the list of experiment 1, the record the first one that can be searched, and the scenario the one given", () => {
    expect(formFor(READY, "sample", "small")).toEqual({ variant: "sample", scenario: "small", seed: String(READY.seed_list[0]), shown: "a_manual" });
    expect(seedChoices(READY, "sample")).toBe(READY.seed_list);
  });

  it("Given the decision variant Then the scenario is SC8, which the Setup picker does not offer, and the seed is the first of the list of experiment 2", () => {
    expect(formFor(READY, "decision")).toEqual({ variant: "decision", scenario: DECISION_SCENARIO, seed: String(READY.decision_seed_list[0]), shown: "a_manual" });
    expect(DECISION_SCENARIO).toBe("sc08_ph_restandardisation");
    expect(READY.scenarios.map((s) => s.id)).not.toContain(DECISION_SCENARIO);
  });

  it("Given a build that offers the sample variant alone Then the default form is the sample variant", () => {
    expect(defaultChallengeForm({ ...READY, challenge_variants: ["sample"] }).variant).toBe("sample");
  });
});

describe("challengeStart", () => {
  it("Given the default form Then the request names the variant, a spec with the one seed and no architecture, and the record to search", () => {
    const form = defaultChallengeForm(READY);
    expect(challengeStart(form, READY, 12)).toEqual({
      type: "challenge_start", id: 12, variant: "sample", seed: READY.seed_list[0], shown: "a_manual",
      spec: { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [READY.seed_list[0]] },
    });
  });

  it("Given a seed typed by the reader Then it is the seed of the request", () => {
    expect(challengeStart({ ...defaultChallengeForm(READY), seed: "4242" }, READY, 1)).toMatchObject({ seed: 4242, spec: { seeds: [4242] } });
  });

  it("Given a bad seed, a record that cannot be searched or none Then no request is made", () => {
    const form = defaultChallengeForm(READY);
    expect(challengeStart({ ...form, seed: "x" }, READY, 1)).toBeNull();
    expect(challengeStart({ ...form, shown: "c_context" }, READY, 1)).toBeNull();
    expect(challengeStart({ ...form, shown: "" }, READY, 1)).toBeNull();
    expect(challengeStart({ ...formFor(READY, "decision"), shown: "b_lims_lite" }, READY, 1)).toBeNull();
  });
});

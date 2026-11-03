import { describe, expect, it } from "vitest";
import type { PlantCaseSpec } from "../protocol.ts";
import { BREAKOUT_READY } from "./breakout_fixture.ts";
import { breakoutRequest, caseLink, defaultBreakoutForm, editBreakout, plantBreakoutForm } from "./breakout_view.ts";

// P7c (docs/design/lab_ui.md section 24, plant_ui.md section 7, "As built in P7c"): the Break-out screen offers its case in the plant, and a screen opened from the plant starts from the plant's case, seed,
// halls and actions. Expected strings are typed by hand from the key order of the plant link.

const FEED = { kind: "add_feed" as const, at: 291600, unit_id: "U03" };
const SPEC: PlantCaseSpec = { case: "sc12_mycoplasma", architectures: ["a_manual", "c_context"], seed: 9127, actions: [FEED] };
const DEFAULT_ARCHS = "a_manual,b_lims_lite,c_context,c_context_minus_material_lot_links,c_context_minus_equipment_links";

describe("caseLink: the link from the screen to the plant", () => {
  it("Given the form as it starts Then the link is the case with the records ticked, in the order of ready, the seed and the engine", () => {
    expect(caseLink(defaultBreakoutForm(BREAKOUT_READY), BREAKOUT_READY, "9.9.9")).toBe(`#/plant?case=sc12_medium_lot&arch=${DEFAULT_ARCHS}&seed=9013&schema=1&engine=9.9.9`);
  });

  it("Given another case, seed and records Then the link follows the form, not the order they were ticked in", () => {
    const form = { case: "sc12_mycoplasma", seed: "9127", archs: ["c_context", "a_manual"] };
    expect(caseLink(form, BREAKOUT_READY, "9.9.9")).toBe("#/plant?case=sc12_mycoplasma&arch=a_manual,c_context&seed=9127&schema=1&engine=9.9.9");
  });

  it("Given a form that cannot make a request (a bad seed, no record, a case the build does not offer) Then there is no link", () => {
    const form = defaultBreakoutForm(BREAKOUT_READY);
    expect(caseLink({ ...form, seed: "abc" }, BREAKOUT_READY, "9.9.9")).toBeNull();
    expect(caseLink({ ...form, archs: [] }, BREAKOUT_READY, "9.9.9")).toBeNull();
    expect(caseLink({ ...form, case: "sc99_none" }, BREAKOUT_READY, "9.9.9")).toBeNull();
  });

  it("Given a build that offers no case (the public build: ready.breakout is null) Then there is no link", () => {
    const none = { ...BREAKOUT_READY, breakout: null };
    expect(caseLink({ case: "sc12_medium_lot", seed: "9013", archs: ["a_manual"] }, none, "9.9.9")).toBeNull();
  });
});

describe("a screen opened from the plant", () => {
  it("Given the plant's case Then the form is that case, seed and halls, and keeps the plant", () => {
    expect(plantBreakoutForm(SPEC)).toEqual({ case: "sc12_mycoplasma", seed: "9127", archs: ["a_manual", "c_context"], plant: SPEC });
  });

  it("Given such a form Then the request carries the plant's actions, an empty list included; given a form of the reader's own Then it carries none", () => {
    expect(breakoutRequest(plantBreakoutForm(SPEC), BREAKOUT_READY, 5)).toEqual({ type: "breakout", id: 5, case: "sc12_mycoplasma", architectures: ["a_manual", "c_context"], seed: 9127, actions: [FEED] });
    expect(breakoutRequest(plantBreakoutForm({ ...SPEC, actions: [] }), BREAKOUT_READY, 5)).toMatchObject({ actions: [] });
    const own = breakoutRequest(defaultBreakoutForm(BREAKOUT_READY), BREAKOUT_READY, 5);
    expect(own).not.toBeNull();
    expect(own && "actions" in own).toBe(false);
  });

  it.each([["case", { case: "sc12_medium_lot" }], ["seed", { seed: "9013" }], ["records", { archs: ["a_manual"] }]])("Given the %s edited Then the form is the reader's own and the plant's actions are dropped", (_n, patch) => {
    const edited = editBreakout(plantBreakoutForm(SPEC), patch);
    expect("plant" in edited).toBe(false);
    expect(breakoutRequest(edited, BREAKOUT_READY, 5) && "actions" in (breakoutRequest(edited, BREAKOUT_READY, 5) ?? {})).toBe(false);
  });

  it("Given an edit that changes nothing of the run Then the plant is kept", () => {
    expect(editBreakout(plantBreakoutForm(SPEC), {})).toEqual(plantBreakoutForm(SPEC));
  });
});

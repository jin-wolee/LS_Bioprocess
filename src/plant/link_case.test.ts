import { describe, expect, it } from "vitest";
import type { PlantCaseSpec } from "../protocol.ts";
import { addressFor } from "./address.ts";
import { askFromQuery, plantFromQuery, plantQuery, sameSpec } from "./link.ts";
import type { Known } from "./link.ts";
import { DEFAULT_PLANT, hallsOf, isCase, scenarioOf } from "./spec.ts";

// P7c (docs/design/plant_ui.md section 7, "As built in P7c"): the plant link carries a break-out case as `case=` in place of `scenario=`, and is checked like the other keys of the link: a case the
// build does not offer (the public build offers none) falls back on the default plant and the note names the key. Expected strings are typed by hand from the key order of the section.

const FIVE = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"];
const KNOWN: Known = { scenarios: ["default"], architectures: FIVE, breakout: { cases: ["sc12_medium_lot", "sc12_equipment"], seed: 9013, architectures: FIVE } };
const PUBLIC: Known = { scenarios: ["default"], architectures: FIVE, breakout: null };
const ABC = ["a_manual", "b_lims_lite", "c_context"];
const FEED = { kind: "add_feed" as const, at: 291600, unit_id: "U03" };
const CASE: PlantCaseSpec = { case: "sc12_medium_lot", architectures: ABC, seed: 9013, actions: [] };

describe("plantQuery: a case", () => {
  it("Given a case with no action and no instant Then case, arch, seed, schema and engine, in that order", () => {
    expect(plantQuery(CASE, { engine: "9.9.9" })).toBe("case=sc12_medium_lot&arch=a_manual,b_lims_lite,c_context&seed=9013&schema=1&engine=9.9.9");
  });

  it("Given an action and an instant Then the actions are the JSON of the list percent-encoded and t follows them", () => {
    const actions = encodeURIComponent(JSON.stringify([FEED]));
    expect(plantQuery({ ...CASE, actions: [FEED] }, { engine: "9.9.9", t: 305626 })).toBe(`case=sc12_medium_lot&arch=a_manual,b_lims_lite,c_context&seed=9013&actions=${actions}&t=305626&schema=1&engine=9.9.9`);
  });

  it("Given a case Then the link has none of the keys of the run form", () => {
    const keys = plantQuery(CASE, { engine: "9.9.9", t: 7 }).split("&").map((p) => p.split("=")[0]);
    expect(keys).toEqual(["case", "arch", "seed", "t", "schema", "engine"]);
  });
});

describe("askFromQuery: the round trip of a case", () => {
  it.each([["no action", CASE], ["a feed", { ...CASE, actions: [FEED] }], ["five records", { ...CASE, case: "sc12_equipment", architectures: FIVE, seed: 9021 }]])(
    "Given a case with %s and an instant Then the link gives the case and the instant back, with nothing to say",
    (_n, spec) => {
      const link = askFromQuery(plantQuery(spec, { engine: "9.9.9", t: 305626 }), KNOWN);
      expect(link.spec).toEqual(spec);
      expect(link.t).toBe(305626);
      expect(link.engine).toBe("9.9.9");
      expect(link.notes).toEqual([]);
    },
  );

  it("Given a case with only its name Then the halls and the seed are those of the Break-out form (A, B, C and C without each link flag; the first seed of the list)", () => {
    const link = askFromQuery("case=sc12_medium_lot", KNOWN);
    expect(link.spec).toEqual({ case: "sc12_medium_lot", architectures: FIVE, seed: 9013, actions: [] });
    expect(link.notes).toEqual([]);
  });

  it("Given a link with no case Then it is read as plantFromQuery reads it", () => {
    const query = "scenario=default&seed=3&arch=a_manual";
    expect(askFromQuery(query, KNOWN)).toEqual(plantFromQuery(query, KNOWN));
    expect(askFromQuery("", KNOWN).spec).toEqual(DEFAULT_PLANT);
  });

  it("Given the keys of a drill-down Then the origin is read", () => {
    expect(askFromQuery("case=sc12_medium_lot&from=plant", KNOWN).from).toBe(true);
  });
});

describe("askFromQuery: a case is user input, so what the page knows is checked and the page says which key fell back", () => {
  it("Given a case the build does not offer Then the default plant is opened, nothing else of the link is read, and the note names the case", () => {
    const link = askFromQuery("case=nonesuch&seed=5&arch=a_manual&t=400&engine=1.2.3", KNOWN);
    expect(link.spec).toEqual(DEFAULT_PLANT);
    expect(link.notes).toEqual([{ field: "case", given: "nonesuch" }]);
    expect([link.t, link.engine]).toEqual([null, "1.2.3"]);
  });

  it("Given the public build (no case is offered) Then a case the other build offers falls back on the default plant in the same way, and no case spec can be made", () => {
    const link = askFromQuery(plantQuery(CASE, { engine: "9.9.9", t: 305626 }), PUBLIC);
    expect(link.spec).toEqual(DEFAULT_PLANT);
    expect(isCase(link.spec)).toBe(false);
    expect(link.notes).toEqual([{ field: "case", given: "sc12_medium_lot" }]);
    // a build that says nothing of the Break-out screen is the same
    expect(askFromQuery("case=sc12_medium_lot", { scenarios: ["default"], architectures: FIVE }).spec).toEqual(DEFAULT_PLANT);
  });

  it.each(["scenario=default", "set.reactor_count=6", "bays=pilot", "analyzers=hplc", "capture=adapter_ingest"])("Given a case beside the key %s of the run form Then it falls back on the default plant (the Worker refuses the pair)", (key) => {
    const link = askFromQuery(`case=sc12_medium_lot&${key}`, KNOWN);
    expect(link.spec).toEqual(DEFAULT_PLANT);
    expect(link.notes).toEqual([{ field: "case", given: "sc12_medium_lot" }]);
  });

  it("Given halls the page does not know Then they are dropped and named; given none it knows Then the halls of the form are used", () => {
    const some = askFromQuery("case=sc12_medium_lot&arch=a_manual,d_unknown", KNOWN);
    expect((some.spec as PlantCaseSpec).architectures).toEqual(["a_manual"]);
    expect(some.notes).toEqual([{ field: "arch", given: "d_unknown" }]);
    const none = askFromQuery("case=sc12_medium_lot&arch=x,y", KNOWN);
    expect((none.spec as PlantCaseSpec).architectures).toEqual(FIVE);
    expect(none.notes).toEqual([{ field: "arch", given: "x,y" }]);
  });

  it.each(["-1", "1.5", "abc", ""])("Given the seed %j Then the first seed of the form is used and the note names it", (seed) => {
    const link = askFromQuery(`case=sc12_medium_lot&seed=${seed}`, KNOWN);
    expect((link.spec as PlantCaseSpec).seed).toBe(9013);
    expect(link.notes).toEqual([{ field: "seed", given: seed }]);
  });

  it("Given actions that are not JSON, an instant that is not a number and a schema other than 1 Then each is named, in the order of the keys, and the case is kept", () => {
    const link = askFromQuery("case=sc12_medium_lot&actions={oops&t=abc&schema=2", KNOWN);
    expect(link.spec).toEqual({ case: "sc12_medium_lot", architectures: FIVE, seed: 9013, actions: [] });
    expect(link.notes).toEqual([{ field: "actions", given: "{oops" }, { field: "t", given: "abc" }, { field: "schema", given: "2" }]);
  });
});

describe("a case in the page store", () => {
  it("Given a case Then isCase, scenarioOf and hallsOf read it, and a run spec as they did", () => {
    expect([isCase(CASE), scenarioOf(CASE), hallsOf(CASE)]).toEqual([true, "sc12_medium_lot", ABC]);
    expect([isCase(DEFAULT_PLANT), scenarioOf(DEFAULT_PLANT), hallsOf(DEFAULT_PLANT)]).toEqual([false, "default", ABC]);
  });

  it("Given the same case with its actions in another order Then it is the same spec; given another case, seed, hall or action, or a run spec, Then it is not", () => {
    const b = { ...FEED, at: 295200 };
    expect(sameSpec({ ...CASE, actions: [FEED, b] }, { ...CASE, actions: [b, FEED] })).toBe(true);
    expect(sameSpec(CASE, structuredClone(CASE))).toBe(true);
    for (const other of [{ ...CASE, case: "sc12_equipment" }, { ...CASE, seed: 9014 }, { ...CASE, architectures: ["a_manual"] }, { ...CASE, actions: [FEED] }]) expect(sameSpec(CASE, other)).toBe(false);
    expect(sameSpec(CASE, DEFAULT_PLANT)).toBe(false);
    expect(sameSpec(DEFAULT_PLANT, CASE)).toBe(false);
  });

  it("Given a case with an action Then the address is its link; given a case with none and an address without actions Then nothing is written", () => {
    const withFeed = { ...CASE, actions: [FEED] };
    expect(addressFor(withFeed, "9.9.9", "#/plant?case=sc12_medium_lot")).toBe(`#/plant?${plantQuery(withFeed, { engine: "9.9.9" })}`);
    expect(addressFor(CASE, "9.9.9", "#/plant?case=sc12_medium_lot")).toBeNull();
  });
});

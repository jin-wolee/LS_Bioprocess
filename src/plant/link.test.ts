import { describe, expect, it } from "vitest";
import type { PlantSpec } from "../protocol.ts";
import { instantIn, plantFromQuery, plantQuery, sameSpec } from "./link.ts";
import type { Known } from "./link.ts";
import { DEFAULT_PLANT } from "./spec.ts";

// The link of the plant (docs/design/plant_ui.md section 7, "As built in P5c"): `#/plant?scenario=..&seed=..&arch=..&actions=..&t=..&schema=1&engine=<version>` holds the spec, the actions and the
// instant, never a result, and is checked like a spec: what the page knows it falls back on, saying which, and what the Worker checks it passes on. Pure functions, no DOM. Expected strings are typed
// by hand from the key order of the section.

const KNOWN: Known = { scenarios: ["default", "small"], architectures: ["a_manual", "b_lims_lite", "c_context", "c_context_minus_audit_trail"] };
const FEED = { kind: "add_feed" as const, at: 291600, unit_id: "U03" };
const rich: PlantSpec = {
  run: { schema_version: "1", scenario: "small", settings: { reactor_count: 6, bay_size: 6 }, bay_profiles: ["pilot"], analyzer_profiles: ["hplc"], capture_path: "adapter_ingest", architectures: ["a_manual", "c_context_minus_audit_trail"], seeds: [41] },
  seed: 41,
  actions: [FEED],
};

describe("plantQuery: the spec, the actions and the instant", () => {
  it("Given the default plant Then the scenario, the halls, the seed, the schema and the engine, and no actions and no instant", () => {
    expect(plantQuery(DEFAULT_PLANT, { engine: "9.9.9" })).toBe("scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&schema=1&engine=9.9.9");
  });

  it("Given settings, lists, a capture path, an action and an instant Then each has its key, the actions are the JSON of the list percent-encoded, and the settings are in the order of their names", () => {
    const actions = encodeURIComponent(JSON.stringify([FEED]));
    expect(plantQuery(rich, { engine: "9.9.9", t: 305626 })).toBe(
      `scenario=small&set.bay_size=6&set.reactor_count=6&bays=pilot&analyzers=hplc&capture=adapter_ingest&arch=a_manual,c_context_minus_audit_trail&seed=41&actions=${actions}&t=305626&schema=1&engine=9.9.9`,
    );
  });

  it("Given no result anywhere Then no key of the link is a result, a hash or a count", () => {
    const keys = plantQuery(rich, { engine: "9.9.9", t: 7 }).split("&").map((p) => p.split("=")[0]);
    expect(keys).toEqual(["scenario", "set.bay_size", "set.reactor_count", "bays", "analyzers", "capture", "arch", "seed", "actions", "t", "schema", "engine"]);
  });
});

describe("plantFromQuery: the round trip", () => {
  it.each([["the default plant", DEFAULT_PLANT], ["a plant with settings, lists, a capture path and an action", rich]])("Given %s and an instant Then the link gives the spec and the instant back, with nothing to say", (_n, spec) => {
    const link = plantFromQuery(plantQuery(spec, { engine: "9.9.9", t: 305626 }), KNOWN);
    expect(link.spec).toEqual(spec);
    expect(link.t).toBe(305626);
    expect(link.engine).toBe("9.9.9");
    expect(link.notes).toEqual([]);
  });

  it("Given a link with no key at all Then it is the default plant at no particular instant", () => {
    const link = plantFromQuery("", KNOWN);
    expect(link.spec).toEqual(DEFAULT_PLANT);
    expect([link.t, link.engine, link.sample, link.from, link.notes]).toEqual([null, null, null, false, []]);
  });

  it("Given the keys of a drill-down Then the sample and the origin are read", () => {
    const link = plantFromQuery("sample=U03-D03-1&from=plant", KNOWN);
    expect([link.sample, link.from]).toEqual(["U03-D03-1", true]);
  });
});

describe("plantFromQuery: a link is user input, so what the page knows is checked and the page says which key fell back", () => {
  it("Given an unknown scenario Then the default one is used and the note names the scenario", () => {
    const link = plantFromQuery("scenario=nonesuch&seed=3", KNOWN);
    expect(link.spec.run.scenario).toBe("default");
    expect(link.spec.seed).toBe(3);
    expect(link.notes).toEqual([{ field: "scenario", given: "nonesuch" }]);
  });

  it.each(["-1", "1.5", "abc", "1e3", "", "12345678901234567890"])("Given the seed %j Then seed 1 is used and the note names it", (seed) => {
    const link = plantFromQuery(`seed=${seed}`, KNOWN);
    expect(link.spec.seed).toBe(1);
    expect(link.spec.run.seeds).toEqual([1]);
    expect(link.notes).toEqual([{ field: "seed", given: seed }]);
  });

  it("Given halls the page does not know Then they are dropped and named; given none it knows Then the default halls are used", () => {
    expect(plantFromQuery("arch=a_manual,d_unknown", KNOWN).spec.run.architectures).toEqual(["a_manual"]);
    expect(plantFromQuery("arch=a_manual,d_unknown", KNOWN).notes).toEqual([{ field: "arch", given: "d_unknown" }]);
    const none = plantFromQuery("arch=x,y", KNOWN);
    expect(none.spec.run.architectures).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(none.notes).toEqual([{ field: "arch", given: "x,y" }]);
  });

  it.each([["not JSON", "{oops"], ["JSON that is not a list", encodeURIComponent('{"kind":"add_feed"}')]])("Given actions that are %s Then there are none and the note names the key", (_n, value) => {
    const link = plantFromQuery(`actions=${value}`, KNOWN);
    expect(link.spec.actions).toEqual([]);
    expect(link.notes).toEqual([{ field: "actions", given: decodeURIComponent(value) }]);
  });

  it("Given a list of actions that the page cannot judge Then it passes them on untouched: the Worker refuses them, with the reason and the index", () => {
    const odd = [{ kind: "hold", at: 5 }];
    const link = plantFromQuery(`actions=${encodeURIComponent(JSON.stringify(odd))}`, KNOWN);
    expect(link.spec.actions).toEqual(odd);
    expect(link.notes).toEqual([]);
  });

  it.each(["-5", "1.5", "abc", "1e3", ""])("Given the instant %j Then there is none and the note names it", (t) => {
    const link = plantFromQuery(`t=${t}`, KNOWN);
    expect(link.t).toBeNull();
    expect(link.notes).toEqual([{ field: "t", given: t }]);
  });

  it("Given a schema other than 1 Then the note names it, and the link is read as the schema of the build", () => {
    expect(plantFromQuery("schema=2", KNOWN).notes).toEqual([{ field: "schema", given: "2" }]);
  });

  it("Given a setting that is not a number Then it is dropped and the note names it", () => {
    const link = plantFromQuery("set.reactor_count=six&set.bay_size=6", KNOWN);
    expect(link.spec.run.settings).toEqual({ bay_size: 6 });
    expect(link.notes).toEqual([{ field: "settings", given: "set.reactor_count=six" }]);
  });

  it("Given the engine of another version Then it is read as it is, for the page to say so and to run with its own", () => {
    expect(plantFromQuery("engine=0.1.0", KNOWN).engine).toBe("0.1.0");
  });
});

describe("instantIn: the instant of a link against the horizon of the plan", () => {
  it.each([[0, 864000], [305626, 864000], [864000, 864000]])("Given %i of %i Then it is kept", (t, horizon) => expect(instantIn(t, horizon)).toEqual({ t, fault: null }));
  it.each([[864001, 864000], [10_000_000, 864000]])("Given %i of %i Then it is outside the run and there is no instant", (t, horizon) => expect(instantIn(t, horizon)).toEqual({ t: null, fault: `${t}` }));
  it("Given no instant Then there is none and nothing to say", () => expect(instantIn(null, 864000)).toEqual({ t: null, fault: null }));
});

describe("sameSpec: whether a run has to be asked for again", () => {
  it("Given the same spec Then it is the same; given none yet Then it is not", () => {
    expect(sameSpec(rich, structuredClone(rich))).toBe(true);
    expect(sameSpec(null, rich)).toBe(false);
  });

  it("Given the same actions in another order Then it is the same spec (the Worker names them in one order)", () => {
    const b = { ...FEED, at: 295200 };
    expect(sameSpec({ ...rich, actions: [FEED, b] }, { ...rich, actions: [b, FEED] })).toBe(true);
  });

  it.each([
    ["another seed", { ...rich, seed: 42, run: { ...rich.run, seeds: [42] } }],
    ["another action", { ...rich, actions: [{ ...FEED, at: 295200 }] }],
    ["no action", { ...rich, actions: [] }],
    ["another setting", { ...rich, run: { ...rich.run, settings: { reactor_count: 7, bay_size: 6 } } }],
    ["another hall", { ...rich, run: { ...rich.run, architectures: ["a_manual"] } }],
  ])("Given %s Then it is not the same spec", (_n, other) => expect(sameSpec(rich, other as PlantSpec)).toBe(false));
});

describe("P6a: the actions the address holds (plant_ui.md section 5.5, 'As built in P6a')", () => {
  // the three actions of the fixture three_together, typed by hand: a draw moved to 10:30, AN-1 down from 13:00 for two hours, a feed on U03, all entered at day 3 09:00
  const move = { kind: "move_draw" as const, at: 291600, sample_id: "U03-D03-1", to: 297000 };
  const down = { kind: "analyzer_down" as const, at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 };
  const feed = { kind: "add_feed" as const, at: 291600, unit_id: "U03" };
  const orders = [[move, down, feed], [move, feed, down], [down, move, feed], [down, feed, move], [feed, move, down], [feed, down, move]];

  it.each(orders.map((o, i) => [i, o] as const))("Given the three actions entered in order %i Then the link returns the list as it was entered, the same plant as the other orders", (_i, entered) => {
    const spec: PlantSpec = { ...DEFAULT_PLANT, actions: [...entered] };
    const back = plantFromQuery(plantQuery(spec, { engine: "9.9.9" }), KNOWN);
    expect(back.notes).toEqual([]);
    expect(back.spec.actions).toEqual(entered);
    expect(sameSpec(back.spec, { ...DEFAULT_PLANT, actions: [move, down, feed] })).toBe(true);
  });

  it("Given a list of three Then its link carries the JSON of the list in the order of entry, percent-encoded", () => {
    const query = plantQuery({ ...DEFAULT_PLANT, actions: [feed, down, move] }, { engine: "9.9.9" });
    expect(query).toBe(`scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&actions=${encodeURIComponent('[{"kind":"add_feed","at":291600,"unit_id":"U03"},{"kind":"analyzer_down","at":291600,"analyzer":"AN-1","from":306000,"length_min":120},{"kind":"move_draw","at":291600,"sample_id":"U03-D03-1","to":297000}]')}&schema=1&engine=9.9.9`);
  });
});


describe("untrusted actions", () => {
  it.each([Array(17).fill(FEED), [{kind: "x", nested: {x: 1}}], [{kind: "x", nested: [1]}], [{kind: "x", text: "x".repeat(257)}], [7], [Object.fromEntries(Array.from({length: 17}, (_, i) => [String(i), i]))]].map((x) => [x]))("rejects unsafe payloads", (actions) => {
    const link = plantFromQuery(`actions=${encodeURIComponent(JSON.stringify(actions))}`, KNOWN);
    expect(link.spec.actions).toEqual([]);
    expect(link.notes[0]?.field).toBe("actions");
  });
});

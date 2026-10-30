import { describe, expect, it } from "vitest";
import { runScenario } from "../src/run.ts";
import type { Profile } from "../src/profiles.ts";
import { loadScenario } from "../src/scenario.ts";
import { configOf, lookup, patched, rawScenario, SMALL } from "./support/scenarios.ts";

// Mixed fleets (ADR-0015, spec section 4.5): the two scenario fields, their load-time checks with the messages of 4.5.3, and the plan of routing rule B.
// Expected values are typed by hand from the spec and the bundled profile files (the groups AIO, CELL, CHEM and HPLC); none is read from the code under test.

const AIO = "allinone_atline";
const SPLIT = "split_cellcounter_metabolite";
const HPLC = "hplc";
/** 6 reactors in 2 bays of 3. */
const TWO_BAYS = { ...SMALL, bay_size: 3 };
const load = (settings: Record<string, number>, fields: Record<string, unknown>) => () => configOf("default", { settings, fields: fields as never });
const fleet = (analyzer_profiles: string[], analyzer_count = analyzer_profiles.length) => ({ settings: { ...SMALL, analyzer_count }, fields: { analyzer_profiles } as never });

describe("bay_profiles: the length is the number of bays", () => {
  it("Given 6 reactors in bays of 3 and one profile When it loads Then it names the 1 profile, the 2 bays and the way out", () => {
    expect(load(TWO_BAYS, { bay_profiles: ["bench_manual"] })).toThrow(
      "scenario default: bay_profiles names 1 bioreactor profile but the scenario has 2 bays (reactor_count 6 in bays of 3); name one bioreactor profile per bay, bay 1 first (spec section 4.5)",
    );
  });

  it("Given three profiles for two bays Then the plural is used", () => {
    expect(load(TWO_BAYS, { bay_profiles: ["bench_manual", "bench_manual", "pilot"] })).toThrow(/bay_profiles names 3 bioreactor profiles but the scenario has 2 bays/);
  });

  it("Given 5 reactors in bays of 3 Then there are 2 bays (the last one smaller) and two profiles load", () => {
    expect(load({ ...TWO_BAYS, reactor_count: 5 }, { bay_profiles: ["bench_manual", "micro_mini_parallel"] })).not.toThrow();
    expect(load({ ...TWO_BAYS, reactor_count: 5 }, { bay_profiles: ["bench_manual"] })).toThrow(/has 2 bays \(reactor_count 5 in bays of 3\)/);
  });
});

describe("bay_profiles and analyzer_profiles: ids", () => {
  it("Given an id that is not in the profile set Then the message names the field, the position, the kind and the id", () => {
    expect(load(TWO_BAYS, { bay_profiles: ["bench_manual", "no_such_bay"] })).toThrow('scenario default: bay_profiles[1] names the bioreactor profile "no_such_bay", which is not in the profile set');
    expect(load(SMALL, { analyzer_profiles: [AIO, "no_such_analyzer"] })).toThrow('scenario default: analyzer_profiles[1] names the analyzer profile "no_such_analyzer", which is not in the profile set');
  });

  it("Given a lookup that returns a profile of another kind Then the existing message of the profile loader stands", () => {
    const byIdOnly = (kind: "bioreactor" | "analyzer" | "staff", id: string): unknown => {
      if (["experienced", "trainee"].includes(id) || kind === "staff") return lookup("staff", id);
      return lookup(id === "bench_manual" ? "bioreactor" : "analyzer", id);
    };
    const bays = patched(rawScenario("default"), { settings: TWO_BAYS, fields: { bay_profiles: ["bench_manual", HPLC] } as never });
    expect(() => loadScenario(bays, byIdOnly)).toThrow("profile hplc is a analyzer profile, a bioreactor profile is needed");
    const analyzers = patched(rawScenario("default"), { settings: SMALL, fields: { analyzer_profiles: [AIO, "bench_manual"] } as never });
    expect(() => loadScenario(analyzers, byIdOnly)).toThrow("profile bench_manual is a bioreactor profile, a analyzer profile is needed");
  });
});

describe("analyzer_profiles: the length is analyzer_count", () => {
  it("Given 2 analyzers and one profile Then the message names both numbers", () => {
    expect(load(SMALL, { analyzer_profiles: [AIO] })).toThrow("scenario default: analyzer_profiles names 1 analyzer profile but analyzer_count is 2; name one analyzer profile per analyzer, analyzer 1 first (spec section 4.5)");
    expect(load(SMALL, { analyzer_profiles: [AIO, AIO, HPLC] })).toThrow(/analyzer_profiles names 3 analyzer profiles but analyzer_count is 2/);
  });
});

describe("analyzer_profiles: groups, requests and analytes", () => {
  it("Given two profiles that name the same group Then the load is refused (service time sits on the visit, so one pool cannot serve two profiles)", () => {
    const fast = { ...(lookup("analyzer", AIO) as Profile), profile_id: "allinone_fast" };
    const withFast = (kind: "bioreactor" | "analyzer" | "staff", id: string): unknown => (id === "allinone_fast" ? fast : lookup(kind, id));
    const doc = patched(rawScenario("default"), { settings: SMALL, fields: { analyzer_profiles: [AIO, "allinone_fast"] } as never });
    expect(() => loadScenario(doc, withFast)).toThrow("scenario default: analyzer profiles allinone_atline and allinone_fast both name the group AIO; a group is the pool of one stage of one profile, so the names must differ");
  });

  it("Given profiles.analyzer is the all-in-one and no listed analyzer measures its analytes Then the first one is named", () => {
    expect(load(SMALL, { analyzer_profiles: [HPLC, HPLC] })).toThrow(
      "scenario default: the analyte vcd is requested (it is in the route of profiles.analyzer, allinone_atline) but no analyzer profile in analyzer_profiles measures it; list an analyzer with a profile that does, or change profiles.analyzer (spec section 4.5)",
    );
  });

  it("Given an analyte that two listed profiles measure Then the load is refused with both profiles and their analyzers (rule B)", () => {
    expect(load(SMALL, { analyzer_profiles: [AIO, SPLIT] })).toThrow(
      "scenario default: the analyte vcd is measured by both allinone_atline (analyzer 1) and split_cellcounter_metabolite (analyzer 2); in this build an analyte has one profile (spec section 4.5, routing rule B)",
    );
  });

  it("Given the pH loop of experiment 2 and a list of bay profiles Then the load is refused", () => {
    expect(() => loadScenario(patched(rawScenario("sc08_ph_restandardisation"), { fields: { bay_profiles: ["bench_manual", "bench_manual"] } as never }), lookup)).toThrow(
      "scenario sc08_ph_restandardisation: bay_profiles cannot be combined with the pH loop of experiment 2, which reads one container for every bay (spec section 4.5)",
    );
  });

  it.each([
    ["the all-in-one beside an HPLC", [AIO, HPLC]],
    ["an HPLC beside the all-in-one", [HPLC, AIO]],
    ["the all-in-one twice", [AIO, AIO]],
    ["the split pair twice, which measures every analyte of profiles.analyzer", [SPLIT, SPLIT]],
  ])("Given %s Then the scenario loads", (_label, list) => {
    expect(load({ ...SMALL, analyzer_count: list.length }, { analyzer_profiles: list })).not.toThrow();
  });
});

describe("The plan of rule B and the numbering of the instruments", () => {
  const instruments = (list: string[], count = list.length) => runScenario(configOf("default", fleet(list, count))).l3Input.analyzers;
  const visitsOf = (list: string[]) => (runScenario(configOf("default", fleet(list))).l3Input.requests[0] as { visits: { group: string; service_s: number; method_id?: string; transfer_s?: number }[] }).visits;

  it("Given the all-in-one beside an HPLC Then a sample visits AIO (270 s, A023) and then HPLC (60 s, A028); AN-1 is the AIO, AN-2 the HPLC with its method installed", () => {
    expect(instruments([AIO, HPLC])).toEqual([
      { id: "AN-1", group: "AIO", initial_method: null },
      { id: "AN-2", group: "HPLC", initial_method: "protein_a_titer" },
    ]);
    expect(visitsOf([AIO, HPLC])).toEqual([{ group: "AIO", service_s: 270 }, { group: "HPLC", service_s: 60, method_id: "protein_a_titer" }]);
  });

  it("Given an HPLC listed first Then the order of the list is the order of the visits", () => {
    expect(visitsOf([HPLC, AIO]).map((v) => v.group)).toEqual(["HPLC", "AIO"]);
  });

  it("Given [AIO, AIO, HPLC] Then the two all-in-ones are AN-1 and AN-2 and the HPLC is AN-3, and a sample still has two visits", () => {
    expect(instruments([AIO, AIO, HPLC]).map((a) => [a.id, a.group])).toEqual([["AN-1", "AIO"], ["AN-2", "AIO"], ["AN-3", "HPLC"]]);
    expect(visitsOf([AIO, AIO, HPLC]).map((v) => v.group)).toEqual(["AIO", "HPLC"]);
  });

  it("Given [split, HPLC, split] Then instruments are numbered stage by stage, in list order inside a stage; the plan is CELL, CHEM, HPLC with the hand-off of 60 s (A106) on CHEM only", () => {
    expect(instruments([SPLIT, HPLC, SPLIT]).map((a) => [a.id, a.group])).toEqual([["AN-1", "CELL"], ["AN-2", "HPLC"], ["AN-3", "CELL"], ["AN-4", "CHEM"], ["AN-5", "CHEM"]]);
    expect(visitsOf([SPLIT, HPLC, SPLIT])).toEqual([
      { group: "CELL", service_s: 130 },
      { group: "CHEM", service_s: 120, transfer_s: 60 },
      { group: "HPLC", service_s: 60, method_id: "protein_a_titer" },
    ]);
  });

  it("Given a list that repeats one profile Then the instruments are those of the same profile without a list (today's ids)", () => {
    const plain = runScenario(configOf("default", { profiles: { analyzer: SPLIT }, settings: { ...SMALL, analyzer_count: 3 } })).l3Input.analyzers;
    expect(instruments([SPLIT, SPLIT, SPLIT])).toEqual(plain);
    expect(plain.map((a) => [a.id, a.group])).toEqual([["AN-1", "CELL"], ["AN-2", "CELL"], ["AN-3", "CELL"], ["AN-4", "CHEM"], ["AN-5", "CHEM"], ["AN-6", "CHEM"]]);
  });
});

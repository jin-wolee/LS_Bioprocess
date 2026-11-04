import { describe, expect, it } from "vitest";
import { fleetProblems } from "../src/fleet.ts";
import type { FleetEntry, FleetProblem } from "../src/fleet.ts";
import type { Profile } from "../src/profiles.ts";
import { loadScenario } from "../src/scenario.ts";
import { lookup, patched, rawScenario } from "./support/scenarios.ts";

// U2: the check of the two lists is one pure function, `fleetProblems`, and the load-time check of `loadFleet` throws from its first problem. The Setup page of the lab calls the same function, so
// what the page refuses and what the engine refuses cannot drift. Expected values are typed by hand from the spec (4.5.3) and the bundled profile files; none is read from the code under test.

const AIO = "allinone_atline";
const SPLIT = "split_cellcounter_metabolite";
const HPLC = "hplc";
const CATALOGUE = [AIO, SPLIT, HPLC];
const MENU_ANALYTES = ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"];

const entry = (id: string): FleetEntry => {
  const profile = lookup("analyzer", id) as Profile;
  return { id: profile.profile_id, stages: (profile.route ?? []).map((s) => ({ group: s.group, analytes: s.analytes.map((a) => a.id) })) };
};
const menu = entry(AIO);
const problemsOf = (list: string[]): FleetProblem[] => fleetProblems(list.map(entry), menu);
const seat = (profile: string, analyzer: number) => ({ profile, analyzer });

/** The same list given to the loader as the scenario's own, six reactors, analyzers as many as the list. */
const loads = (list: string[], fleet: Record<string, unknown> = { analyzer_profiles: list }): boolean => {
  try {
    loadScenario(patched(rawScenario("default"), { settings: { reactor_count: 6, bay_size: 6, analyzer_count: list.length }, fields: fleet as never }), lookup);
    return true;
  } catch {
    return false;
  }
};

describe("fleetProblems: the three refusals as data", () => {
  it("Given the all-in-one and the split pair Then every analyte of the all-in-one is shared, in the order of its route, with both analyzers named", () => {
    expect(problemsOf([AIO, SPLIT])).toEqual(MENU_ANALYTES.map((analyte) => ({ kind: "shared_analyte", analyte, first: seat(AIO, 1), second: seat(SPLIT, 2) })));
  });

  it("Given the split pair first and the all-in-one second Then the first holder is the split pair (analyzer 1) and the all-in-one is the second (analyzer 2)", () => {
    expect(problemsOf([SPLIT, AIO]).map((p) => p.kind === "shared_analyte" && [p.analyte, p.first.analyzer, p.second.analyzer])).toEqual([
      ["vcd", 1, 2], ["viability", 1, 2], ["glucose", 1, 2], ["lactate", 1, 2], ["glutamine", 1, 2], ["ph", 1, 2],
    ]);
  });

  it("Given two HPLC and the all-in-one as the menu Then the six analytes of the menu are unmeasured, each with the menu profile", () => {
    expect(problemsOf([HPLC, HPLC])).toEqual(MENU_ANALYTES.map((analyte) => ({ kind: "unmeasured", analyte, menu: AIO })));
  });

  it("Given two profiles that name one group Then the group is named with both profiles and their analyzers (and the analytes they share are listed after it)", () => {
    const fast: FleetEntry = { ...entry(AIO), id: "allinone_fast" };
    const found = fleetProblems([entry(AIO), fast], menu);
    expect(found[0]).toEqual({ kind: "shared_group", group: "AIO", first: seat(AIO, 1), second: seat("allinone_fast", 2) });
    expect(found.slice(1).every((p) => p.kind === "shared_analyte")).toBe(true);
  });

  it("Given a profile listed twice Then it is one pool: no problem with itself, and its first position is the one named", () => {
    expect(problemsOf([AIO, AIO])).toEqual([]);
    expect(problemsOf([SPLIT, SPLIT, SPLIT])).toEqual([]);
    expect(problemsOf([AIO, HPLC, AIO])).toEqual([]);
    expect(problemsOf([HPLC, AIO, SPLIT]).filter((p) => p.kind === "shared_analyte").every((p) => p.kind === "shared_analyte" && p.first.analyzer === 2 && p.second.analyzer === 3)).toBe(true);
  });

  it("Given an analyte listed in two stages of one profile Then it is named once, not twice", () => {
    const twice: FleetEntry = { id: "twice", stages: [{ group: "T1", analytes: ["vcd"] }, { group: "T2", analytes: ["vcd", "titer"] }] };
    const found = fleetProblems([entry(HPLC), twice, entry(SPLIT)], entry(HPLC));
    expect(found.filter((p) => p.kind === "shared_analyte" && p.analyte === "vcd")).toHaveLength(1);
  });

  it("Given the lists that load Then the problems are empty", () => {
    for (const list of [[AIO, HPLC], [HPLC, AIO], [SPLIT, HPLC], [SPLIT, SPLIT]]) expect(problemsOf(list)).toEqual([]);
  });
});

describe("fleetProblems and the loader give one verdict", () => {
  const triples = CATALOGUE.flatMap((a) => CATALOGUE.flatMap((b) => CATALOGUE.map((c) => [a, b, c])));
  it.each([...CATALOGUE.flatMap((a) => CATALOGUE.map((b) => [a, b])), ...triples])("Given the list %s Then fleetProblems is empty exactly when the scenario loads", (...list) => {
    expect(problemsOf(list).length === 0).toBe(loads(list));
  });

  it("Given a list the loader refuses Then its message names what the first problem names (the analyte, both profiles and both analyzers, or the unmeasured analyte)", () => {
    const refusal = (list: string[]): string => {
      try {
        loadScenario(patched(rawScenario("default"), { settings: { reactor_count: 6, bay_size: 6, analyzer_count: list.length }, fields: { analyzer_profiles: list } as never }), lookup);
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    expect(refusal([AIO, SPLIT])).toBe(
      "scenario default: the analyte vcd is measured by both allinone_atline (analyzer 1) and split_cellcounter_metabolite (analyzer 2); in this build an analyte has one profile (spec section 4.5, routing rule B)",
    );
    expect(refusal([HPLC, SPLIT, AIO])).toBe(
      "scenario default: the analyte vcd is measured by both split_cellcounter_metabolite (analyzer 2) and allinone_atline (analyzer 3); in this build an analyte has one profile (spec section 4.5, routing rule B)",
    );
    expect(refusal([HPLC, HPLC])).toBe(
      "scenario default: the analyte vcd is requested (it is in the route of profiles.analyzer, allinone_atline) but no analyzer profile in analyzer_profiles measures it; list an analyzer with a profile that does, or change profiles.analyzer (spec section 4.5)",
    );
  });

  it("Given a list of only the default profile Then the page's check passes and the scenario loads with or without the list", () => {
    expect(problemsOf([AIO, AIO])).toEqual([]);
    expect(loads([AIO, AIO])).toBe(true);
    expect(loads([AIO, AIO], {})).toBe(true);
  });
});

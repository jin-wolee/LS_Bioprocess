import { describe, expect, expectTypeOf, it } from "vitest";
import { checkFleet } from "../../src/experiments/assembly/lab/fleet_check.ts";
import type { FleetProblem as EngineProblem } from "../../src/fleet.ts";
import type { FleetProblem } from "../../../src/protocol.ts";
import { labData } from "../support/lab_data.ts";

// U2 (docs/design/lab_ui.md section 4, rule 6): `checkFleet` is what the Worker answers `fleet_check` with: the problems that the engine's own check of the two lists (fleetProblems, engine/src/fleet.ts)
// finds for an analyzer list, over the bundled analyzer profiles and the menu of the bundled scenario. Expected values are typed by hand from the profile files (AIO measures vcd, viability, glucose,
// lactate, glutamine and ph; the split pair CELL measures vcd and viability, CHEM the other four; HPLC measures titer) and none is read from the code under test.

const data = labData();
const AIO = "allinone_atline";
const SPLIT = "split_cellcounter_metabolite";
const HPLC = "hplc";

describe("the problems of the protocol are the engine's", () => {
  it("Given the shape of a problem Then the protocol declares exactly the engine's", () => {
    expectTypeOf<FleetProblem>().toEqualTypeOf<EngineProblem>();
  });
});

describe("checkFleet: the answer", () => {
  it("Given lists that the engine loads Then the answer is ok with no problem", () => {
    for (const list of [[AIO, AIO], [AIO, HPLC], [HPLC, AIO], [SPLIT, HPLC], [SPLIT, SPLIT, SPLIT], [AIO]]) expect(checkFleet(data, "default", list), list.join()).toEqual({ ok: true, problems: [] });
  });

  it("Given the all-in-one and the split pair Then the six analytes are shared by analyzers 1 and 2, in the order of the route of the split pair", () => {
    const out = checkFleet(data, "default", [AIO, SPLIT]);
    expect(out.ok && out.problems.map((p) => p.kind === "shared_analyte" && [p.analyte, p.first.profile, p.first.analyzer, p.second.profile, p.second.analyzer])).toEqual(
      ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"].map((a) => [a, AIO, 1, SPLIT, 2]),
    );
  });

  it("Given two HPLC Then the six analytes of the menu of the default scenario (the all-in-one) are unmeasured", () => {
    const out = checkFleet(data, "default", [HPLC, HPLC]);
    expect(out).toEqual({ ok: true, problems: ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"].map((analyte) => ({ kind: "unmeasured", analyte, menu: AIO })) });
  });

  it("Given a scenario whose analyzer profile is the HPLC (the four bundled scenarios all use the all-in-one, so the data is changed here) Then the menu is the profile of that scenario", () => {
    const changed = { ...data, scenarios: { ...data.scenarios, default: { ...(data.scenarios.default as object), profiles: { ...(data.scenarios.default as { profiles: object }).profiles, analyzer: HPLC } } } };
    expect(checkFleet(changed, "default", [HPLC, HPLC])).toEqual({ ok: true, problems: [] });
    expect(checkFleet(changed, "default", [AIO, AIO])).toMatchObject({ ok: true, problems: [{ kind: "unmeasured", analyte: "titer", menu: HPLC }] });
  });
});

describe("checkFleet: a request is user input", () => {
  it.each([
    ["an unknown scenario", "no_such", [AIO], /^unknown scenario "no_such" \(bundled: default, /],
    ["a scenario that is not a string", 7, [AIO], /^unknown scenario 7 /],
    ["analyzers that are not a list", "default", AIO, /^analyzers must be a list$/],
    ["an empty list", "default", [], /^analyzers must name at least one profile$/],
    ["an id that is not bundled", "default", [AIO, "no_such"], /^analyzers\[1\] names "no_such", which is not a bundled analyzer profile \(bundled: /],
    ["a bioreactor profile in the list", "default", ["bench_manual"], /^analyzers\[0\] names "bench_manual", which is not a bundled analyzer profile/],
    ["an id that is not a string", "default", [AIO, 3], /^analyzers\[1\] names 3, which is not a bundled analyzer profile/],
  ] as const)("Given %s Then it is refused with a message that names it", (_label, scenario, analyzers, message) => {
    const out = checkFleet(data, scenario, analyzers);
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.message).toMatch(message);
  });
});

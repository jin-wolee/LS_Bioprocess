import { describe, expect, it } from "vitest";
import { entryConfigFor, rawSetupFor } from "../../src/experiments/assembly/raw_setup.ts";
import type { Profile } from "../../src/profiles.ts";
import { CONTROLLERS, DIALECTS } from "../support/raw_run.ts";
import { lookup } from "../support/scenarios.ts";

// The raw layer of a mixed fleet (spec section 4.5.1, 4.5.4): rawSetupFor and entryConfigFor read the plan, that is the distinct listed analyzer profiles in order, where they
// read one profile before. The visit k of the setup is the stage k of the plan. Expected values are hand-typed from the profile files (dialects: all-in-one allinone_csv, split counter
// counter_csv, HPLC cds_table; run times 270 s A023, 130 s A025, 120 s A107, 60 s A028; the all-in-one ladder starts at 1, A090).

const profile = (id: string): Profile => lookup("analyzer", id) as Profile;
const AIO = profile("allinone_atline");
const SPLIT = profile("split_cellcounter_metabolite");
const HPLC = profile("hplc");
const RAW = { export_schedule: "window_end" as const, controller_log_cut: "daily" as const, set_points: { pH: 7, DO: 30, temperature: 37 }, calendar_anchor: "2030-01-07", zone_offset_s: 0 };
const ROSTER = { start_s: 28800, shift_change_s: 46800, end_weekday_s: 64800, end_weekend_s: 50400 };
const setup = (p: Profile | Profile[]) => rawSetupFor(RAW, p, DIALECTS, ROSTER, CONTROLLERS);

describe("rawSetupFor: one profile or the plan of a fleet", () => {
  it("Given one profile as before Then its stages are the visits", () => {
    expect(setup(SPLIT).visits).toEqual([
      { dialect: "counter_csv", analytes: ["vcd", "viability"], run_s: 130 },
      { dialect: "allinone_csv", analytes: ["glucose", "lactate", "glutamine", "ph"], run_s: 120 },
    ]);
    expect(setup([SPLIT]).visits).toEqual(setup(SPLIT).visits);
  });

  it("Given the all-in-one beside an HPLC Then visit 1 is written in allinone_csv and visit 2 in cds_table, and the default dilution is the all-in-one's (1)", () => {
    const s = setup([AIO, HPLC]);
    expect(s.visits).toEqual([
      { dialect: "allinone_csv", analytes: ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"], run_s: 270 },
      { dialect: "cds_table", analytes: ["titer"], run_s: 60 },
    ]);
    expect(s.default_dilution).toBe(1);
  });

  it("Given an HPLC listed first Then the first stage has no dilution ladder and the default dilution is none", () => {
    const s = setup([HPLC, AIO]);
    expect(s.visits.map((v) => v.dialect)).toEqual(["cds_table", "allinone_csv"]);
    expect(s.default_dilution).toBeNull();
  });
});

describe("entryConfigFor: the typed-entry rules of a fleet", () => {
  it("Given the all-in-one beside an HPLC Then the dilution rule is the all-in-one's (its six analytes, factors 1, 2 and 4, A090) and the HPLC adds its titer to the known analytes", () => {
    const e = entryConfigFor([AIO, HPLC], DIALECTS);
    expect(e.dilution).toEqual({ analytes: ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"], factors: [1, 2, 4] });
    expect(Object.keys(e.analytes)).toContain("titer");
    expect(Object.keys(e.analytes)).toContain("glucose");
  });

  it("Given one profile Then the result is that of the list of one", () => {
    expect(entryConfigFor(AIO, DIALECTS)).toEqual(entryConfigFor([AIO], DIALECTS));
  });
});

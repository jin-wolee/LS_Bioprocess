import { describe, expect, it } from "vitest";
import { isValid, ledgerIds, makeAjv, refsOf, rejected } from "../support/schemas.ts";
import { breakoutProfile, runOfDoc } from "./support.ts";
import { docOfM, fx12m } from "./support_m.ts";

// The mycoplasma profile is data, loaded through the one profile schema and lookup like the bacterial one (spec 11.8.5 row 5, ADR-0012): every number is {value, unit, ref}, the ids are ledger ids, the
// values are the ones the ledger entries give (A138 2 d, A197 +10 % air saturation, A146 1 d, A145 8 d, A144 28 d, A148 10.5 mL culture plus 1 mL indicator cell), and every magnitude the ledger gives
// no number for (A219 to A224, A226) is declared a scenario input and carries no value. Typed by hand from 11.8.3, 11.8.4 and the ledger entries.

type P = { value: number; unit: string; ref: string };
const profile = breakoutProfile("mycoplasma") as {
  profile_id: string; kind: string; bundle: string; contamination_type: string; alarm_signal: string; ramp_input: string;
  signals: { signal: string; change: string }[]; tests: Record<string, string>[]; host_effects: Record<string, string>[]; scenario_inputs: Record<string, { unit: string; ref: string }>; params: Record<string, P>;
};

describe("The mycoplasma profile file", () => {
  it("Given the profile schema When the file is validated Then it is valid, and the same file with its kind changed, an unknown key or an empty effects list is rejected", () => {
    const ajv = makeAjv();
    expect(rejected(ajv, "profile", profile)).toBe(false);
    expect(rejected(ajv, "profile", { ...profile, kind: "volcano" })).toBe(true);
    expect(rejected(ajv, "profile", { ...profile, surprise: 1 })).toBe(true);
    expect(rejected(ajv, "profile", { ...profile, host_effects: [] })).toBe(true);
    expect(rejected(ajv, "profile", { ...profile, host_effects: [{ delay: "x", surprise: 1 }] })).toBe(true);
    expect(rejected(ajv, "profile", { ...profile, tests: profile.tests.map((t) => ({ ...t, covered_by: 1 })) })).toBe(true);
  });

  it("Given the file When it is read Then its id is its file name, it is the break-out kind of bundle A158, and every parameter is {value, unit, ref}", () => {
    expect(profile.profile_id).toBe("mycoplasma");
    expect(profile.kind).toBe("breakout");
    expect(profile.bundle).toBe("A158");
    expect(profile.contamination_type).toBe("mycoplasma");
    for (const [name, p] of Object.entries(profile.params)) {
      expect(typeof p.value, name).toBe("number");
      expect(p.unit, name).not.toBe("");
      expect(p.ref, name).toMatch(/^A\d{3}$/);
    }
  });

  it("Given the ledgers When every ref of the file is looked up Then each is a ledger id", () => {
    const ids = ledgerIds();
    const refs = refsOf(profile);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(ids.has(r), r).toBe(true);
  });

  it("Given the ledger entries A138, A197, A146, A145, A144 and A148 When the numbers are compared Then the profile carries exactly them, under those ids", () => {
    expect(profile.params).toEqual({
      onset_to_signal_lag_h: { value: 48, unit: "h", ref: "A138" },
      do_alarm_offset_pct: { value: 10, unit: "% air saturation", ref: "A197" },
      nucleic_acid_test_turnaround_d: { value: 1, unit: "d", ref: "A146" },
      mycoplasma_indicator_cells_turnaround_d: { value: 8, unit: "d", ref: "A145" },
      mycoplasma_culture_turnaround_d: { value: 28, unit: "d", ref: "A144" },
      mycoplasma_indicator_cell_volume_ml: { value: 1, unit: "mL", ref: "A148" },
      mycoplasma_culture_volume_ml: { value: 10.5, unit: "mL", ref: "A148" },
    });
  });

  it("Given the DO rise to the high alarm When the signals are read Then only the DO moves, upward (the sign says high alarm), and the ramp has no default: it comes from the input of A219", () => {
    expect(profile.alarm_signal).toBe("DO");
    expect(profile.signals).toEqual([{ signal: "DO", change: "do_alarm_offset_pct" }]);
    expect("signal_ramp_h" in profile.params).toBe(false);
    expect(profile.ramp_input).toBe("mycoplasma_do_rise_ramp_h");
  });

  it("Given every magnitude the ledger gives no number for When the profile is read Then it is declared as a scenario input of its entry, in the unit the engine expects, and carries no value", () => {
    expect(profile.scenario_inputs).toEqual({
      mycoplasma_do_rise_ramp_h: { unit: "h", ref: "A219" },
      mycoplasma_plateau_delay_d: { unit: "d", ref: "A220" },
      mycoplasma_growth_multiplier_after_plateau: { unit: "factor", ref: "A221" },
      mycoplasma_viability_fall_delay_d: { unit: "d", ref: "A222" },
      mycoplasma_death_multiplier_after_fall: { unit: "factor", ref: "A223" },
      nat_target_covers_organism: { unit: "flag", ref: "A224" },
      nat_sample_volume_ml: { unit: "mL", ref: "A226" },
    });
    for (const name of Object.keys(profile.scenario_inputs)) expect(name in profile.params, name).toBe(false);
  });

  it("Given the three confirming tests When the profile is read Then they are the nucleic-acid test, the indicator cells and the culture in that order, and only the nucleic-acid test depends on the coverage input", () => {
    expect(profile.tests).toEqual([
      { test: "nucleic_acid_test", turnaround: "nucleic_acid_test_turnaround_d", volume: "nat_sample_volume_ml", covered_by: "nat_target_covers_organism" },
      { test: "mycoplasma_indicator_cells", turnaround: "mycoplasma_indicator_cells_turnaround_d", volume: "mycoplasma_indicator_cell_volume_ml" },
      { test: "mycoplasma_culture", turnaround: "mycoplasma_culture_turnaround_d", volume: "mycoplasma_culture_volume_ml" },
    ]);
  });

  it("Given rule S13 When the host effects are read Then the plateau comes first (growth multiplier after N2) and the viability fall second (death multiplier after N4), both through scenario inputs", () => {
    expect(profile.host_effects).toEqual([
      { delay: "mycoplasma_plateau_delay_d", growth: "mycoplasma_growth_multiplier_after_plateau" },
      { delay: "mycoplasma_viability_fall_delay_d", death: "mycoplasma_death_multiplier_after_fall" },
    ]);
  });
});

describe("The scenario and the events of FX12m", () => {
  const ajv = makeAjv();

  it("Given FX12m as a scenario When it is validated Then it is valid", () => {
    expect(isValid(ajv, "scenario", docOfM(fx12m()))).toBe(true);
  });

  it("Given every event of the FX12m run When validated against the event schema Then every one is valid", () => {
    const run = runOfDoc(docOfM(fx12m()));
    expect(run.events.filter((e) => !isValid(ajv, "event", e))).toEqual([]);
    expect(run.events.filter((e) => e.type === "confirm_result").length).toBe(6);
  });
});

import { describe, expect, it } from "vitest";
import { RUN_SIZE_CAP, kindOf, runSize, settingFault } from "../../src/experiments/assembly/lab/settings_bounds.ts";
import { checkPlantSpec } from "../../src/experiments/assembly/lab/plant.ts";
import { checkRunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { scenarioDoc } from "../../src/experiments/assembly/lab/setup.ts";
import { withDecisionScenario } from "../../src/experiments/assembly/lab/challenge_decision.ts";
import { labData } from "../support/lab_data.ts";
import { listFiles, readJson } from "../support/paths.ts";
import { decisionData } from "./decision_data.ts";

// Audit A1, findings F5 and F6 (2026-11-02): the Worker checked that a setting of a link is a known name and a finite number, and nothing more, so `reactor_count` 5.5 ran as
// 6 reactors, 0 as none, a viability of 0 gave an infinite dead density, and nothing bounded the size of a run. The author's decision: the settings a link or the form can carry
// are checked centrally against physical possibility (lab_ui.md section 4, "The settings of a spec"), and a ledger range stays a warning, as today. Expected values are typed by
// hand from that section.

const data = labData();
const home = { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1] };
const check = (settings: Record<string, number>) => checkRunSpec({ ...home, settings }, data);
const refusal = (settings: Record<string, number>): string => {
  const c = check(settings);
  if (c.ok) throw new Error(`expected a refusal of ${JSON.stringify(settings)}`);
  return c.message;
};

describe("F5: a setting that no plant can have is refused", () => {
  it("Given reactor_count 5.5 (a count must be a whole number) When the spec is checked Then it is refused", () => {
    expect(check({ reactor_count: 5.5 }).ok).toBe(false);
  });

  it.each([
    [{ reactor_count: 0 }, /reactor_count must be a count, a whole number of at least 1; it is 0/],
    [{ analyzer_count: 2.5 }, /analyzer_count must be a count/],
    [{ initial_viability_pct: 0 }, /initial_viability_pct must be a viability, above 0 and at most 100 percent/],
    [{ harvest_viability_pct: 100.5 }, /harvest_viability_pct must be a viability/],
    [{ rerun_probability: 2 }, /rerun_probability must be a probability from 0 inclusive to 1 exclusive; it is 2/],
    [{ burst_share: -0.1 }, /burst_share must be a probability/],
    [{ initial_glucose_g_per_l: -1 }, /initial_glucose_g_per_l must be a concentration, not below 0; it is -1/],
    [{ horizon_days: 0 }, /horizon_days must be a duration, above 0/],
    [{ recalibration_interval_h: -2 }, /recalibration_interval_h must be a duration/],
  ])("Given %j When the spec is checked Then it is refused, naming the setting and its kind", (settings, message) => {
    expect(refusal(settings)).toMatch(message);
  });

  it.each<Record<string, number>>([
    { reactor_count: 1 }, { initial_viability_pct: 100 }, { rerun_probability: 0 }, { rerun_probability: 1 - Number.EPSILON }, { initial_glucose_g_per_l: 0 },
    // outside the ledger range of its id (A001: 5 to 100 reactors) but possible: a warning on the page, not a refusal
    { reactor_count: 200 },
  ])("Given %j (at a bound, or outside a ledger range only) When the spec is checked Then it is accepted", (settings) => {
    expect(check(settings).ok).toBe(true);
  });

  it("Given every bundled scenario of the lab and the decision variant with each of its own settings written out When the spec is checked Then it is accepted", () => {
    const all = withDecisionScenario(decisionData()) ?? data;
    for (const id of Object.keys(all.scenarios)) {
      const own = Object.fromEntries(Object.entries(scenarioDoc(all, id).settings).map(([name, s]) => [name, s.value]));
      expect(checkRunSpec({ ...home, scenario: id, settings: own }, all), id).toMatchObject({ ok: true });
    }
  });
});

// F5 rework (2026-11-02, the orchestrator): the check was not total, a negative rate or a negative bolus still passed. Every setting of every bundled scenario has a kind, and a setting
// with none fails here before it can reach a link unchecked.
describe("F5 rework: every setting has a kind", () => {
  it.each([
    [{ mu_max_per_h: -0.1 }, /mu_max_per_h must be a rate, not below 0/],
    [{ glucose_uptake_pmol_per_cell_d: -2.5 }, /glucose_uptake_pmol_per_cell_d must be a rate, not below 0/],
    [{ feed_bolus_pct: -5 }, /feed_bolus_pct must be a share in percent, from 0 to 100/],
    [{ volume_cap_pct: 120 }, /volume_cap_pct must be a share in percent, from 0 to 100/],
    [{ shift_growth_multiplier: -0.5 }, /shift_growth_multiplier must be a factor, not below 0/],
    [{ ph_noise_sd: -0.01 }, /ph_noise_sd must be a spread, not below 0/],
    [{ lactate_switch_on: 0.5 }, /lactate_switch_on must be a switch, 0 or 1/],
    [{ glucose_molar_mass_g_per_mol: 0 }, /glucose_molar_mass_g_per_mol must be a physical constant, above 0/],
    [{ staffed_start_min: -60 }, /staffed_start_min must be an instant, not below 0/],
  ])("Given %j When the spec is checked Then it is refused, naming the setting and its kind", (settings, message) => {
    expect(refusal(settings)).toMatch(message);
  });

  it.each<Record<string, number>>([{ lactate_net_rate_pmol_per_cell_d: -0.3 }, { ph_setpoint: 6.8 }, { lot_step_pct: -2 }, { stagger_bay_offset_min: 0 }])(
    "Given %j (a signed rate, a set point, a signed step, an offset: any finite number) Then it is accepted",
    (settings) => {
      expect(check(settings).ok).toBe(true);
    },
  );

  it("Given every bundled scenario file Then each of its settings has a kind, and its own value obeys it", () => {
    const files = listFiles("data", "scenarios").filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    const missing: string[] = [];
    const broken: string[] = [];
    for (const f of files) {
      const settings = readJson<{ settings?: Record<string, { value: number }> }>("data", "scenarios", f).settings ?? {};
      for (const [name, s] of Object.entries(settings)) {
        if (kindOf(name) === undefined) missing.push(`${f}: ${name}`);
        else if (settingFault(name, s.value) !== null) broken.push(`${f}: ${name}=${s.value}`);
      }
    }
    expect(missing).toEqual([]);
    expect(broken).toEqual([]);
  });
});

describe("F5: the size of a run is capped (a bound of the Worker's time, not a domain number)", () => {
  // (24 reactors + 2 analyzers + 2 + 1 operators) x 21 d x 86400 s / 60 s = 29 x 30,240 = 876,960.
  it("Given the default scenario Then its size is 876,960, below the cap of 10,000,000", () => {
    const own = Object.fromEntries(Object.entries(scenarioDoc(data, "default").settings).map(([name, s]) => [name, s.value]));
    expect(runSize(own)).toBe(876_960);
    expect(RUN_SIZE_CAP).toBe(10_000_000);
  });

  // 10,000,000 / 30,240 = 330.7, so with 2 analyzers and 3 operators the most reactors is 325: (325 + 5) x 30,240 = 9,979,200; 326 gives 331 x 30,240 = 10,009,440.
  it("Given 325 reactors Then the run is accepted, and given 326 Then it is refused by the cap", () => {
    expect(check({ reactor_count: 325 }).ok).toBe(true);
    expect(refusal({ reactor_count: 326 })).toMatch(/is 10009440, above the cap of 10000000/);
  });

  it("Given 10^12 reactors (the audit's case) Then it is refused by the cap before anything runs", () => {
    expect(refusal({ reactor_count: 1e12 })).toMatch(/above the cap/);
  });
});

describe("F6 in a link: the grid of the process", () => {
  it("Given an integration step of 120 s When the spec is checked Then it is refused with the engine's reason, naming A200", () => {
    expect(refusal({ integration_step_s: 120, sensor_cadence_s: 120 })).toMatch(/integration step must be a whole number of seconds that divides one minute.*\(A200\); it is 120 s/);
  });

  it("Given a sensor cadence of 45 s Then it is refused; given 30 s for both Then it is accepted", () => {
    expect(refusal({ sensor_cadence_s: 45 })).toMatch(/sensor cadence must be .*\(A100, A200\)/);
    expect(check({ integration_step_s: 30, sensor_cadence_s: 30 }).ok).toBe(true);
  });

  // 480.5 min is 28,830 s, not a whole minute: the inoculations would fall between two steps.
  it("Given an inoculation start of 480.5 min in a link Then it is refused: it places the inoculations off a whole minute (28830 s)", () => {
    expect(refusal({ inoculation_start_min: 480.5 })).toMatch(/inoculation start \(A188\) must place its event on a whole minute.*it gives 28830 s/);
  });
});


describe("S-02: rerun probability has an exclusive upper bound", () => {
  it.each([-0.01, 1, 1.01])("rejects %s in the spec check", (value) => {
    expect(check({ rerun_probability: value }).ok).toBe(false);
  });
  it("returns invalid_spec from the plant request at 1", () => {
    expect(checkPlantSpec({ run: { ...home, architectures: ["a_manual"], settings: { rerun_probability: 1 } }, seed: 1, actions: [] }, data)).toMatchObject({ ok: false, code: "invalid_spec" });
  });
  it.each([0, 1 - Number.EPSILON])("accepts the boundary value %s", (value) => {
    expect(check({ rerun_probability: value }).ok).toBe(true);
  });
});

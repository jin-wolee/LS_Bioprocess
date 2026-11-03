import { describe, expect, it } from "vitest";
import { parseClosedLoopConfig } from "../../src/experiments/assembly/closed_loop_config.ts";
import { readJson } from "../support/paths.ts";
import { ledgerIds, refsOf } from "../support/schemas.ts";
import { rawScenario } from "../support/scenarios.ts";

// The config of experiment 2 (data/scenarios/experiments/experiment2.json): scenario, architectures, the sensitivity variant, the seed list (written before any run, at least 20
// seeds, A103), the bootstrap settings and the assumption ids the result text names. The engine reads no file: the caller passes the parsed JSON.

const SEEDS = Array.from({ length: 20 }, (_, i) => 5000 + i * 7);
const DOC = {
  schema_version: "1",
  experiment_id: "x2",
  description: "test-only",
  scenario: "sc08_ph_restandardisation",
  presets: ["a_manual", "b_lims_lite", "c_context"],
  variants: [{ id: "c_context_modelled", of: "c_context", bias_handling: "model" }],
  seeds: SEEDS,
  bootstrap: { seed: 9011, resamples: 500 },
  assumptions: ["A041", "A051", "A094", "A095", "A108", "A046"],
};
const bad = (over: Record<string, unknown>, minSeeds = 20): (() => unknown) => () => parseClosedLoopConfig({ ...DOC, ...over }, minSeeds);

describe("SC8 experiment 2 config: the rules of the seed list and the settings", () => {
  it("Given a valid document Then it parses to the same values, with the seeds copied", () => {
    const c = parseClosedLoopConfig(DOC, 20);
    expect(c.seeds).toEqual(SEEDS);
    expect(c.seeds).not.toBe(DOC.seeds);
    expect(c.variants).toEqual([{ id: "c_context_modelled", of: "c_context", bias_handling: "model" }]);
    expect(c.bootstrap).toEqual({ seed: 9011, resamples: 500 });
  });

  it("Given 19 seeds Then it is refused: at least 20 are needed (A103)", () => {
    expect(bad({ seeds: SEEDS.slice(0, 19) })).toThrow(/at least 20 seeds/);
  });

  it("Given a repeated seed or a date-shaped seed Then it is refused", () => {
    expect(bad({ seeds: [...SEEDS.slice(0, 19), SEEDS[0]] })).toThrow(/repeated/);
    expect(bad({ seeds: [...SEEDS.slice(0, 19), 20260101] })).toThrow(/date-shaped/);
  });

  it("Given no bootstrap seed, fewer than one resample or a non-integer seed Then it is refused", () => {
    expect(bad({ bootstrap: { resamples: 500 } })).toThrow(/bootstrap/);
    expect(bad({ bootstrap: { seed: 9011, resamples: 0 } })).toThrow(/resamples/);
    expect(bad({ bootstrap: { seed: -1, resamples: 500 } })).toThrow(/bootstrap/);
  });

  it("Given a variant of a preset that is not listed, or a bias handling other than model Then it is refused", () => {
    expect(bad({ variants: [{ id: "v", of: "x_unknown", bias_handling: "model" }] })).toThrow(/variant/);
    expect(bad({ variants: [{ id: "v", of: "c_context", bias_handling: "exclude" }] })).toThrow(/bias_handling/);
  });

  it("Given a list of assumptions without one of the five the result text always names (A041, A051, A094, A095, A108) Then it is refused", () => {
    expect(bad({ assumptions: ["A041", "A051", "A094", "A095"] })).toThrow(/A108/);
  });

  it("Given an unknown key Then it is refused", () => {
    expect(bad({ extra: 1 })).toThrow(/unknown key extra/);
  });
});

describe("SC8 experiment 2 config: the file in the repository", () => {
  const doc = readJson<typeof DOC>("data", "scenarios", "experiments", "experiment2.json");

  it("Given data/scenarios/experiments/experiment2.json Then it parses with the A103 minimum of 20 seeds", () => {
    const c = parseClosedLoopConfig(doc, 20);
    expect(c.seeds.length).toBeGreaterThanOrEqual(20);
    expect(c.scenario).toBe("sc08_ph_restandardisation");
  });

  it("Then every assumption id it names is in the ledger, and every id is cited in the SC8 scenario or the evaluation settings it runs", () => {
    const ids = ledgerIds();
    for (const id of doc.assumptions) expect(ids.has(id), id).toBe(true);
    const cited = new Set([...refsOf(rawScenario("sc08_ph_restandardisation")), ...refsOf(readJson("data", "scenarios", "evaluation", "default.json")), ...refsOf(readJson("data", "scenarios", "profiles", "analyzer", "allinone_atline.json")), "A103", "A037"]);
    for (const id of doc.assumptions) expect(cited.has(id), `${id} is named by the result text but no setting of the run carries it`).toBe(true);
  });

  it("Then the SC8 scenario is the only scenario with feedback on; every other scenario stays open loop", () => {
    for (const name of ["default", "sc02_shift_burst", "sc03_feed_in_gap", "sc05_one_analyzer_down"]) expect(rawScenario(name).feedback, name).not.toBe(true);
    expect(rawScenario("sc08_ph_restandardisation").feedback).toBe(true);
  });
});

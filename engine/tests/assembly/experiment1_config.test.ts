import { describe, expect, it } from "vitest";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import { parseExperimentConfig } from "../../src/experiments/assembly/config.ts";
import { loadExperiment } from "../support/experiment1.ts";
import { ALL_IDS } from "../support/open_loop_setup.ts";
import { readJson } from "../support/paths.ts";

// S2c2: the seed list of experiment 1 is written in config before any run (prompts/20 Step 4, A103), and a short or date-shaped list fails here.

const minSeeds = evaluationSettings(readJson("scenarios", "evaluation", "default.json")).min_seeds;
const doc = readJson<{ seeds: number[] } & Record<string, unknown>>("scenarios", "experiments", "experiment1.json");

describe("Experiment 1 config: the seed list is written first", () => {
  it("Given the config file Then it lists at least 20 seeds (A103), once each, as non-negative integers", () => {
    expect(minSeeds).toBe(20);
    expect(doc.seeds.length).toBeGreaterThanOrEqual(20);
    expect(new Set(doc.seeds).size).toBe(doc.seeds.length);
    for (const s of doc.seeds) expect(Number.isInteger(s) && s >= 0, String(s)).toBe(true);
  });

  it("Given the config file Then no seed is date-shaped (00 section 2 item 2: YYYYMMDD with year 19xx or 20xx)", () => {
    const dateShaped = doc.seeds.filter((s) => /^(19|20)\d{6}$/.test(String(s)));
    expect(dateShaped).toEqual([]);
  });

  it("Given the config file Then it passes the parser with the seed minimum of the evaluation settings", () => {
    expect(parseExperimentConfig(doc, minSeeds).seeds).toEqual(doc.seeds);
  });

  it("Given the config file Then it names the default scenario, the three presets and the ablations of C", () => {
    const cfg = parseExperimentConfig(doc, minSeeds);
    expect([cfg.scenario, cfg.presets, cfg.ablations_of]).toEqual(["default", ["a_manual", "b_lims_lite", "c_context"], "c_context"]);
  });
});

describe("Experiment 1 config: what the runner loads from it", () => {
  it("Then the open-loop input has the whole seed list, the default scenario and the thirteen architectures in the order A, B, C, then the ablations of C", () => {
    const { input, head } = loadExperiment(doc);
    expect(input.seeds).toEqual(doc.seeds);
    expect(input.scenario.scenario_id).toBe("default");
    expect(input.architectures.map((a) => a.id)).toEqual(ALL_IDS);
    expect(head).toEqual({ experiment_id: "experiment1", min_seeds: 20, ablations_of: "c_context" });
  });
});

describe("Experiment 1 config: the parser refuses what the rules refuse (test-only documents)", () => {
  const good = { schema_version: "1", experiment_id: "x", scenario: "default", presets: ["a_manual"], ablations_of: "c_context", seeds: Array.from({ length: 20 }, (_, i) => 1000 + i) };
  it("Then a list of 19 seeds fails: fewer than the A103 minimum", () => {
    expect(() => parseExperimentConfig({ ...good, seeds: good.seeds.slice(0, 19) }, 20)).toThrow(/at least 20 seeds/);
  });
  it("Then a date-shaped seed fails, for years 19xx and 20xx", () => {
    for (const bad of [20251029, 19991231, 20000101]) expect(() => parseExperimentConfig({ ...good, seeds: [...good.seeds.slice(1), bad] }, 20), String(bad)).toThrow(/date-shaped/);
  });
  it("Then a repeated seed, a negative one and a fraction fail", () => {
    expect(() => parseExperimentConfig({ ...good, seeds: [...good.seeds.slice(1), 1001] }, 20)).toThrow(/repeated/);
    expect(() => parseExperimentConfig({ ...good, seeds: [...good.seeds.slice(1), -3] }, 20)).toThrow(/non-negative integer/);
    expect(() => parseExperimentConfig({ ...good, seeds: [...good.seeds.slice(1), 7.5] }, 20)).toThrow(/non-negative integer/);
  });
  it("Then an unknown key and a wrong schema_version fail", () => {
    expect(() => parseExperimentConfig({ ...good, extra: 1 }, 20)).toThrow(/unknown key/);
    expect(() => parseExperimentConfig({ ...good, schema_version: "2" }, 20)).toThrow(/schema_version/);
  });
  it("Then a seed list that passes is returned as it is, in the given order", () => {
    expect(parseExperimentConfig(good, 20).seeds).toEqual(good.seeds);
  });
});

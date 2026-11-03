import { beforeAll, describe, expect, it } from "vitest";
import { inputOf } from "./support/sc_run.ts";
import { runSeed } from "../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../src/experiments/assembly/run_seed.ts";
import type { ScenarioRun } from "../src/run.ts";
import { logHash } from "../src/trace.ts";
import { CONFIGS } from "./support/cells.ts";
import { eventsOf } from "./support/sc_run.ts";
import { runOf } from "./support/scenarios.ts";

// SC1 Ordinary Tuesday (spec 7): what disappears on an ordinary day? The default scenario, seed 1, recorded under A, B, C and the ten ablations of C
// (docs/prompts/20 Step 4). Structural relations only (spec section 8, anti-gaming rule 8): that every configuration is produced from one truth run, that the
// truth log is the same one whatever the recorder does with it, and that every cell counts the same requests. No ordering of the architectures is asserted.

describe("SC1 ordinary Tuesday", () => {
  let run: ScenarioRun;
  let hashBefore: string;
  const hashesAfter: string[] = [];
  const outputs: SeedOutput[] = [];

  beforeAll(async () => {
    run = runOf("default", { seed: 1 });
    hashBefore = await logHash(run.events);
    for (const c of CONFIGS) {
      outputs.push(runSeed(inputOf(run, "default", [c.config], 21))); // one configuration per pass: the truth log is hashed after each
      hashesAfter.push(await logHash(run.events));
    }
  }, 120_000);

  it("Given the ordinary-day scenario When A, B, C and the ten ablations are recorded Then there are thirteen datasets, each named after its configuration", () => {
    expect(outputs.length).toBe(13);
    expect(outputs.map((o) => Object.keys(o.datasets))).toEqual(CONFIGS.map((c) => [c.config.id]));
    expect(outputs.map((o, i) => o.datasets[(CONFIGS[i] as (typeof CONFIGS)[number]).config.id]?.architecture.id)).toEqual(CONFIGS.map((c) => c.config.id));
  });

  it("Given the same truth run When each configuration has been injected, recorded, validated and evaluated Then the truth log_hash is identical after every one of the thirteen", () => {
    expect(hashBefore).toMatch(/^[0-9a-f]{64}$/);
    expect(hashesAfter).toEqual(CONFIGS.map(() => hashBefore));
  });

  it("Then every dataset holds one batch per inoculation of the truth log and at least one result per analyte measured on the first day (it is a record of the run, not an empty table)", () => {
    const inoculations = eventsOf(run, "inoculation").length;
    expect(inoculations).toBeGreaterThan(0);
    outputs.forEach((o, i) => {
      const ds = o.datasets[(CONFIGS[i] as (typeof CONFIGS)[number]).config.id];
      expect(ds?.batch.length, CONFIGS[i]?.name).toBe(inoculations);
      expect(ds?.result.length, CONFIGS[i]?.name).toBeGreaterThan(100);
    });
  });

  it("Then every cell counts the same requests: all analysis requests of the truth log, the refused draws included (anti-gaming rule 1)", () => {
    const requests = eventsOf(run, "sample_drawn").length + eventsOf(run, "draw_skipped_volume_budget").length;
    expect(requests).toBeGreaterThan(100);
    expect(outputs.map((o) => o.cells.map((c) => c.n_requests))).toEqual(CONFIGS.map(() => [requests]));
  });
});

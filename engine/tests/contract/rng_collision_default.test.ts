import { describe, expect, it } from "vitest";
import { runScenario } from "../../src/run.ts";
import { canonicalKey, streamSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { configOf } from "../support/scenarios.ts";

// The stream-seed collision test of the RNG row (docs/prompts/10 Step 1), now on the default scenario:
// up to 200 seeds (the A103 upper bound) times the streams the run itself asks for, enumerated from the run, never hard-coded.

describe("Contract: stream-seed collisions on the default scenario", () => {
  it("200 seeds times every stream of the run (sensors, sampling, measurement, instruments): no stream is asked for twice and no two keys hash to one 64-bit seed", () => {
    const cfg = configOf("default");
    const names = new Set<string>();
    const seeds = new Set<bigint>();
    let total = 0;
    const onKey = (k: readonly unknown[]): void => {
      const key = k as StreamKey;
      names.add(canonicalKey(key));
      seeds.add(streamSeed(key));
      total++;
    };
    for (let seed = 1; seed <= 200; seed++) runScenario({ ...cfg, seed }, { onKey });
    expect(total).toBeGreaterThan(500_000);
    expect(names.size).toBe(total);
    expect(seeds.size).toBe(total);
  }, 900_000);
});

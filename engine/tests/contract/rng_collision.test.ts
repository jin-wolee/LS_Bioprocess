import { describe, expect, it } from "vitest";
import { runL3 } from "../../src/analysis.ts";
import { runMmc } from "../../src/mmc.ts";
import { canonicalKey, streamSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { makeWorkload } from "../support/workload.ts";

describe("Contract: stream-seed collisions", () => {
  it("200 seeds times the streams the run itself draws (L3 noise, M/M/c, test workloads): zero collisions", () => {
    const keys: StreamKey[] = [];
    const onKey = (k: readonly unknown[]): void => void keys.push(k as StreamKey);
    for (let seed = 1; seed <= 200; seed++) {
      runL3(makeWorkload(seed, onKey), { onKey });
      runMmc({ mode: "mmc_validation", seed, servers: 2, mean_service_s: 270, mean_interarrival_s: 168.75, customers: 300, warmup: 0 }, { onKey });
    }
    expect(keys.length).toBeGreaterThan(100_000);
    // no stream is asked for twice: a stream is a single-use name for a draw
    expect(new Set(keys.map(canonicalKey)).size).toBe(keys.length);
    // and no two distinct keys hash to the same 64-bit stream seed
    expect(new Set(keys.map(streamSeed)).size).toBe(keys.length);
  }, 300_000);
});

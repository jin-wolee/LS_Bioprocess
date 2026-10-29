import { describe, expect, it } from "vitest";
import { runScenario } from "../src/run.ts";
import { configOf } from "./support/scenarios.ts";

// I12 performance budget (00 section 4, spec section 9 rung 6): the engine run of the default scenario with one seed takes at most 1 s.
//   START mark: the line before `runScenario(cfg)` is called (the scenario is already loaded and validated; JSON parsing is not engine work).
//   STOP mark:  the line after it returns, when the truth log (`events`), the observable stream (`observable`), the sensor series
//               and the sample and run records are complete in memory.
//   NOT measured: sensor-tick serialisation (sensorTickEvents), canonical JSONL and log hashing.
// Node is the proxy for the Web Worker; the median of 5 timed runs is the figure, the worst run is printed beside it.

describe("I12 engine run time of the default scenario", () => {
  it("the median of 5 runs, seed 1, is at most 1000 ms", () => {
    const cfg = configOf("default");
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const r = runScenario(cfg);
      ms.push(performance.now() - start);
      expect(r.events.length).toBeGreaterThan(1000);
      expect(r.observable.length).toBe(r.events.length);
    }
    const sorted = [...ms].sort((a, b) => a - b);
    const median = sorted[2] as number;
    console.log(`I12 median ${median.toFixed(0)} ms of 5 runs (${ms.map((x) => x.toFixed(0)).join(", ")} ms)`);
    expect(median).toBeLessThanOrEqual(1000);
  }, 60_000);
});

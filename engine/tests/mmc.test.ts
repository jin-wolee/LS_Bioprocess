import { beforeAll, describe, expect, it } from "vitest";
import { runMmc } from "../src/mmc.ts";
import type { MmcResult } from "../src/mmc.ts";

/*
 * M/M/c check (docs/prompts/10 Step 7; engine unit test only, not a scenario).
 *
 * The numbers are test-only inputs, not domain claims. Hand-calculated target, fixed before the run and never taken from the engine:
 *   c = 2, mean service 270 s, utilisation 0.8  ->  lambda = 0.8 * 2 / 270 = 0.005926 /s, mean interarrival 270 / 1.6 = 168.75 s, offered load a = 1.6.
 *   Erlang C: P(wait) = (a^c / c!) / (1 - rho) / (sum_{k<c} a^k / k! + (a^c / c!) / (1 - rho)) = 6.4 / (1 + 1.6 + 6.4) = 32 / 45 = 0.7111
 *   Wq = P(wait) / (c * mu - lambda) = 0.7111 / 0.0014815 = 480 s.
 * 100 replications, fixed seeds 1..100, each 22,000 customers; the first 2,000 are discarded and the next 20,000 counted.
 * Pass if the mean of the replication means is within 3 % of 480 s (465.6 s to 494.4 s); the band is about 3.4 standard errors of that mean.
 * Seeds and tolerance are fixed in advance and are never changed to pass. If this fails: stop and escalate with the replication means,
 * their standard error and the measured utilisation; do not tune the engine, the seeds or the tolerance.
 *
 * Known limits. Sampled continuous durations are rounded to whole seconds (floor(x + 0.5), minimum 1 s), a tiny bias
 * (a few hundredths of a percent here). The real scenarios have near-deterministic service and bursty arrivals (M/D/c-like);
 * this test explains the queue mechanics and does not validate those scenarios.
 *
 * Design spec section 9, rung 2, asks that the analytic mean lie inside the 99 percent confidence interval of the simulated mean over
 * independent replications. The brief's 3 % band is asserted as written; the interval criterion is asserted next to it.
 */

const C = 2;
const MEAN_SERVICE_S = 270;
const MEAN_INTERARRIVAL_S = 168.75;
const CUSTOMERS = 22000;
const WARMUP = 2000;
const REPLICATIONS = 100;
const T_99_DF99 = 2.6264; // two-sided 99 % Student t quantile, 99 degrees of freedom

const ERLANG_WQ_S = 480;

describe("M/M/c hand values", () => {
  it("Erlang C for c = 2, a = 1.6: P(wait) = 32/45 and Wq = 480 s", () => {
    const lambda = (0.8 * 2) / MEAN_SERVICE_S;
    const a = lambda * MEAN_SERVICE_S;
    expect(a).toBeCloseTo(1.6, 12);
    expect(1 / lambda).toBeCloseTo(MEAN_INTERARRIVAL_S, 9);
    const rho = a / C;
    const tail = a ** C / 2 / (1 - rho);
    const pWait = tail / (1 + a + tail);
    expect(pWait).toBeCloseTo(32 / 45, 12);
    expect(pWait / ((C / MEAN_SERVICE_S) - lambda)).toBeCloseTo(ERLANG_WQ_S, 9);
  });
});

describe("M/M/c validation: 100 replications, seeds 1..100", () => {
  const results: MmcResult[] = [];
  beforeAll(() => {
    for (let seed = 1; seed <= REPLICATIONS; seed++) {
      results.push(runMmc({ mode: "mmc_validation", seed, servers: C, mean_service_s: MEAN_SERVICE_S, mean_interarrival_s: MEAN_INTERARRIVAL_S, customers: CUSTOMERS, warmup: WARMUP }));
    }
  }, 900_000);

  const stats = () => {
    const means = results.map((r) => r.mean_wait_s);
    const mean = means.reduce((s, x) => s + x, 0) / means.length;
    const sd = Math.sqrt(means.reduce((s, x) => s + (x - mean) ** 2, 0) / (means.length - 1));
    const se = sd / Math.sqrt(means.length);
    const rho = results.reduce((s, r) => s + r.utilisation, 0) / results.length;
    return { mean, se, rho };
  };

  it("counts 20,000 customers in every replication", () => {
    expect(results.length).toBe(REPLICATIONS);
    for (const r of results) expect(r.counted).toBe(CUSTOMERS - WARMUP);
  });

  it("the measured utilisation is close to the target 0.8", () => {
    const { rho } = stats();
    console.log(`M/M/c measured utilisation ${rho.toFixed(4)}`);
    expect(Math.abs(rho - 0.8)).toBeLessThan(0.01);
  });

  it("the mean of the replication means of Wq is within 3 % of 480 s (465.6 s to 494.4 s)", () => {
    const { mean, se } = stats();
    console.log(`M/M/c mean Wq ${mean.toFixed(2)} s, standard error ${se.toFixed(2)} s, ${(((mean - ERLANG_WQ_S) / ERLANG_WQ_S) * 100).toFixed(2)} % from 480 s`);
    expect(mean).toBeGreaterThanOrEqual(ERLANG_WQ_S * 0.97);
    expect(mean).toBeLessThanOrEqual(ERLANG_WQ_S * 1.03);
  });

  it("design spec section 9: 480 s lies inside the 99 % confidence interval of the simulated mean", () => {
    const { mean, se } = stats();
    console.log(`M/M/c 99 % interval [${(mean - T_99_DF99 * se).toFixed(2)}, ${(mean + T_99_DF99 * se).toFixed(2)}] s`);
    expect(Math.abs(mean - ERLANG_WQ_S)).toBeLessThanOrEqual(T_99_DF99 * se);
  });
});

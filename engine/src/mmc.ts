import { runL3 } from "./analysis.ts";
import type { L3Request } from "./analysis.ts";
import { roundDuration } from "./clock.ts";
import { createRng } from "./rng.ts";
import type { StreamKey } from "./rng.ts";

// M/M/c validation mode (docs/prompts/10 Step 7): a plain config, not a scenario file. Poisson arrivals, exponential service, c identical
// servers, FIFO; no transport, windows, shifts, noise or reruns. It drives the same L3 core as every other run. The numbers it is
// called with are test-only inputs. Integer-second rounding of the sampled durations is a known tiny bias.

export interface MmcConfig {
  mode: "mmc_validation";
  seed: number;
  servers: number;
  mean_service_s: number;
  mean_interarrival_s: number;
  /** Customers simulated; the first `warmup` (by arrival) are discarded, the rest are counted. */
  customers: number;
  warmup: number;
}

export interface MmcResult {
  /** Mean wait in queue (start minus arrival) of the counted customers, seconds. */
  mean_wait_s: number;
  /** Measured utilisation: counted service time over servers times the span of the counted arrivals. */
  utilisation: number;
  counted: number;
}

export const runMmc = (cfg: MmcConfig, opts: { onKey?: (key: StreamKey) => void } = {}): MmcResult => {
  const rng = createRng(opts.onKey);
  const requests: L3Request[] = [];
  let t = 0;
  for (let i = 0; i < cfg.customers; i++) {
    // The canonical tuple: the request index is the id, "-" and 0 fill the analyte and attempt slots.
    t += roundDuration(rng.stream([cfg.seed, String(i), "-", 0, "arrival"]).exponential(cfg.mean_interarrival_s));
    const service_s = roundDuration(rng.stream([cfg.seed, String(i), "-", 0, "service"]).exponential(cfg.mean_service_s));
    requests.push({ request_id: String(i), seq: i + 1, arrive_s: t, visits: [{ group: "S", service_s }] });
  }
  const out = runL3({
    schema_version: "1",
    engine_version: "mmc_validation",
    seed: cfg.seed,
    policy: "fifo",
    analyzers: Array.from({ length: cfg.servers }, (_, k) => ({ id: `S${k + 1}`, group: "S", initial_method: null })),
    setup: [],
    windows: [],
    requests,
    forced_outcomes: [],
  });
  const start = new Map(out.runs.map((r) => [r.request_id, r.start_s] as const));
  let wait = 0;
  let service = 0;
  for (let i = cfg.warmup; i < cfg.customers; i++) {
    const r = requests[i] as L3Request;
    wait += (start.get(r.request_id) as number) - r.arrive_s;
    service += (r.visits[0] as { service_s: number }).service_s;
  }
  const counted = cfg.customers - cfg.warmup;
  const span = (requests[cfg.customers - 1] as L3Request).arrive_s - (requests[cfg.warmup] as L3Request).arrive_s;
  return { mean_wait_s: wait / counted, utilisation: service / (cfg.servers * span), counted };
};

import type { L3Input, L3Request, L3Visit, L3Window } from "../../src/analysis.ts";
import { createRng, entityKey } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { ENGINE_VERSION } from "../../src/trace.ts";

/**
 * Seeded random L3 workload for the invariant loops (Step 6) and the parity traces (Step 8).
 * Every range below is a test-only input, not a domain claim. The generator is a "generator" in the sense of the key
 * contract: its draws come from one stream keyed (seed, "workload", "-", 0, "structure").
 * Arrival times follow sampling time plus a varying transport, so arrival order reverses sampling order often.
 */
export const makeWorkload = (seed: number, onKey?: (key: StreamKey) => void): L3Input => {
  const s = createRng(onKey).stream(entityKey(seed, "workload", "structure"));
  const int = (a: number, b: number): number => s.int(a, b);
  const chance = (p: number): boolean => s.float() < p;
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;

  const groups = Array.from({ length: int(1, 2) }, (_, i) => `G${i + 1}`);
  const methods = ["M1", "M2", "M3"].slice(0, int(1, 3));
  const analyzers: L3Input["analyzers"] = [];
  for (const group of groups) {
    for (let k = int(1, 2); k > 0; k--) {
      analyzers.push({ id: `AN-${analyzers.length + 1}`, group, initial_method: chance(0.5) ? null : pick(methods) });
    }
  }
  const setup = methods.flatMap((a) => methods.filter((b) => b !== a).map((b) => ({ from_method: a, to_method: b, seconds: int(60, 900) })));

  const sampled = Array.from({ length: int(8, 40) }, () => int(0, 6000)).sort((a, b) => a - b);
  const requests: L3Request[] = sampled.map((sampled_s, i) => {
    const arrive_s = sampled_s + int(300, 1800);
    const visits: L3Visit[] = Array.from({ length: chance(0.75) ? 1 : int(2, 3) }, (_, v) => {
      const visit: L3Visit = { group: pick(groups), service_s: int(60, 900), analyte: `a${v + 1}`, noise_sd: chance(0.5) ? 1 : 0.5, true_value: int(0, 100) };
      if (chance(0.6)) visit.method_id = pick(methods);
      if (v > 0 && chance(0.5)) visit.transfer_s = int(1, 120);
      return visit;
    });
    const r: L3Request = { request_id: `R${String(i + 1).padStart(3, "0")}`, seq: i + 1, sampled_s, arrive_s, visits };
    if (chance(0.7)) r.deadline_s = arrive_s + int(600, 7200);
    return r;
  });

  const windows: L3Window[] = [];
  for (const a of analyzers) {
    let cursor = int(300, 3000);
    for (let k = chance(0.5) ? int(1, 2) : 0; k > 0; k--) {
      const end_s = cursor + int(300, 1800);
      windows.push({ analyzer: a.id, start_s: cursor, end_s, kind: chance(0.5) ? "qc" : "maintenance" });
      cursor = end_s + int(300, 3000);
    }
  }

  const forced_outcomes: L3Input["forced_outcomes"] = [];
  for (const r of requests) {
    r.visits.forEach((_, v) => {
      if (!chance(0.12)) return;
      forced_outcomes.push({ request_id: r.request_id, attempt: 1, visit: v + 1, outcome: chance(0.5) ? "qc_failed" : "over_range" });
      if (chance(0.3)) forced_outcomes.push({ request_id: r.request_id, attempt: 2, visit: v + 1, outcome: "qc_failed" });
    });
  }

  return {
    schema_version: "1",
    engine_version: ENGINE_VERSION,
    seed,
    policy: chance(0.5) ? "fifo" : "edf",
    analyzers,
    setup,
    windows,
    requests,
    forced_outcomes,
    dilution_factor: int(2, 10),
  };
};

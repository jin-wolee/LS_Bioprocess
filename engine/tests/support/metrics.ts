import type { Event } from "../../src/generated/event.schema";

// Scenario-sanity metrics computed from the truth log (spec section 8 definitions, minimal forms for the S1b relations).

export interface Hold {
  sample_id: string;
  attempt: number;
  sampled_s: number;
  /** Receipt at the analyzer bench of the sample (sample.arrived_at), the same for every attempt. */
  arrived_s: number;
  started_s: number;
  /** data_model section 5: run_started_at minus the true sampled_at (transport + wait + setup). */
  hold_s: number;
}

/** hold_time of the first visit of every sample that was run: its first attempt, or with `allAttempts` every attempt. */
export const holds = (events: readonly Event[], allAttempts = false): Hold[] => {
  const drawn = new Map<string, number>();
  const received = new Map<string, number>();
  const out: Hold[] = [];
  for (const e of events) {
    if (e.type === "sample_drawn") drawn.set(e.sample_id, e.t);
    else if (e.type === "sample_received") received.set(e.sample_id, e.t);
    else if (e.type === "run_started" && e.visit === 1 && (allAttempts || e.attempt === 1)) {
      const sampled_s = drawn.get(e.request_id) as number;
      out.push({ sample_id: e.request_id, attempt: e.attempt, sampled_s, arrived_s: received.get(e.request_id) as number, started_s: e.t, hold_s: e.t - sampled_s });
    }
  }
  return out;
};

export const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Nearest-rank quantile: the smallest value with at least q of the sample at or below it. */
export const quantile = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)] as number;
};

export const DAY = 86400;
export const dayOf = (t: number): number => Math.floor(t / DAY);
export const isWeekend = (day: number): boolean => day % 7 >= 5;

import { wholeSeconds } from "./clock.ts";
import type { Event } from "./generated/event.schema";
import { readAll } from "./profiles.ts";
import type { Params } from "./profiles.ts";
import { entityKey } from "./rng.ts";
import type { Rng } from "./rng.ts";

// L3 instrument state (spec 2.3, A033): per analyzer a static inter-instrument bias (A032), a drift random walk that accumulates
// between recalibrations and resets at each one (A091, A092), and a step at each reagent lot change (A093). The series are
// exogenous: they do not depend on the queue, so they are drawn up front from streams keyed by the analyzer id.
// The walk moves at the integration step; its variance over one interval is the square of the size in A092.

const DAY = 86400;

export interface InstrumentConfig {
  step_s: number;
  interval_s: number;
  driftPct: number;
  lotStepPct: number;
  biasPct: number;
  horizon_s: number;
  lotChanges: { analyzer: string; at_s: number }[];
}

export const instrumentConfig = (s: Params, horizon_s: number, lotChanges: InstrumentConfig["lotChanges"]): InstrumentConfig => {
  const v = readAll(s, {
    step: ["integration_step_s", "s"], interval: ["recalibration_interval_h", "h"], drift: ["drift_pct", "%"], lotStep: ["lot_step_pct", "%"], bias: ["bias_pct", "%"],
  });
  const c: InstrumentConfig = { step_s: v.step, interval_s: wholeSeconds(v.interval * 3600), driftPct: v.drift, lotStepPct: v.lotStep, biasPct: v.bias, horizon_s, lotChanges };
  if (c.interval_s % c.step_s !== 0) throw new Error("the recalibration interval must be a whole number of integration steps (A091, A200)");
  return c;
};

export interface InstrumentFactor {
  lot_id: string;
  /** Bias + drift + lot steps, in percent of the reading. */
  factor_pct: number;
}

export interface Instruments {
  /** One calibration_recorded per analyzer at every interval from t0 to the horizon. */
  events: Event[];
  factorAt(analyzer: string, t: number): InstrumentFactor;
}

export const buildInstruments = (c: InstrumentConfig, analyzerIds: readonly string[], seed: number, rng: Rng): Instruments => {
  const perInterval = c.interval_s / c.step_s;
  const length = Math.floor((c.horizon_s + 2 * DAY) / c.step_s) + 1; // the queue can run into the day after the horizon
  const events: Event[] = [];
  const state = new Map<string, { bias: number; drift: Float64Array; changes: number[] }>();
  for (const id of analyzerIds) {
    const bias = c.biasPct > 0 ? c.biasPct * (2 * rng.stream(entityKey(seed, id, "bias")).float() - 1) : 0;
    const drift = new Float64Array(length);
    const before = new Map<number, number>();
    if (c.driftPct > 0) {
      const z = rng.stream(entityKey(seed, id, "drift"));
      const sd = c.driftPct * Math.sqrt(c.step_s / c.interval_s);
      let w = 0;
      for (let k = 1; k < length; k++) {
        w += sd * z.gaussian();
        if (k % perInterval === 0) {
          before.set(k, w);
          w = 0;
        }
        drift[k] = w;
      }
    }
    const changes = c.lotChanges.filter((l) => l.analyzer === id).map((l) => l.at_s).sort((a, b) => a - b);
    state.set(id, { bias, drift, changes });
    for (let k = 0; k * c.interval_s <= c.horizon_s; k++) {
      const t = k * c.interval_s;
      events.push({ type: "calibration_recorded", t, analyzer: id, lot_id: `LOT-${1 + changes.filter((a) => a <= t).length}`, drift_before_pct: before.get(k * perInterval) ?? 0 });
    }
  }
  for (const l of c.lotChanges) if (!state.has(l.analyzer)) throw new Error(`lot change for unknown analyzer ${l.analyzer}`);
  return {
    events,
    factorAt(analyzer, t) {
      const s = state.get(analyzer);
      if (!s) throw new Error(`no such analyzer: ${analyzer}`);
      const lots = s.changes.filter((a) => a <= t).length;
      return { lot_id: `LOT-${1 + lots}`, factor_pct: s.bias + (s.drift[Math.min(Math.floor(t / c.step_s), length - 1)] as number) + lots * c.lotStepPct };
    },
  };
};

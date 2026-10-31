import { rampAt } from "../process.ts";
import type { SensorSeries } from "../sensors.ts";
import type { BreakoutConfig } from "./config.ts";
import { rampOf } from "./plan.ts";
import type { BreakoutPlan } from "./plan.ts";

// The signal overlay (spec 11.8.2 rule S1): on every affected unit, the signals of the event type move from their set point along a linear ramp that starts at signal_at minus the ramp and
// ends at signal_at, where the true value of the alarm signal reaches its alarm limit; afterwards the change holds until the unit stops. The true value and the process value move by
// the same amount, so process value minus true value stays the series' own noise: the keyed draw of sensors.ts is not touched and no new draw is made. The ramp is the one of plan.ts and
// process.ts (`rampOf`, `rampAt`), which the pH of a sample drawn from the unit reads too (one pH truth, C1).

export const applySignals = (series: readonly SensorSeries[], plan: BreakoutPlan, b: BreakoutConfig): void => {
  for (const u of plan.units) {
    for (const { signal, change } of b.profile.signals) {
      const s = series.find((x) => x.unit_id === u.unit_id && x.signal === signal);
      if (!s) throw new Error(`breakout: no ${signal} series for ${u.unit_id}`);
      const ramp = rampOf(u, b.ramp_s, change);
      for (let j = 0; j < s.n; j++) {
        const t = s.t0_s + j * s.cadence_s;
        if (t <= ramp.start_s) continue;
        const moved = rampAt(ramp, t);
        s.truth[j] = (s.truth[j] as number) + moved;
        s.pv[j] = (s.pv[j] as number) + moved;
      }
    }
  }
};

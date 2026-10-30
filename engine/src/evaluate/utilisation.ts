import type { Event } from "../generated/event.schema";
import type { Metrics } from "../generated/metrics.schema";
import { ratio } from "./ratio.ts";

const DAY = 86400;

export interface Span {
  analyzers: number;
  days: number;
  /** The staffed window per day (a scenario setting, A098; default 10 h). */
  staffed_window_s: number;
  /** The analyzer profile of each instrument, by instrument id, in instrument order (ADR-0015, spec section 4.5.6). Absent: no per-profile figure. */
  profiles?: Readonly<Record<string, string>>;
}

/**
 * Utilisation (spec section 8): analyzer busy time over analyzer-time in the stated window, always stated twice, each with and without setup.
 * With setup: a visit from `visit_started` (the sample is loaded; setup follows) to `visit_finished`. Without setup: from `run_started`.
 * Denominators: analyzers x days x the staffed window, and analyzers x days x 24 h. Only completed visits count.
 * With a map of instruments to profiles the same figures are also stated per analyzer profile (`by_profile`): the busy time of the profile's instruments over their number
 * times the days times the window. A one-profile fleet has one entry with the counts of the pooled figure.
 */
export const utilisation = (events: readonly Event[], span: Span): Metrics["metrics"]["utilisation"] => {
  const loaded = new Map<string, number>();
  const running = new Map<string, number>();
  const busyOf = new Map<string, number>(); // by instrument: with setup
  const productiveOf = new Map<string, number>();
  let busy = 0;
  let productive = 0;
  for (const e of events) {
    if (e.type !== "visit_started" && e.type !== "run_started" && e.type !== "visit_finished") continue;
    const key = `${e.request_id}/${e.attempt}/${e.visit}`;
    if (e.type === "visit_started") loaded.set(key, e.t);
    else if (e.type === "run_started") running.set(key, e.t);
    else {
      const withSetup = e.t - (loaded.get(key) ?? e.t);
      const without = e.t - (running.get(key) ?? e.t);
      busy += withSetup;
      productive += without;
      busyOf.set(e.analyzer, (busyOf.get(e.analyzer) ?? 0) + withSetup);
      productiveOf.set(e.analyzer, (productiveOf.get(e.analyzer) ?? 0) + without);
    }
  }
  const window = span.analyzers * span.days * span.staffed_window_s;
  const clock = span.analyzers * span.days * DAY;
  const pair = (num: { busy: number; productive: number }, den: number, what: string) => ({
    with_setup: ratio(num.busy, den, `${what}; setup time counts as busy`),
    without_setup: ratio(num.productive, den, `${what}; setup time does not count`),
  });
  const pooled = { busy, productive };
  const profiles = span.profiles;
  const by_profile = profiles && [...new Set(Object.values(profiles))].map((profile) => {
    const mine = Object.entries(profiles).filter(([, p]) => p === profile).map(([id]) => id);
    const sum = (m: ReadonlyMap<string, number>): number => mine.reduce((total, id) => total + (m.get(id) ?? 0), 0);
    const own = { busy: sum(busyOf), productive: sum(productiveOf) };
    return {
      profile,
      instruments: mine.length,
      per_staffed_window: pair(own, mine.length * span.days * span.staffed_window_s, `analyzer-seconds of ${profile} in the staffed windows`),
      per_24h: pair(own, mine.length * span.days * DAY, `analyzer-seconds of ${profile} in 24 h days`),
    };
  });
  return {
    analyzers: span.analyzers,
    days: span.days,
    staffed_window_s: span.staffed_window_s,
    per_staffed_window: pair(pooled, window, "analyzer-seconds in the staffed windows"),
    per_24h: pair(pooled, clock, "analyzer-seconds in 24 h days"),
    ...(by_profile && { by_profile }),
  };
};

import type { Event } from "../generated/event.schema";
import type { Metrics } from "../generated/metrics.schema";
import type { StaffedRoster } from "./config.ts";
import { ratio } from "./ratio.ts";

const DAY = 86400;

export interface Span {
  analyzers: number;
  /** The horizon in days, counted from a Monday at 00:00 (A188); it may end inside a day. */
  days: number;
  /** The windows the roster staffs: a weekday's and a weekend day's (A098, A201). */
  roster: StaffedRoster;
  /** The analyzer profile of each instrument, by instrument id, in instrument order (ADR-0015, spec section 4.5.6). Absent: no per-profile figure. */
  profiles?: Readonly<Record<string, string>>;
}

/**
 * The seconds one analyzer is staffed in a horizon of `days` days (spec section 8): the window of each day of the roster, a weekday's (A098) or a weekend day's (A201,
 * days 5 and 6 of a week; day 0 is a Monday, A188), cut at the horizon. The time after QC and maintenance is not taken off.
 */
export const staffedSeconds = (roster: StaffedRoster, days: number): number => {
  const horizon = Math.round(days * DAY);
  let total = 0;
  for (let day = 0; day * DAY < horizon; day += 1) {
    const end = day % 7 >= 5 ? roster.end_weekend_s : roster.end_weekday_s;
    total += Math.max(0, Math.min(day * DAY + end, horizon) - (day * DAY + roster.start_s));
  }
  return total;
};

/**
 * Utilisation (spec section 8): analyzer busy time over analyzer-time in the stated window, always stated twice, each with and without setup.
 * With setup: a visit from `visit_started` (the sample is loaded; setup follows) to `visit_finished`. Without setup: from `run_started`.
 * Denominators: analyzers x the staffed seconds of the horizon (`staffedSeconds`: a weekday's window and a weekend day's, not the days times one window; audit A1, F4),
 * and analyzers x days x 24 h. Only completed visits count.
 * With a map of instruments to profiles the same figures are also stated per analyzer profile (`by_profile`): the busy time of the profile's instruments over their number
 * times the same staffed seconds. A one-profile fleet has one entry with the counts of the pooled figure.
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
  const staffed = staffedSeconds(span.roster, span.days);
  const window = span.analyzers * staffed;
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
      per_staffed_window: pair(own, mine.length * staffed, `analyzer-seconds of ${profile} in the staffed windows`),
      per_24h: pair(own, mine.length * span.days * DAY, `analyzer-seconds of ${profile} in 24 h days`),
    };
  });
  return {
    analyzers: span.analyzers,
    days: span.days,
    staffed_window_s: span.roster.end_weekday_s - span.roster.start_s,
    per_staffed_window: pair(pooled, window, "analyzer-seconds in the staffed windows"),
    per_24h: pair(pooled, clock, "analyzer-seconds in 24 h days"),
    ...(by_profile && { by_profile }),
  };
};

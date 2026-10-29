import type { Event } from "../generated/event.schema";
import type { Metrics } from "../generated/metrics.schema";
import { ratio } from "./ratio.ts";

const DAY = 86400;

export interface Span {
  analyzers: number;
  days: number;
  /** The staffed window per day (a scenario setting, A098; default 10 h). */
  staffed_window_s: number;
}

/**
 * Utilisation (spec section 8): analyzer busy time over analyzer-time in the stated window, always stated twice, each with and without setup.
 * With setup: a visit from `visit_started` (the sample is loaded; setup follows) to `visit_finished`. Without setup: from `run_started`.
 * Denominators: analyzers x days x the staffed window, and analyzers x days x 24 h. Only completed visits count.
 */
export const utilisation = (events: readonly Event[], span: Span): Metrics["metrics"]["utilisation"] => {
  const loaded = new Map<string, number>();
  const running = new Map<string, number>();
  let busy = 0;
  let productive = 0;
  for (const e of events) {
    if (e.type !== "visit_started" && e.type !== "run_started" && e.type !== "visit_finished") continue;
    const key = `${e.request_id}/${e.attempt}/${e.visit}`;
    if (e.type === "visit_started") loaded.set(key, e.t);
    else if (e.type === "run_started") running.set(key, e.t);
    else {
      busy += e.t - (loaded.get(key) ?? e.t);
      productive += e.t - (running.get(key) ?? e.t);
    }
  }
  const window = span.analyzers * span.days * span.staffed_window_s;
  const clock = span.analyzers * span.days * DAY;
  const pair = (den: number, what: string) => ({
    with_setup: ratio(busy, den, `${what}; setup time counts as busy`),
    without_setup: ratio(productive, den, `${what}; setup time does not count`),
  });
  return {
    analyzers: span.analyzers,
    days: span.days,
    staffed_window_s: span.staffed_window_s,
    per_staffed_window: pair(window, "analyzer-seconds in the staffed windows"),
    per_24h: pair(clock, "analyzer-seconds in 24 h days"),
  };
};

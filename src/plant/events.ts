import type { ScenePlan } from "../protocol.ts";

// The events of the plan that the floor draws (docs/design/plant_ui.md sections 4.2, 4.3 and 9): the instants "next event" steps between, and the lines of the event log of the text alternative.
// Pure functions of the plan, no clock: the plan lists each instant the log has and the floor draws.

/** The dictionary suffix of a line of the log: `plant.log.<key>` is its text. */
export type LogKey =
  | "inoculation" | "feed" | "shift" | "alarm" | "harvest" | "stopped" | "signal" | "deviation"
  | "drawn" | "skipped" | "arrived" | "started" | "finished" | "calibration"
  | "window.qc.start" | "window.qc.end" | "window.maintenance.start" | "window.maintenance.end" | "window.closed.start" | "window.closed.end";

export interface LogItem {
  t: number;
  key: LogKey;
  /** The ids the text names. */
  unit?: string;
  sample?: string;
  operator?: string;
  analyzer?: string;
  /** With `finished`: the outcome of the quality-control check of the run, as the plan holds it. */
  outcome?: string;
}

interface Built {
  items: LogItem[];
  /** The instants that are steps and have no line of their own: a visit queued, a run started. */
  quiet: number[];
  times: number[];
}

const MARKS: Record<string, LogKey> = {
  feed: "feed", temperature_shift: "shift", alarm: "alarm", harvest: "harvest", unit_stopped: "stopped", signal_observed: "signal", deviation_opened: "deviation",
};

const built = new WeakMap<ScenePlan, Built>();

const buildOf = (plan: ScenePlan): Built => {
  const found = built.get(plan);
  if (found) return found;
  const items: LogItem[] = [];
  const quiet: number[] = [];
  const unitId = (i: number): string => (plan.units[i] as { id: string }).id;
  const analyzerId = (i: number): string => (plan.analyzers[i] as { id: string }).id;

  for (const u of plan.units) if (u.start_s !== null) items.push({ t: u.start_s, key: "inoculation", unit: u.id });
  for (const m of plan.marks) {
    const key = MARKS[m.kind];
    if (key) items.push({ t: m.t, key, unit: unitId(m.unit) });
  }
  for (const s of plan.samples) {
    if (s.drawn_s !== null) {
      if (s.skipped) items.push({ t: s.drawn_s, key: "skipped", sample: s.id, unit: unitId(s.unit) });
      else items.push({ t: s.drawn_s, key: "drawn", sample: s.id, unit: unitId(s.unit), ...(s.operator !== null && { operator: (plan.staff[s.operator] as { id: string }).id }) });
    }
    if (s.arrived_s !== null) items.push({ t: s.arrived_s, key: "arrived", sample: s.id });
    for (const v of s.visits) {
      quiet.push(v.queued_s, v.run_started_s);
      items.push({ t: v.started_s, key: "started", sample: s.id, analyzer: analyzerId(v.analyzer) });
      items.push({ t: v.ended_s, key: "finished", sample: s.id, analyzer: analyzerId(v.analyzer), ...(v.qc !== null && { outcome: v.qc }) });
    }
  }
  for (const w of plan.windows) {
    items.push({ t: w.from_s, key: `window.${w.kind}.start`, analyzer: analyzerId(w.analyzer) });
    if (w.to_s <= plan.horizon_s) items.push({ t: w.to_s, key: `window.${w.kind}.end`, analyzer: analyzerId(w.analyzer) });
  }
  for (const c of plan.calibrations) items.push({ t: c.t, key: "calibration", analyzer: analyzerId(c.analyzer) });

  // a stable sort: items at one instant keep the order they were listed in
  const sorted = items.map((item, order) => ({ item, order })).sort((a, b) => a.item.t - b.item.t || a.order - b.order).map((x) => x.item);
  const times = [...new Set([...sorted.map((i) => i.t), ...quiet])].filter((t) => t >= 0 && t <= plan.horizon_s).sort((a, b) => a - b);
  const result = { items: sorted, quiet, times };
  built.set(plan, result);
  return result;
};

/** The instants of the table of section 4.3 that the plan carries, in order and without repeats, inside the run: where "next event" and "previous event" stop. */
export const eventTimes = (plan: ScenePlan): number[] => buildOf(plan).times;

/** The first instant after `t`, or null. `times` is the sorted list of `eventTimes`. */
export const nextEvent = (times: readonly number[], t: number): number | null => {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) > t) hi = mid;
    else lo = mid + 1;
  }
  return lo < times.length ? (times[lo] as number) : null;
};

/** The last instant before `t`, or null. */
export const previousEvent = (times: readonly number[], t: number): number | null => {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? (times[lo - 1] as number) : null;
};

/** The lines of the log with `from < t <= to`, in order. */
export const logBetween = (plan: ScenePlan, from: number, to: number): LogItem[] => {
  const { items } = buildOf(plan);
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((items[mid] as LogItem).t > from) hi = mid;
    else lo = mid + 1;
  }
  const out: LogItem[] = [];
  for (let i = lo; i < items.length && (items[i] as LogItem).t <= to; i++) out.push(items[i] as LogItem);
  return out;
};

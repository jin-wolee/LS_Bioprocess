import type { ScenePlan } from "../protocol.ts";
import { layoutOf } from "./layout.ts";
import type { Layout, Point } from "./layout.ts";
import { LOOK, homeOf } from "./scene_look.ts";
import { lengthOf, pathOf } from "./walk.ts";

// What `sceneAt` derives from a scene plan once and keeps for it (docs/design/plant_ui.md section 4.2): the layout, the walks of the staff, the visits by analyzer and by lane in the order of the
// queue, the marks of each unit, the merged shifts. It is a function of the plan alone, kept per plan object, so it can change no answer of `sceneAt`.

// ---- what is derived from the plan alone -------------------------------------------------------------------

export interface Leg {
  t0: number;
  t1: number;
  path: Point[];
  walking: boolean;
  /** The operator rests at home after this leg (otherwise at the vessel it ended at). */
  atHome: boolean;
  /** With a stay: the sample whose tube is in the hand. */
  sample: number | null;
}

export interface VisitRef {
  id: number;
  sample: number;
  visit: number;
  lane: number;
  analyzer: number;
  queued: number;
  started: number;
  ended: number;
}

export interface Index {
  layout: Layout;
  legs: Leg[][];
  duty: [number, number][];
  marks: ScenePlan["marks"][];
  endKind: ("harvested" | "stopped")[];
  skips: number[][];
  byAnalyzer: VisitRef[][];
  byLane: VisitRef[][];
  refs: VisitRef[][];
  laneOfSample: number[];
  windows: ScenePlan["windows"][];
  calibrations: number[][];
  /** The walk between two points of the floor, kept per pair. */
  route: (a: Point, b: Point) => Point[];
  entry: Map<number, number>;
}

const indexes = new WeakMap<ScenePlan, Index>();

const mergedDuty = (plan: ScenePlan): [number, number][] => {
  const all = plan.staff.flatMap((s) => s.on_duty).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of all) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
};

const byKey = (a: VisitRef, b: VisitRef): number => a.started - b.started || a.queued - b.queued || a.sample - b.sample || a.visit - b.visit;

export const indexOf = (plan: ScenePlan): Index => {
  const cached = indexes.get(plan);
  if (cached) return cached;
  const layout = layoutOf(plan.layout);
  const routes = new Map<string, Point[]>();
  const route = (a: Point, b: Point): Point[] => {
    const key = `${a.x},${a.z}>${b.x},${b.z}`;
    let path = routes.get(key);
    if (!path) {
      path = pathOf(layout, a, b);
      routes.set(key, path);
    }
    return path;
  };
  const access = (unit: number): Point => (layout.vessels[unit] as { access: Point }).access;

  // the visits, by analyzer and by lane, with the order of the queue
  const laneOfGroup = (group: string): number => Math.max(0, layout.lanes.findIndex((l) => l.group === group));
  const refs: VisitRef[][] = [];
  const byAnalyzer: VisitRef[][] = plan.analyzers.map(() => []);
  const byLane: VisitRef[][] = layout.lanes.map(() => []);
  const laneOfSample: number[] = [];
  let id = 0;
  for (const [i, s] of plan.samples.entries()) {
    const first = s.visits[0];
    laneOfSample.push(first ? laneOfGroup((plan.analyzers[first.analyzer] as { group: string }).group) : 0);
    refs.push(s.visits.map((v, k) => {
      const ref: VisitRef = { id: id++, sample: i, visit: k, lane: laneOfGroup((plan.analyzers[v.analyzer] as { group: string }).group), analyzer: v.analyzer, queued: v.queued_s, started: v.started_s, ended: v.ended_s };
      byAnalyzer[v.analyzer]?.push(ref);
      byLane[ref.lane]?.push(ref);
      return ref;
    }));
  }
  for (const list of byAnalyzer) list.sort(byKey);
  for (const list of byLane) list.sort(byKey);

  // the staff: where each operator walks and stays
  const legs = plan.staff.map((_, operator): Leg[] => {
    const home = homeOf(layout, operator);
    const stops = plan.samples
      .flatMap((s, sample) => (s.operator === operator && !s.skipped && s.drawn_s !== null ? [{ t: s.drawn_s, p: access(s.unit), sample }] : []))
      .sort((a, b) => a.t - b.t || a.sample - b.sample);
    const out: Leg[] = [];
    const walk = (t0: number, t1: number, path: Point[], atHome: boolean): void => void out.push({ t0, t1, path, walking: true, atHome, sample: null });
    const seconds = (path: readonly Point[]): number => lengthOf(path) / LOOK.walk_mps;
    let free = Number.NEGATIVE_INFINITY; // the instant the operator is free to go
    let at = home;
    let atHome = true;
    for (const [k, stop] of stops.entries()) {
      const next = stops[k + 1]?.t ?? Number.POSITIVE_INFINITY;
      const there = route(home, stop.p);
      if (atHome) walk(Math.max(free, stop.t - seconds(there)), stop.t, there, false);
      else {
        const back = route(at, home);
        if (stop.t - free >= seconds(back) + seconds(there)) {
          walk(free, free + seconds(back), back, true);
          walk(stop.t - seconds(there), stop.t, there, false);
        } else {
          const direct = route(at, stop.p);
          walk(Math.max(free, stop.t - seconds(direct)), stop.t, direct, false);
        }
      }
      const stay = Math.min(LOOK.stay_s, (next - stop.t) / 2);
      out.push({ t0: stop.t, t1: stop.t + stay, path: [stop.p], walking: false, atHome: false, sample: stop.sample });
      free = stop.t + stay;
      at = stop.p;
      atHome = false;
    }
    if (!atHome) {
      const back = route(at, home);
      walk(free, free + seconds(back), back, true);
    }
    return out;
  });

  const marks: ScenePlan["marks"][] = plan.units.map(() => []);
  for (const m of plan.marks) marks[m.unit]?.push(m);
  const endKind = plan.units.map((u, i) => (marks[i]?.some((m) => m.kind === "unit_stopped" && m.t === u.end_s) ? "stopped" as const : "harvested" as const));
  const skips: number[][] = plan.units.map(() => []);
  for (const s of plan.samples) if (s.skipped && s.drawn_s !== null) skips[s.unit]?.push(s.drawn_s);
  const windows: ScenePlan["windows"][] = plan.analyzers.map(() => []);
  for (const w of plan.windows) windows[w.analyzer]?.push(w);
  const calibrations: number[][] = plan.analyzers.map(() => []);
  for (const c of plan.calibrations) calibrations[c.analyzer]?.push(c.t);

  const made: Index = { layout, legs, duty: mergedDuty(plan), marks, endKind, skips, byAnalyzer, byLane, refs, laneOfSample, windows, calibrations, route, entry: new Map() };
  indexes.set(plan, made);
  return made;
};

/** The place `ref` takes in the queue at the instant it joins it: the tubes with an earlier place in the order that are waiting then. */
export const entryRank = (ix: Index, ref: VisitRef): number => {
  const known = ix.entry.get(ref.id);
  if (known !== undefined) return known;
  let n = 0;
  for (const u of ix.byLane[ref.lane] as VisitRef[]) {
    if (u === ref) break;
    if (u.queued <= ref.queued && ref.queued < u.started) n++;
  }
  ix.entry.set(ref.id, n);
  return n;
};


import type { ScenePlan } from "../protocol.ts";
import { entryRank, indexOf } from "./scene_index.ts";
import type { Index, Leg, VisitRef } from "./scene_index.ts";
import { LOOK, homeOf, lerp, lerpPoint, locate, portOf, rackOf, slotPoint } from "./scene_look.ts";
import type { AnalyzerLamp, AnalyzerState, SceneState, StaffState, TubePhase, TubeState, VesselLamp, VesselState, WindowKind } from "./scene_look.ts";
import type { Point } from "./layout.ts";

// `sceneAt(plan, t)` (docs/design/plant_ui.md sections 4.2 and 4.3): the state at the instant `t` of every object the floor draws, as a pure function of the scene plan and of `t`. It reads no clock,
// keeps no state between calls and imports no three.js, so seeking, pausing and playing backwards need no replay, a screenshot at a fixed `t` shows the same scene every time, and Vitest runs it
// without WebGL. What it caches (the layout of the plan, the walks and the order of the queue) is derived from the plan alone and kept per plan object.
//
// Every instant the log has is drawn at that instant. What the log does not give (the walk to a vessel, the glide of a tube into an analyzer, how long a pulse or a card stays lit) is a view
// constant in `LOOK`, in simulated seconds and metres: not a domain number, so it carries no ledger id.

export { LOOK, laneLength, slotPoint, trayZ } from "./scene_look.ts";
export type { AnalyzerLamp, AnalyzerState, SceneState, StaffMode, StaffState, TubePhase, TubeState, VesselLamp, VesselState } from "./scene_look.ts";

// ---- the state of each kind of object -----------------------------------------------------------------------

const vesselAt = (plan: ScenePlan, ix: Index, unit: number, t: number): VesselState => {
  const u = plan.units[unit] as ScenePlan["units"][number];
  const lamp: VesselLamp = u.start_s === null || t < u.start_s ? "idle" : u.end_s !== null && t >= u.end_s ? (ix.endKind[unit] as "harvested" | "stopped") : "running";
  let shifted = false;
  let deviation = false;
  let feed: VesselState["feed"] = null;
  let alarm = false;
  let signal = false;
  for (const m of ix.marks[unit] as ScenePlan["marks"]) {
    if (m.t > t) continue;
    if (m.kind === "temperature_shift") shifted = true;
    else if (m.kind === "deviation_opened") deviation = true;
    else if (m.kind === "feed" && t - m.t < LOOK.feed_s) feed = { scripted: m.source === "scripted", progress: (t - m.t) / LOOK.feed_s };
    else if (m.kind === "alarm" && t - m.t < LOOK.alarm_s) alarm = true;
    else if (m.kind === "signal_observed" && t - m.t < LOOK.signal_s) signal = true;
  }
  const capTag = (ix.skips[unit] as number[]).some((s) => s <= t && t - s < LOOK.cap_s);
  return { lamp, shifted, feed, beacon: alarm ? "alarm" : signal ? "signal" : null, deviation, capTag };
};

const SIGN_ORDER: WindowKind[] = ["maintenance", "closed", "qc"];

/** The index of the last element of a sorted list whose key is at most `t`, or -1. */
const lastAtMost = <T>(list: readonly T[], key: (x: T) => number, t: number): number => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid] as T) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
};

const analyzerAt = (plan: ScenePlan, ix: Index, analyzer: number, t: number, waiting: number[]): AnalyzerState => {
  const open = (ix.windows[analyzer] as ScenePlan["windows"]).filter((w) => w.from_s <= t && t < w.to_s).map((w) => w.kind);
  const sign = SIGN_ORDER.find((k) => open.includes(k)) ?? null;
  const visits = ix.byAnalyzer[analyzer] as VisitRef[];
  const last = lastAtMost(visits, (v) => v.started, t);
  const current = last >= 0 && t < (visits[last] as VisitRef).ended ? (visits[last] as VisitRef) : null;
  const finished = current ? visits[last - 1] : visits[last];
  const sample = current ? (plan.samples[current.sample] as ScenePlan["samples"][number]) : null;
  const v = sample && current ? (sample.visits[current.visit] as ScenePlan["samples"][number]["visits"][number]) : null;
  const running = v !== null && t >= v.run_started_s;
  const lampOf: AnalyzerLamp = v ? (running ? "run" : "setup") : (sign ?? "idle");
  const recent = (list: VisitRef | undefined, within: number): boolean => list !== undefined && list.ended <= t && t - list.ended < within;
  const done = finished ? (plan.samples[finished.sample] as ScenePlan["samples"][number]).visits[finished.visit] : undefined;
  const cal = ix.calibrations[analyzer] as number[];
  const c = lastAtMost(cal, (x) => x, t);
  const lane = (ix.layout.lanes as { analyzers: number[] }[]).findIndex((l) => l.analyzers.includes(analyzer));
  return {
    lamp: lampOf,
    sign,
    progress: v && running ? (v.ended_s > v.run_started_s ? (t - v.run_started_s) / (v.ended_s - v.run_started_s) : 0) : null,
    verdict: recent(finished, LOOK.verdict_s) ? (done?.qc ?? null) : null,
    slip: recent(finished, LOOK.slip_s),
    calibration: c >= 0 && t - (cal[c] as number) < LOOK.card_s,
    tube: current ? current.sample : null,
    queue: waiting[lane] ?? 0,
  };
};

const staffAt = (plan: ScenePlan, ix: Index, operator: number, t: number): StaffState => {
  const home = homeOf(ix.layout, operator);
  const duty = (plan.staff[operator] as ScenePlan["staff"][number]).on_duty.some(([from, to]) => from <= t && t < to);
  if (!duty) return { on_duty: false, x: home.x, z: home.z, heading: 0, mode: "idle", carrying: null };
  const legs = ix.legs[operator] as Leg[];
  const k = lastAtMost(legs, (leg) => leg.t0, t);
  if (k < 0) return { on_duty: true, x: home.x, z: home.z, heading: 0, mode: "idle", carrying: null };
  const leg = legs[k] as Leg;
  if (t < leg.t1) {
    const here = locate(leg.path, (t - leg.t0) / (leg.t1 - leg.t0));
    return leg.walking
      ? { on_duty: true, x: here.x, z: here.z, heading: here.heading, mode: "walking", carrying: null }
      : { on_duty: true, x: here.x, z: here.z, heading: 0, mode: "at_vessel", carrying: leg.sample };
  }
  const end = leg.path[leg.path.length - 1] as Point;
  return { on_duty: true, x: end.x, z: end.z, heading: 0, mode: leg.atHome ? "idle" : "at_vessel", carrying: null };
};

/** The ranks of the tubes waiting at `t`, by visit, and how many wait in each lane. */
const waitingAt = (ix: Index, t: number): { ranks: Map<number, number>; queue: number[] } => {
  const ranks = new Map<number, number>();
  const queue = ix.byLane.map((list) => {
    let n = 0;
    for (const ref of list) if (ref.queued <= t && t < ref.started) ranks.set(ref.id, n++);
    return n;
  });
  return { ranks, queue };
};

const tubeAt = (plan: ScenePlan, ix: Index, i: number, t: number, ranks: ReadonlyMap<number, number>): TubeState | null => {
  const s = plan.samples[i] as ScenePlan["samples"][number];
  if (s.skipped || s.drawn_s === null || s.arrived_s === null || t < s.drawn_s) return null;
  const l = ix.layout;
  const lane = ix.laneOfSample[i] as number;
  if (l.lanes[lane] === undefined) return null;
  const refs = ix.refs[i] as VisitRef[];
  const { level } = LOOK;
  const tube = (phase: TubePhase, at: Point, y: number, rest: Partial<TubeState> = {}): TubeState => ({ sample: i, phase, x: at.x, y, z: at.z, heading: 0, rank: null, label: s.label, rerun: false, diluted: false, ...rest });

  const vessel = (l.vessels[s.unit] as { access: Point }).access;
  const handEnd = Math.min(s.drawn_s + LOOK.hand_s, s.arrived_s);
  if (t < handEnd) return tube("hand", vessel, level.hand);
  if (t < s.arrived_s) {
    // on the carrier along the aisles to the lane, then to the slot it will hold on arrival
    const first = refs[0];
    const ride = [...ix.route(vessel, l.lanes[lane] as Point), slotPoint(l, lane, first ? entryRank(ix, first) : 0)];
    const here = locate(ride, (t - handEnd) / (s.arrived_s - handEnd));
    return tube("transport", here, level.carrier, { heading: here.heading });
  }

  const visits = s.visits;
  const k = visits.findIndex((v) => v.ended_s > t);
  const rerunOf = (n: number): boolean => ((visits[n] as ScenePlan["samples"][number]["visits"][number]).attempt > 1);
  if (k === -1) {
    const lastIndex = visits.length - 1;
    if (lastIndex < 0) return tube("wait", slotPoint(l, lane, 0), level.lane);
    const last = visits[lastIndex] as ScenePlan["samples"][number]["visits"][number];
    if (t >= last.ended_s + LOOK.leave_s) return null;
    const f = (t - last.ended_s) / LOOK.leave_s;
    return tube("leave", lerpPoint(portOf(l, last.analyzer), rackOf(l), f), lerp(level.port, level.rack, f), { rerun: rerunOf(lastIndex), diluted: last.diluted });
  }
  const v = visits[k] as ScenePlan["samples"][number]["visits"][number];
  const ref = refs[k] as VisitRef;
  const flags = { rerun: rerunOf(k), diluted: v.diluted };
  if (t < v.started_s) {
    const rank = ranks.get(ref.id);
    const slot = slotPoint(l, lane, rank ?? 0);
    const since = k === 0 ? Number.POSITIVE_INFINITY : t - (visits[k - 1] as ScenePlan["samples"][number]["visits"][number]).ended_s;
    if (since < LOOK.enter_s) {
      const f = since / LOOK.enter_s;
      const from = portOf(l, (visits[k - 1] as ScenePlan["samples"][number]["visits"][number]).analyzer);
      return tube("wait", lerpPoint(from, slot, f), lerp(level.port, level.lane, f), { ...flags, rank: rank ?? null });
    }
    return tube("wait", slot, level.lane, { ...flags, rank: rank ?? null });
  }
  const glide = Math.min(LOOK.enter_s, v.ended_s - v.started_s);
  const port = portOf(l, v.analyzer);
  if (t < v.started_s + glide) {
    // the tube glides in from where it rested: the first slot, or, for a later attempt that starts within a glide of the end of the one before, from the port it left (no jump)
    const f = (t - v.started_s) / glide;
    const before = k > 0 ? (visits[k - 1] as ScenePlan["samples"][number]["visits"][number]) : null;
    const back = before ? Math.min(1, (v.started_s - before.ended_s) / LOOK.enter_s) : 1;
    const from = before ? lerpPoint(portOf(l, before.analyzer), slotPoint(l, lane, 0), back) : slotPoint(l, lane, 0);
    return tube("enter", lerpPoint(from, port, f), lerp(lerp(level.port, level.lane, back), level.port, f), flags);
  }
  return tube(t < v.run_started_s ? "setup" : "run", port, level.port, flags);
};

const daylightAt = (ix: Index, t: number): { lit: boolean; daylight: number } => {
  if (ix.duty.length === 0) return { lit: true, daylight: 1 };
  let distance = Number.POSITIVE_INFINITY;
  for (const [from, to] of ix.duty) distance = Math.min(distance, t < from ? from - t : t >= to ? t - to : 0);
  const lit = ix.duty.some(([from, to]) => from <= t && t < to);
  return { lit, daylight: 1 - (1 - LOOK.dim) * Math.min(1, distance / LOOK.ramp_s) };
};

/** Whether the floor is inside the staffed window at `t`, and the light of the day (what `sceneAt` says of them, without the rest of the scene). */
export const lightAt = (plan: ScenePlan, t: number): { lit: boolean; daylight: number } => daylightAt(indexOf(plan), t);

export const sceneAt = (plan: ScenePlan, t: number): SceneState => {
  const ix = indexOf(plan);
  const { ranks, queue } = waitingAt(ix, t);
  const tubes: TubeState[] = [];
  for (let i = 0; i < plan.samples.length; i++) {
    const tube = tubeAt(plan, ix, i, t, ranks);
    if (tube) tubes.push(tube);
  }
  return {
    t,
    ...daylightAt(ix, t),
    vessels: plan.units.map((_, unit) => vesselAt(plan, ix, unit, t)),
    analyzers: plan.analyzers.map((_, a) => analyzerAt(plan, ix, a, t, queue)),
    staff: plan.staff.map((_, operator) => staffAt(plan, ix, operator, t)),
    tubes,
  };
};


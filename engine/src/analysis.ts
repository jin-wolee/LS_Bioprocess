import { PRIORITY, createEventQueue } from "./clock.ts";
import type { Event } from "./generated/event.schema";
import { SEP, createRng } from "./rng.ts";
import type { StreamKey } from "./rng.ts";

// L3 analysis core (spec section 2.3; contract in prompts/10 Step 1). Plain input objects in, truth log and runs out:
// no profile, scenario or ledger value is read here. No unplanned breakdown (no catalogue scenario needs it).
//
// Modelling choices recorded in docs/progress.md: no backfill (strict head of line); a run is checked against the windows of its
// analyzer over its whole occupancy [t, t + setup + service); a later visit or a rerun joins the queue by arrival time, then seq.

export type Outcome = "qc_passed" | "qc_failed" | "over_range";

export interface L3Visit {
  group: string;
  service_s: number;
  method_id?: string;
  transfer_s?: number;
  /** Not part of a trace. The analyte of the noise key; defaults to the group. */
  analyte?: string;
  /** Not part of a trace. Standard deviation of the measurement noise; 0 or absent draws none. */
  noise_sd?: number;
  /** Not part of a trace. Fixture-only truth value the noise is added to (default 0). */
  true_value?: number;
}
export interface L3Request {
  request_id: string;
  seq: number;
  arrive_s: number;
  /** Not part of a trace: lets hold_time and invariant I4 be computed from the output. */
  sampled_s?: number;
  deadline_s?: number;
  visits: L3Visit[];
}
export interface L3Window {
  analyzer: string;
  start_s: number;
  end_s: number;
  /** Not part of a trace. Names the logged events; default "qc". "closed" (hours outside the roster, A201) logs nothing. */
  kind?: "qc" | "maintenance" | "closed";
}
/** A trace plus the engine-only extras above and `dilution_factor` (a fixture-only input of the truth log). */
export interface L3Input {
  schema_version: "1";
  engine_version: string;
  seed: number;
  policy: "fifo" | "edf";
  analyzers: { id: string; group: string; initial_method: string | null }[];
  setup: { from_method: string; to_method: string; seconds: number }[];
  windows: L3Window[];
  requests: L3Request[];
  forced_outcomes: { request_id: string; attempt: number; visit: number; outcome: Outcome }[];
  dilution_factor?: number;
}
export interface L3Run {
  request_id: string;
  attempt: number;
  visit: number;
  analyzer: string;
  setup_s: number;
  start_s: number;
  end_s: number;
  outcome: Outcome;
}
export interface L3Output {
  /** The truth log, in time order; the first event is the log_header. */
  events: Event[];
  /** In order of completion; trace.ts sorts them for a trace_result. */
  runs: L3Run[];
}

/** What the core tells a measurement hook about the run that just ended. */
export interface MeasureContext {
  request: L3Request;
  visit: number;
  attempt: number;
  analyzer: string;
  start_s: number;
  end_s: number;
}
export interface MeasuredResult {
  analyte: string;
  value: number;
  true_value: number;
  noise: number;
  stability_kind?: "linear_rate" | "first_order_offset";
  stability_delta?: number;
  extrapolated?: true;
}
export interface Measurement {
  /** One result_measured is logged per entry, in order. */
  results: MeasuredResult[];
  /** Default qc_passed; a forced outcome of the input wins over it. */
  outcome?: Outcome;
  /** The dilution of the next attempt when the outcome is over_range (logged as dilution_applied). */
  next_dilution_factor?: number;
}
/** S1b: what a run measures and how it ends comes from the caller, so the core holds no profile, scenario or ledger value. */
export type MeasureFn = (ctx: MeasureContext) => Measurement;

interface Entry {
  request: L3Request;
  visit: number;
  attempt: number;
  arrival: number;
  seq: number;
}
interface Machine {
  id: string;
  group: string;
  loaded: string | null;
  busy: boolean;
  windows: L3Window[];
}
interface Active {
  entry: Entry;
  machine: Machine;
  setup: number;
  start: number;
}
type Payload = { kind: "arrive"; entry: Entry } | { kind: "finish"; run: Active } | { kind: "window"; w: L3Window; edge: "start" | "end" } | { kind: "dispatch" };

const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`L3 input: ${what}`);
};
const whole = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n >= 0;

const validate = (input: L3Input): void => {
  const ids = new Set(input.analyzers.map((a) => a.id));
  must(ids.size === input.analyzers.length, "analyzer ids must be unique");
  for (const w of input.windows) must(ids.has(w.analyzer) && whole(w.start_s) && whole(w.end_s) && w.start_s < w.end_s, `bad window ${JSON.stringify(w)}`);
  const groups = new Set(input.analyzers.map((a) => a.group));
  must(new Set(input.requests.map((r) => r.request_id)).size === input.requests.length, "request ids must be unique");
  must(new Set(input.requests.map((r) => r.seq)).size === input.requests.length, "request seq values must be unique");
  for (const r of input.requests) {
    must(whole(r.seq) && whole(r.arrive_s) && r.visits.length > 0, `bad request ${r.request_id}`);
    must(r.deadline_s === undefined || whole(r.deadline_s), `bad deadline of ${r.request_id}`);
    for (const v of r.visits) {
      must(groups.has(v.group), `request ${r.request_id} visits group ${v.group}, which has no analyzer`);
      must(whole(v.service_s) && v.service_s >= 1 && (v.transfer_s === undefined || whole(v.transfer_s)), `bad visit of ${r.request_id}`);
    }
  }
};

export const runL3 = (input: L3Input, opts: { onKey?: (key: StreamKey) => void; measure?: MeasureFn } = {}): L3Output => {
  validate(input);
  const rng = createRng(opts.onKey);
  const events: Event[] = [{ type: "log_header", t: 0, schema_version: "1", engine_version: input.engine_version, seed: input.seed }];
  const runs: L3Run[] = [];
  const machines: Machine[] = input.analyzers.map((a) => ({ id: a.id, group: a.group, loaded: a.initial_method, busy: false, windows: input.windows.filter((w) => w.analyzer === a.id) }));
  const queues = new Map<string, Entry[]>(input.analyzers.map((a) => [a.group, []]));
  const forced = new Map(input.forced_outcomes.map((f) => [`${f.request_id}#${f.attempt}#${f.visit}`, f.outcome]));
  const setupSeconds = new Map(input.setup.map((s) => [`${s.from_method}${SEP}${s.to_method}`, s.seconds]));
  const q = createEventQueue<Payload>();
  // Request seqs come from the input; every seq assigned from here on (events, reruns) is above all of them.
  let seq = input.requests.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
  let dispatchAt = -1;

  const visitOf = (e: Entry): L3Visit => e.request.visits[e.visit - 1] as L3Visit;
  const setupFor = (m: Machine, v: L3Visit): number => {
    if (v.method_id === undefined || m.loaded === null || m.loaded === v.method_id) return 0;
    const s = setupSeconds.get(`${m.loaded}${SEP}${v.method_id}`);
    must(s !== undefined, `no setup entry for ${m.loaded} -> ${v.method_id} on ${m.id}`);
    return s as number;
  };
  // Half-open: [from, from + duration) meets [start_s, end_s) iff from < end_s and start_s < from + duration.
  const clear = (m: Machine, from: number, duration: number): boolean => !m.windows.some((w) => from < w.end_s && w.start_s < from + duration);
  const earlier = (a: Entry, b: Entry): boolean => {
    if (input.policy === "edf") {
      const da = a.request.deadline_s ?? Infinity;
      const db = b.request.deadline_s ?? Infinity;
      if (da !== db) return da < db;
    }
    return a.arrival !== b.arrival ? a.arrival < b.arrival : a.seq < b.seq;
  };

  const start = (m: Machine, e: Entry, t: number): void => {
    const v = visitOf(e);
    const setup = setupFor(m, v);
    const begin = t + setup;
    const ids = { request_id: e.request.request_id, attempt: e.attempt, visit: e.visit, analyzer: m.id };
    m.busy = true;
    if (v.method_id !== undefined) m.loaded = v.method_id;
    events.push({ type: "visit_started", t, ...ids, setup_s: setup }, { type: "run_started", t: begin, ...ids });
    q.push(begin + v.service_s, PRIORITY.visitFinished, seq++, { kind: "finish", run: { entry: e, machine: m, setup, start: begin } });
  };

  const dispatch = (t: number): void => {
    for (const [group, queue] of queues) {
      while (queue.length > 0) {
        let head = 0;
        queue.forEach((e, i) => {
          if (earlier(e, queue[head] as Entry)) head = i;
        });
        const entry = queue[head] as Entry;
        const v = visitOf(entry);
        const m = machines.find((x) => x.group === group && !x.busy && clear(x, t, setupFor(x, v) + v.service_s));
        if (!m) break; // strict head of line: nothing behind the head may start
        queue.splice(head, 1);
        start(m, entry, t);
      }
    }
  };

  const finish = (t: number, run: Active): void => {
    const { entry: e, machine: m } = run;
    const v = visitOf(e);
    const ids = { request_id: e.request.request_id, attempt: e.attempt, visit: e.visit, analyzer: m.id };
    const meas = opts.measure?.({ request: e.request, visit: e.visit, attempt: e.attempt, analyzer: m.id, start_s: run.start, end_s: t });
    const outcome = forced.get(`${ids.request_id}#${e.attempt}#${e.visit}`) ?? meas?.outcome ?? "qc_passed";
    m.busy = false;
    if (meas) {
      for (const r of meas.results) events.push({ type: "result_measured", t, ...ids, ...r });
    } else {
      const analyte = v.analyte ?? v.group;
      const sd = v.noise_sd ?? 0;
      const noise = sd > 0 ? sd * rng.stream([input.seed, ids.request_id, analyte, e.attempt, "noise"]).gaussian() : 0;
      const truth = v.true_value ?? 0;
      events.push({ type: "result_measured", t, ...ids, analyte, value: truth + noise, true_value: truth, noise });
    }
    events.push({ type: "qc_result", t, ...ids, outcome }, { type: "visit_finished", t, ...ids });
    runs.push({ ...ids, setup_s: run.setup, start_s: run.start, end_s: t, outcome });
    if (outcome !== "qc_passed") {
      // The failed attempt stays in the log; the same physical sample re-enters as attempt + 1 with a new seq. Nothing is held.
      const again: Entry = { request: e.request, visit: e.visit, attempt: e.attempt + 1, arrival: t, seq: seq++ };
      events.push({ type: "rerun_requested", t, request_id: ids.request_id, attempt: e.attempt, visit: e.visit, reason: outcome });
      const dilution = meas ? meas.next_dilution_factor : input.dilution_factor;
      if (outcome === "over_range" && dilution !== undefined) {
        events.push({ type: "dilution_applied", t, request_id: ids.request_id, attempt: again.attempt, visit: e.visit, dilution_factor: dilution });
      }
      q.push(t, PRIORITY.requestQueued, again.seq, { kind: "arrive", entry: again });
    } else if (e.visit < e.request.visits.length) {
      const arrival = t + ((e.request.visits[e.visit] as L3Visit).transfer_s ?? 0);
      q.push(arrival, PRIORITY.requestQueued, e.request.seq, { kind: "arrive", entry: { request: e.request, visit: e.visit + 1, attempt: 1, arrival, seq: e.request.seq } });
    }
  };

  const wantDispatch = (t: number): void => {
    if (dispatchAt === t) return;
    dispatchAt = t;
    q.push(t, PRIORITY.dispatch, seq++, { kind: "dispatch" });
  };

  for (const r of input.requests) q.push(r.arrive_s, PRIORITY.requestQueued, r.seq, { kind: "arrive", entry: { request: r, visit: 1, attempt: 1, arrival: r.arrive_s, seq: r.seq } });
  for (const w of input.windows) {
    q.push(w.start_s, PRIORITY.capacityRemoved, seq++, { kind: "window", w, edge: "start" });
    q.push(w.end_s, PRIORITY.capacityRestored, seq++, { kind: "window", w, edge: "end" });
  }

  for (let ev = q.pop(); ev; ev = q.pop()) {
    const p = ev.payload;
    if (p.kind === "arrive") {
      const e = p.entry;
      (queues.get(visitOf(e).group) as Entry[]).push(e);
      events.push({ type: "request_queued", t: ev.t, request_id: e.request.request_id, attempt: e.attempt, visit: e.visit, group: visitOf(e).group, seq: e.seq });
      wantDispatch(ev.t);
    } else if (p.kind === "finish") {
      finish(ev.t, p.run);
      wantDispatch(ev.t);
    } else if (p.kind === "window") {
      const kind = p.w.kind === "maintenance" ? "maintenance" : "qc_window";
      if (p.w.kind !== "closed") events.push({ type: `${kind}_${p.edge === "start" ? "started" : "ended"}`, t: ev.t, analyzer: p.w.analyzer } as Event);
      if (p.edge === "end") wantDispatch(ev.t);
    } else {
      dispatchAt = -1;
      dispatch(ev.t);
    }
  }
  events.sort((a, b) => a.t - b.t); // stable: emission order breaks ties; run_started is emitted at dispatch with a later t
  return { events, runs };
};

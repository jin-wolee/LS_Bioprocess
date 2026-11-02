import type { Event } from "../generated/event.schema";
import type { BreakoutInput } from "../record/types.ts";
import type { ScenarioRun } from "../run.ts";

// What the evaluator knows of the truth world (it is allowed to: spec section 3, rule 2). Plain data, so a hand-built fixture and a real run
// enter the same way. The metrics read the truth log, this structure and the answer key; never a recorder's internals.

export type Phase = "before_shift" | "after_shift" | "harvested";

export interface TruthRequest {
  request_id: string;
  unit_id: string;
  batch_id: string;
  operator_id: string | null;
  /** The true draw time; null for a draw refused by the volume budget. */
  sampled_at: number | null;
  skipped: boolean;
}

export interface Truth {
  events: readonly Event[];
  /** All analysis requests: drawn samples and refused draws, in log order. */
  requests: readonly TruthRequest[];
  /** Visits on the route of each drawn request. */
  visits: Readonly<Record<string, number>>;
  /** The decision time of each drawn request (A050, A206): the first decision instant at or after the draw. */
  deadlines: Readonly<Record<string, number>>;
  /** The training status of each operator in the truth world (A072, A073). */
  operators: readonly { operator_id: string; qualified: boolean }[];
  analyzers: readonly string[];
  /** The analyzer profile of each instrument, by instrument id (ADR-0015, spec section 4.5.6); absent in a hand-built world, which then has no per-profile utilisation. */
  analyzer_profiles?: Readonly<Record<string, string>>;
  /** The topology of the break-out block (its lots and equipment items), present only on the break-out path: the universe of the extension metrics (spec 11.6, rule S10). Plain data from the assembly. */
  breakout?: BreakoutInput;
}

/** The sample id of a confirming sample is `<unit>-CONF` (spec 11.8.8 C5). A confirming sample is not an analysis request (rule S10): the section 8 metrics count routine requests only. */
const CONFIRMING_ID = /-CONF$/;

export const truthFrom = (events: readonly Event[], extras: Pick<Truth, "visits" | "deadlines" | "operators" | "analyzers" | "analyzer_profiles">): Truth => ({
  events,
  ...extras,
  requests: events.flatMap((e): TruthRequest[] =>
    e.type === "sample_drawn"
      ? [{ request_id: e.sample_id, unit_id: e.unit_id, batch_id: e.batch_id, operator_id: e.operator_id, sampled_at: e.t, skipped: false }]
      : e.type === "draw_skipped_volume_budget" && !CONFIRMING_ID.test(e.sample_id)
        ? [{ request_id: e.sample_id, unit_id: e.unit_id, batch_id: e.batch_id, operator_id: null, sampled_at: null, skipped: true }]
        : [],
  ),
});

export const truthFromRun = (run: Pick<ScenarioRun, "events" | "samples" | "operators" | "l3Input"> & Partial<Pick<ScenarioRun, "instrumentProfiles">>): Truth =>
  truthFrom(run.events, {
    visits: Object.fromEntries(run.l3Input.requests.map((r) => [r.request_id, r.visits.length])),
    deadlines: Object.fromEntries(run.samples.filter((s) => s.state !== "skipped").map((s) => [s.sample_id, s.deadline_s])),
    operators: run.operators,
    analyzers: run.l3Input.analyzers.map((a) => a.id),
    ...(run.instrumentProfiles && { analyzer_profiles: run.instrumentProfiles }),
  });

export interface RequestFacts {
  request: TruthRequest;
  /** The run of attempt 1, visit 1: the one hold_time is measured to. */
  first_run: { started_at: number; analyzer: string } | null;
  /** Every run by `attempt/visit`. */
  runs: Map<string, { started_at: number; analyzer: string }>;
  /**
   * The instant the result was released in the truth world: every visit of the route has a passed QC. No ingestion or review delay is modelled
   * (data_model section 5: without review `available_at` follows `ingested_at`), so it is the instant of the last passing QC result.
   */
  released_at: number | null;
  /** The process context at the true draw time, by the rule of data_model section 7: feeds of the batch at or before it, and the phase. */
  context: { feed_epoch: number; batch_phase: Phase } | null;
  reruns: number;
  /** The value of attempt 1 by analyte, as the instrument reported it (the first version); null for a run over range at the last dilution, which has no value (spec 2.3). */
  original: Map<string, number | null>;
  /**
   * The required items of the request (spec section 8, "Request-level metrics"): every analyte the truth log measured for it, with the visit that measures it and the number of
   * attempts the engine numbered for that visit and item (attempts count per visit). A visit of the route with no item here never ran.
   */
  items: Map<string, { visit: number; attempts: number }>;
}

export const factsOf = (truth: Truth): Map<string, RequestFacts> => {
  const out = new Map<string, RequestFacts>(
    truth.requests.map((request) => [request.request_id, { request, first_run: null, runs: new Map(), released_at: null, context: null, reruns: 0, original: new Map(), items: new Map() }]),
  );
  // a run over range at the last dilution reports no value; its qc_result follows its results at the same instant, so the log is read for it first
  const unresolved = new Set(truth.events.flatMap((e) => (e.type === "qc_result" && e.outcome === "over_range_unresolved" ? [`${e.request_id}/${e.attempt}/${e.visit}`] : [])));
  const passed = new Map<string, Map<number, number>>();
  const processEvents = truth.events.flatMap((e) => (e.type === "process_event" ? [e] : []));
  for (const e of truth.events) {
    if (e.type === "run_started") {
      const f = out.get(e.request_id);
      if (!f) continue;
      f.runs.set(`${e.attempt}/${e.visit}`, { started_at: e.t, analyzer: e.analyzer });
      if (e.attempt === 1 && e.visit === 1) f.first_run = { started_at: e.t, analyzer: e.analyzer };
    } else if (e.type === "qc_result" && e.outcome === "qc_passed") {
      const visits = passed.get(e.request_id) ?? new Map<number, number>();
      visits.set(e.visit, e.t);
      passed.set(e.request_id, visits);
    } else if (e.type === "rerun_requested") {
      const f = out.get(e.request_id);
      if (f) f.reruns += 1;
    } else if (e.type === "result_measured") {
      const f = out.get(e.request_id);
      if (!f) continue;
      if (e.attempt === 1) f.original.set(e.analyte, unresolved.has(`${e.request_id}/1/${e.visit}`) ? null : e.value);
      f.items.set(e.analyte, { visit: e.visit, attempts: Math.max(f.items.get(e.analyte)?.attempts ?? 1, e.attempt) });
    }
  }
  for (const f of out.values()) {
    const visits = passed.get(f.request.request_id);
    const need = truth.visits[f.request.request_id] ?? 1;
    if (visits && Array.from({ length: need }, (_, i) => visits.has(i + 1)).every(Boolean)) f.released_at = Math.max(...visits.values());
    const t = f.request.sampled_at;
    if (t === null) continue;
    const upTo = processEvents.filter((p) => p.unit_id === f.request.unit_id && p.batch_id === f.request.batch_id && p.t <= t);
    f.context = {
      feed_epoch: upTo.filter((p) => p.kind === "feed").length,
      batch_phase: upTo.some((p) => p.kind === "harvest") ? "harvested" : upTo.some((p) => p.kind === "temperature_shift") ? "after_shift" : "before_shift",
    };
  }
  return out;
};

/** The visit of a run id (`request/attempt/visit`). */
export const visitOfRun = (runId: string): number => Number(runId.split("/").at(-1));

/**
 * Whether a request has every required item of every visit of its route (spec section 8, "Request-level metrics"): each visit from 1 to the count of its route has at least one
 * item in the truth log, and `ok` holds for every item, given its analyte and its visit.
 */
export const everyItem = (truth: Truth, f: RequestFacts, ok: (analyte: string, visit: number) => boolean): boolean => {
  const items = [...f.items];
  const need = truth.visits[f.request.request_id] ?? 1;
  for (let v = 1; v <= need; v++) if (!items.some(([, it]) => it.visit === v)) return false;
  return items.every(([analyte, it]) => ok(analyte, it.visit));
};

/** The reagent lot of an analyzer at an instant: the lot of its latest calibration at or before it; null before the first. */
export const lotAt = (truth: Truth, analyzer: string, t: number): string | null => {
  let best: { t: number; lot: string } | null = null;
  for (const e of truth.events) if (e.type === "calibration_recorded" && e.analyzer === analyzer && e.t <= t && (best === null || e.t >= best.t)) best = { t: e.t, lot: e.lot_id };
  return best === null ? null : best.lot;
};

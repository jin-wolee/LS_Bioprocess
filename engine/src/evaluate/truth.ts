import type { Event } from "../generated/event.schema";
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
}

export const truthFrom = (events: readonly Event[], extras: Pick<Truth, "visits" | "deadlines" | "operators" | "analyzers" | "analyzer_profiles">): Truth => ({
  events,
  ...extras,
  requests: events.flatMap((e): TruthRequest[] =>
    e.type === "sample_drawn"
      ? [{ request_id: e.sample_id, unit_id: e.unit_id, batch_id: e.batch_id, operator_id: e.operator_id, sampled_at: e.t, skipped: false }]
      : e.type === "draw_skipped_volume_budget"
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
  /** The value of attempt 1 by analyte, as the instrument reported it (the first version). */
  original: Map<string, number>;
}

export const factsOf = (truth: Truth): Map<string, RequestFacts> => {
  const out = new Map<string, RequestFacts>(
    truth.requests.map((request) => [request.request_id, { request, first_run: null, runs: new Map(), released_at: null, context: null, reruns: 0, original: new Map() }]),
  );
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
    } else if (e.type === "result_measured" && e.attempt === 1) {
      out.get(e.request_id)?.original.set(e.analyte, e.value);
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

/** The reagent lot of an analyzer at an instant: the lot of its latest calibration at or before it; null before the first. */
export const lotAt = (truth: Truth, analyzer: string, t: number): string | null => {
  let best: { t: number; lot: string } | null = null;
  for (const e of truth.events) if (e.type === "calibration_recorded" && e.analyzer === analyzer && e.t <= t && (best === null || e.t >= best.t)) best = { t: e.t, lot: e.lot_id };
  return best === null ? null : best.lot;
};

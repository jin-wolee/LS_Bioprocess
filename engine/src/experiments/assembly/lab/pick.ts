import { factsOf, truthFromRun } from "../../../evaluate/truth.ts";
import type { ScenarioRun } from "../../../run.ts";

// 2026-10-30 S3e (docs/design/lab_ui.md section 5; single_sample_trace.md "How the sample was picked"): the pick rule of the single-sample trace, moved here from
// engine/tests/support/trace_sample.ts so that the lineage view can use it. It reads the truth log only (the assembly may, spec section 3, rule 2).

const eventsOf = <T extends ScenarioRun["events"][number]["type"]>(run: ScenarioRun, type: T): Extract<ScenarioRun["events"][number], { type: T }>[] =>
  run.events.filter((e): e is Extract<ScenarioRun["events"][number], { type: T }> => e.type === type);

export const PICK_RULE =
  "In SC3, the lowest sample_id (plain string order; the ids are zero-padded) whose interval [sampled_at, run.started_at] contains a feed of its own unit and batch. " +
  "run.started_at is the start of the first run of the request (attempt 1, visit 1), the instant hold_time is measured to (data_model section 5). Both ends count.";

export type Context = { feed_epoch: number; batch_phase: string };

export interface Picked {
  sample_id: string;
  unit_id: string;
  batch_id: string;
  sampled_at: number;
  arrived_at: number;
  run_started_at: number;
  measured_at: number;
  /** Feeds of the sample's batch with sampled_at <= t <= run_started_at. */
  feeds_in_interval: number[];
  feeds_of_batch: number[];
  context_at_draw: Context;
  context_at_measurement: Context;
}

/** The truth context of a batch at an instant: the feeds so far (the feed epoch) and the phase, counted as data_model section 7 defines them. */
export const contextAt = (run: ScenarioRun, unit_id: string, batch_id: string, t: number): Context => {
  const upTo = eventsOf(run, "process_event").filter((p) => p.unit_id === unit_id && p.batch_id === batch_id && p.t <= t);
  return { feed_epoch: upTo.filter((p) => p.kind === "feed").length, batch_phase: upTo.some((p) => p.kind === "harvest") ? "harvested" : upTo.some((p) => p.kind === "temperature_shift") ? "after_shift" : "before_shift" };
};

/** The ids of the samples the run drew, in plain string order (the ids are zero-padded). */
export const drawnSampleIds = (run: ScenarioRun): string[] => eventsOf(run, "sample_drawn").map((e) => e.sample_id).sort();

/** What truth says of any drawn sample (for a sample the reader picks): its unit, the instant it was drawn and the context at the draw; null for an id the run did not draw. */
export const sampleTruth = (run: ScenarioRun, sample_id: string): { sample_id: string; unit_id: string; sampled_at: number; context_at_draw: Context } | null => {
  const d = eventsOf(run, "sample_drawn").find((e) => e.sample_id === sample_id);
  return d ? { sample_id, unit_id: d.unit_id, sampled_at: d.t, context_at_draw: contextAt(run, d.unit_id, d.batch_id, d.t) } : null;
};

/** The sample by the rule above, from the truth log alone. No recorded output is read, so the pick cannot depend on what a recorder did. */
export const pickSample = (run: ScenarioRun): Picked => {
  const facts = factsOf(truthFromRun(run));
  const feeds = eventsOf(run, "process_event").filter((e) => e.kind === "feed");
  const received = new Map(eventsOf(run, "sample_received").map((e) => [e.sample_id, e.t]));
  const measured = new Map<string, number>();
  for (const e of eventsOf(run, "result_measured")) if (!measured.has(e.request_id) || e.t < (measured.get(e.request_id) as number)) measured.set(e.request_id, e.t);
  const candidates = eventsOf(run, "sample_drawn").flatMap((d) => {
    const started = facts.get(d.sample_id)?.first_run?.started_at;
    if (started === undefined) return [];
    const own = feeds.filter((f) => f.unit_id === d.unit_id && f.batch_id === d.batch_id).map((f) => f.t);
    const inside = own.filter((t) => t >= d.t && t <= started);
    return inside.length === 0 ? [] : [{ d, started, own, inside }];
  });
  candidates.sort((a, b) => (a.d.sample_id < b.d.sample_id ? -1 : a.d.sample_id > b.d.sample_id ? 1 : 0));
  const first = candidates[0];
  if (!first) throw new Error("no sample of SC3 has a feed in [sampled_at, run.started_at]");
  const { d, started, own, inside } = first;
  const at = (t: number): Context => contextAt(run, d.unit_id, d.batch_id, t);
  const m = measured.get(d.sample_id) as number;
  return {
    sample_id: d.sample_id, unit_id: d.unit_id, batch_id: d.batch_id, sampled_at: d.t, arrived_at: received.get(d.sample_id) as number, run_started_at: started, measured_at: m,
    feeds_in_interval: inside, feeds_of_batch: own, context_at_draw: at(d.t), context_at_measurement: at(m),
  };
};

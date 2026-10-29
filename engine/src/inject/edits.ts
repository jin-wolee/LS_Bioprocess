import type { ObservableEvent } from "../observe.ts";

// The stream edits of the injector. Each returns a new array (the input is never modified) and changes only the fields it names.

const withRequest = (e: ObservableEvent): e is ObservableEvent & { request_id: string } => "request_id" in e;

/** The sample-id text the operator typed at the analyzer is wrong: every analyzer-side event of the sample carries `asId`; the sample's own events keep the true id. */
export const relabel = (events: readonly ObservableEvent[], sampleId: string, asId: string): ObservableEvent[] =>
  events.map((e) => (withRequest(e) && e.request_id === sampleId ? ({ ...e, request_id: asId } as ObservableEvent) : e));

/** The label names another unit: the sample's planned and drawn events carry `toUnit`; the batch id of the stream is left as it was. */
export const rekey = (events: readonly ObservableEvent[], sampleId: string, toUnit: string): ObservableEvent[] =>
  events.map((e) => ((e.type === "sample_planned" || e.type === "sample_drawn") && e.sample_id === sampleId ? { ...e, unit_id: toUnit } : e));

/** The result file is sent again: each result event of the sample is followed by an identical copy. */
export const replay = (events: readonly ObservableEvent[], sampleId: string): ObservableEvent[] =>
  events.flatMap((e) => (e.type === "result_measured" && e.request_id === sampleId ? [e, { ...e }] : [e]));

const INSTRUMENT_STAMPED = new Set<ObservableEvent["type"]>(["visit_started", "run_started", "result_measured", "qc_result", "visit_finished"]);

/**
 * The clock of an analyzer runs `offsets[analyzer]` seconds ahead of the host: the events the instrument stamps move by that offset
 * (the queue, the sample and the process events do not), and the host's receipt time of each result is the stamp it had. The order of
 * the stream is kept: it is the order in which the host received the records.
 */
export const skewClocks = (events: readonly ObservableEvent[], offsets: Readonly<Record<string, number>>): { events: ObservableEvent[]; received_at: Record<string, number> } => {
  const received_at: Record<string, number> = {};
  const out = events.map((e): ObservableEvent => {
    if (!INSTRUMENT_STAMPED.has(e.type) || !("analyzer" in e)) return e;
    const offset = offsets[e.analyzer] ?? 0;
    if (offset === 0) return e;
    if (e.type === "result_measured") received_at[`${e.analyzer}/${e.request_id}/${e.attempt}/${e.visit}/${e.analyte}`] = e.t;
    return { ...e, t: e.t + offset };
  });
  return { events: out, received_at };
};

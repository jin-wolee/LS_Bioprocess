import type { ObservableEvent } from "../observe.ts";
import type { Architecture } from "./architecture.ts";
import { recordResults } from "./results.ts";
import { transit } from "./transitions.ts";
import type { Transition } from "./transitions.ts";
import type { AnalysisRequestRow, BatchRow, InstrumentStateRow, ProcessEventRow, QualificationInput, RecordedDataset, RecorderInput, RunRow, SampleRow } from "./types.ts";

// The recorder (spec section 3, rule 1; section 5): one generic function from the observable events, the observable sensor series and
// an architecture to a recorded dataset. It reads nothing else: the event and series types carry no hidden field (observe.ts) and
// engine/src/record/** may not import a truth module (eslint.config.js), so the truth world is out of reach by construction.
// Which flag changes which column is stated where the column is written; results and their four flags are in results.ts.
//
// S2a models no ingestion or review delay and no error: a row is stamped with the event it comes from, and an error enters as a change
// of the stream upstream (the injector, S2b), so the same stream under two architectures differs only by what each one keeps.

const stateIdOf = (analyzer: string, t: number): string => `${analyzer}@${t}`;

/** `log` (optional) collects the state transitions performed, for the data dictionary tests (S2d). */
export const record = (input: RecorderInput, config: Architecture, log?: Transition[]): RecordedDataset => {
  const flags = config.flags;
  const events: readonly ObservableEvent[] = input.events;

  const planned = new Map<string, number>();
  const label = new Map<string, string>();
  for (const e of events) {
    if (e.type === "sample_planned") planned.set(e.sample_id, e.t);
    else if (e.type === "label_bound") label.set(e.sample_id, e.method);
  }

  // instrument_state_snapshot: each calibration record opens a state that lasts until the next one of the same analyzer
  const calibrations = events.flatMap((e) => (e.type === "calibration_recorded" ? [e] : []));
  const states: InstrumentStateRow[] = calibrations.map((c) => ({
    instrument_state_id: stateIdOf(c.analyzer, c.t), instrument_id: c.analyzer, calibration_ref: `${c.analyzer}/cal@${c.t}`, reagent_lot: c.lot_id, valid_from: c.t,
    valid_to: calibrations.filter((n) => n.analyzer === c.analyzer && n.t > c.t).reduce<number | null>((min, n) => (min === null || n.t < min ? n.t : min), null),
  }));
  const stateAt = (analyzer: string, t: number): InstrumentStateRow | undefined =>
    states.filter((s) => s.instrument_id === analyzer && s.valid_from <= t).sort((a, b) => b.valid_from - a.valid_from)[0];

  // audit_trail: the qualification record of the sampler that was valid at the draw (valid_from <= t < valid_to)
  const qualifications: readonly QualificationInput[] = flags.audit_trail ? (input.qualifications ?? []) : [];
  const qualificationAt = (operator: string, t: number): string | null =>
    qualifications.find((q) => q.operator_id === operator && q.valid_from <= t && (q.valid_to === null || t < q.valid_to))?.qualification_id ?? null;

  const sample: SampleRow[] = [];
  const runs = new Map<string, RunRow>();
  const batch = new Map<string, BatchRow>();
  const process_event: ProcessEventRow[] = [];
  const requests = new Map<string, AnalysisRequestRow>();

  for (const e of events) {
    switch (e.type) {
      case "request_queued":
        if (!requests.has(e.request_id)) requests.set(e.request_id, { request_id: e.request_id, control_id: input.plan?.controls?.[e.request_id] ?? null });
        break;
      case "sample_drawn":
        sample.push({
          sample_id: e.sample_id, unit_id: e.unit_id,
          batch_id: flags.write_time_keys ? e.batch_id : null, // off: derived at read by a time join (batchOf in asof.ts); the unit comes from the label as carried
          keys_fixed_at_write: flags.write_time_keys,
          state: null,
          sampled_at: flags.two_clocks ? e.t : null,
          planned_at: flags.system_issued_id ? (planned.get(e.sample_id) ?? null) : null,
          operator_id: flags.audit_trail ? e.operator_id : null,
          qualification_id: flags.audit_trail ? qualificationAt(e.operator_id, e.t) : null,
          label_method: label.get(e.sample_id) ?? null,
          container: input.plan?.containers?.[e.sample_id] ?? null,
        });
        break;
      case "draw_skipped_volume_budget":
        // spec section 2.2: a skipped draw still counts in every denominator. Only a system that issued the label from a plan has a row to show; on paper nobody wrote anything.
        if (flags.system_issued_id) {
          sample.push({
            sample_id: e.sample_id, unit_id: e.unit_id, batch_id: flags.write_time_keys ? e.batch_id : null, keys_fixed_at_write: flags.write_time_keys,
            state: transit("sample", "planned", "skipped", "rule", log) as "skipped", // the volume budget (VR-016) refuses the draw: planned -> skipped, data_model section 6
            sampled_at: null, planned_at: planned.get(e.sample_id) ?? null, operator_id: null, qualification_id: null, label_method: null, container: null,
          });
        }
        break;
      case "run_started": {
        const link = flags.instrument_state_snapshot ? stateAt(e.analyzer, e.t) : undefined;
        runs.set(`${e.request_id}/${e.attempt}/${e.visit}`, {
          run_id: `${e.request_id}/${e.attempt}/${e.visit}`, request_id: e.request_id, attempt: e.attempt, visit: e.visit, analyzer_name: e.analyzer,
          instrument_id: link ? link.instrument_id : null, instrument_state_id: link ? link.instrument_state_id : null, started_at: e.t, ended_at: null, qc_outcome: null,
        });
        break;
      }
      case "qc_result": {
        // the QC outcome of a run is a run attribute no flag owns (data_model section 2, "QC outcome"; section 7, review step): every architecture holds it
        const run = runs.get(`${e.request_id}/${e.attempt}/${e.visit}`);
        if (run) run.qc_outcome = e.outcome;
        break;
      }
      case "visit_finished": {
        const run = runs.get(`${e.request_id}/${e.attempt}/${e.visit}`);
        if (run) run.ended_at = e.t;
        break;
      }
      case "inoculation":
        batch.set(e.batch_id, { batch_id: e.batch_id, unit_id: e.unit_id, inoculated_at: e.t, harvested_at: null });
        break;
      case "process_event": {
        process_event.push({
          event_id: `PE${process_event.length + 1}`, batch_id: e.batch_id, unit_id: e.unit_id, kind: e.kind, occurred_at: e.t, amount: e.amount ?? null, source: e.source, ingested_at: e.t,
        });
        const b = batch.get(e.batch_id);
        if (e.kind === "harvest" && b) b.harvested_at = e.t;
        break;
      }
      default:
        break;
    }
  }

  return {
    architecture: { id: config.id, flags: config.flags, labelling: config.labelling },
    ...(input.capture && { capture: { path: input.capture.path } }),
    sample,
    analysis_request: [...requests.values()],
    run: [...runs.values()],
    instrument_state: flags.instrument_state_snapshot ? states : [],
    qualification: qualifications.map((q) => ({ ...q })),
    ...recordResults(events, flags, input.received_at, input.capture),
    batch: [...batch.values()],
    process_event,
    // the series are copied field by field; with parsed controller logs (S2e2) the historian is the logged rows instead: what the controller wrote, as late as its files arrived
    historian: input.capture?.historian
      ? { series: [], late: [...input.capture.historian] }
      : { series: input.sensors.map(({ unit_id, signal, t0_s, cadence_s, n, pv }) => ({ unit_id, signal, t0_s, cadence_s, n, pv })), late: [] },
  };
};

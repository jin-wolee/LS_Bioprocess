import { ANALYTE_UNITS } from "../../src/export/columns.ts";
import type { Cell } from "../../src/export/csv.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import type { RecordedDataset } from "../../src/record/types.ts";

// Test-only: one recorded dataset as the canonical tables of the author's schema (data_model sections 2, 3 and 5; Card A names), for the integration checks of the acceptance tests
// of the author's SQL (tests/user_track/test_queries.py). Not shipped and not an export: the wide export of data_model section 10 has no historian rows or aliquots.
// Scenario seconds become timestamps from a synthetic anchor, Monday 2030-01-07 (the day of the fixtures of tests/fixtures/sql); it is a calendar anchor, not a seed. Only the released rows are loaded (state null or
// released): the card of the as-of join leaves the handling of a held row to the author, so the integration data does not ask the question.

const ANCHOR_MS = Date.UTC(2030, 0, 7);
export const iso = (s: number | null): string | null => (s === null ? null : new Date(ANCHOR_MS + s * 1000).toISOString().slice(0, 19).replace("T", " "));

export type Table = Record<string, Cell>[];

/** The tables by name; every row carries exactly the columns the acceptance tests insert (explicit column lists). */
export const canonicalTables = (ds: RecordedDataset, events: readonly ObservableEvent[]): Record<string, Table> => {
  const drawn = new Map(events.flatMap((e) => (e.type === "sample_drawn" ? [[e.sample_id, e] as const] : [])));
  const aliquots = new Map(events.flatMap((e) => (e.type === "aliquot_created" ? [[e.sample_id, e] as const] : [])));
  const aliquotOf = (sample: string): string => aliquots.get(sample)?.aliquot_id ?? `${sample}-A1`;
  const samples = ds.sample.filter((s) => s.state !== "skipped");
  const units = [...new Set([...samples.map((s) => s.unit_id), ...ds.batch.map((b) => b.unit_id)])].sort();
  const instruments = [...new Set([...ds.instrument_state.map((s) => s.instrument_id), ...ds.run.flatMap((r) => (r.instrument_id ? [r.instrument_id] : []))])].sort();
  const historian: Table = ds.historian.series.flatMap((x) =>
    Array.from({ length: x.n }, (_, j) => ({ tag: `${x.unit_id}.${x.signal}`, ts: iso(x.t0_s + j * x.cadence_s), value: x.pv[j] as number, ingested_at: iso(x.t0_s + j * x.cadence_s) })),
  );
  for (const r of ds.historian.late) historian.push({ tag: r.tag, ts: iso(r.ts), value: r.value, ingested_at: iso(r.ingested_at) });
  return {
    unit: units.map((u) => ({ unit_id: u, unit_tag: u })),
    operator: [...new Set(samples.flatMap((s) => (s.operator_id ? [s.operator_id] : [])))].sort().map((o) => ({ operator_id: o })),
    batch: ds.batch.map((b) => ({ batch_id: b.batch_id, unit_id: b.unit_id, inoculated_at: iso(b.inoculated_at), harvested_at: iso(b.harvested_at) })),
    method: [{ method_id: "M-1", version: 1 }],
    instrument: instruments.map((i) => ({ instrument_id: i })),
    instrument_state: ds.instrument_state.map((s) => ({ instrument_state_id: s.instrument_state_id, instrument_id: s.instrument_id, valid_from: iso(s.valid_from), reagent_lot: s.reagent_lot, calibration_ref: s.calibration_ref })),
    sample: samples.map((s) => ({ sample_id: s.sample_id, unit_id: s.unit_id, batch_id: s.batch_id, sampled_at: iso(s.sampled_at), operator_id: s.operator_id, volume_ul: drawn.get(s.sample_id)?.volume_ul ?? null, state: "closed" })),
    aliquot: samples.map((s) => ({ aliquot_id: aliquotOf(s.sample_id), sample_id: s.sample_id, volume_ul: aliquots.get(s.sample_id)?.volume_ul ?? null, state: "created" })),
    analysis_request: ds.analysis_request.filter((q) => samples.some((s) => s.sample_id === q.request_id)).map((q) => ({ request_id: q.request_id, aliquot_id: aliquotOf(q.request_id), method_id: "M-1", state: "requested", control_id: q.control_id })),
    run: ds.run.map((r) => ({ run_id: r.run_id, instrument_id: r.instrument_id, instrument_state_id: r.instrument_state_id, method_id: "M-1", started_at: iso(r.started_at), ended_at: iso(r.ended_at), operator_id: null })),
    result: ds.result.filter((r) => r.state === null || r.state === "released").map((r) => ({
      result_id: r.result_id, request_id: r.request_id, analyte: r.analyte, version: r.version, run_id: r.run_id, value: r.value, unit_ucum: ANALYTE_UNITS[r.analyte] ?? null,
      measured_at: iso(r.measured_at), ingested_at: iso(r.ingested_at), reviewed_at: iso(r.reviewed_at), available_at: iso(r.available_at), state: r.state,
    })),
    historian_value: historian,
  };
};

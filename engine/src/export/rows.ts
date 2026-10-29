import { batchOf, contextAsOf } from "../record/asof.ts";
import type { RecordedDataset, ResultRow } from "../record/types.ts";
import { ANALYTE_UNITS, EXPORT_FIELDS, SIGNALS } from "./columns.ts";
import type { Cell } from "./csv.ts";

// One row per (sample x analyte x released version) with the columns of data_model section 10. Built from a recorded dataset only (the reviewer's and the analyst's view): nothing
// here can reach the truth world, and a column the architecture does not store is null.

export interface RowOptions {
  /** The stated time of the process context: the as-of read of data_model section 5 uses what was known at this second. */
  context_as_of: number;
}

/** A released version: any result row that is not held, quarantined or rejected, as the as-of read of record/asof.ts treats it (state null, or released at review). */
const released = (r: ResultRow): boolean => r.state === null || r.state === "released";

export const exportRows = (ds: RecordedDataset, opts: RowOptions): Record<string, Cell>[] => {
  const samples = new Map(ds.sample.map((s) => [s.sample_id, s]));
  const runs = new Map(ds.run.map((x) => [x.run_id, x]));
  const states = new Map(ds.instrument_state.map((x) => [x.instrument_state_id, x]));
  const rows = ds.result.filter(released).map((r): Record<string, Cell> => {
    const unit = ANALYTE_UNITS[r.analyte];
    if (unit === undefined) throw new Error(`export: no canonical unit for analyte ${r.analyte} (data_model section 9: a conversion that is not defined is a finding, not a guess)`);
    const sample = samples.get(r.request_id);
    const run = runs.get(r.run_id);
    const state = run?.instrument_state_id ? states.get(run.instrument_state_id) : undefined;
    const ctx = contextAsOf(ds, r, opts.context_as_of);
    const sampledAt = sample?.sampled_at ?? null;
    return {
      sample_id: r.request_id, unit_id: sample?.unit_id ?? null, batch_id: batchOf(ds, r), analyte: r.analyte, version: r.version, value: r.value, canonical_unit: unit,
      sampled_at: sampledAt, measured_at: r.measured_at,
      // hold_time = run.started_at - sampled_at (data_model section 5), to the run of this version, as VR-010 reads it; turnaround = available_at - sampled_at
      hold_time: sampledAt !== null && run ? run.started_at - sampledAt : null,
      turnaround: sampledAt !== null && r.available_at !== null ? r.available_at - sampledAt : null,
      calibration_ref: state?.calibration_ref ?? null, reagent_lot: state?.reagent_lot ?? null,
      method_version: null, // no method entity is recorded in S2
      operator_id: sample?.operator_id ?? null, qualification_id: sample?.qualification_id ?? null,
      ctx_join_basis: ctx?.join_basis ?? null, ctx_join_time: ctx?.join_time ?? null, ctx_feed_epoch: ctx?.feed_epoch ?? null, ctx_batch_phase: ctx?.batch_phase ?? null,
      ...Object.fromEntries(SIGNALS.map((sig) => [`ctx_pv_${sig}`, ctx?.pv[sig] ?? null])),
      available_at: r.available_at, context_as_of: opts.context_as_of,
    };
  });
  const names = new Set(EXPORT_FIELDS.map((x) => x.name));
  for (const row of rows) for (const k of Object.keys(row)) if (!names.has(k)) throw new Error(`export: column ${k} is not in the export schema`);
  const key = (row: Record<string, Cell>): [string, string, number] => [String(row.sample_id), String(row.analyte), Number(row.version)];
  return rows.sort((a, b) => {
    const [as, aa, av] = key(a);
    const [bs, ba, bv] = key(b);
    return as < bs ? -1 : as > bs ? 1 : aa < ba ? -1 : aa > ba ? 1 : av - bv;
  });
};

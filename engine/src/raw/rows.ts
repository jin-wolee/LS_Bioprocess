import type { ObservableEvent } from "../observe.ts";
import type { AnalysisRow, Dialect } from "./types.ts";

// From observable events to the analysis rows of one dialect. The emitter reads observable data only (spec section 2.4.1, rule 1).

/** What the assembly knows of the analyzer profile: which dialect writes each visit of the route, its analytes, its nominal run time (A023, A025, A028) and the default dilution (A090). */
export interface RowSpec {
  dialect: Dialect;
  visit_dialects: readonly string[];
  visit_analytes: readonly (readonly string[])[];
  visit_run_s: readonly number[];
  default_dilution: number | null;
}

type Measured = Extract<ObservableEvent, { type: "result_measured" }>;

/** One row per (instrument, request, attempt, visit) of this dialect, in the order of the stream. The analytes written are those of the visit that the dialect has a column for. */
export const analysisRows = (events: readonly ObservableEvent[], spec: RowSpec): AnalysisRow[] => {
  const dilutions = new Map<string, number>();
  for (const e of events) if (e.type === "dilution_applied") dilutions.set(`${e.request_id}/${e.attempt}/${e.visit}`, e.dilution_factor);
  const columns = new Set(spec.dialect.columns.filter((c) => c.kind === "value").map((c) => c.analyte));
  const groups = new Map<string, { first: Measured; values: { analyte: string; value: number }[] }>();
  for (const e of events) {
    if (e.type !== "result_measured" || spec.visit_dialects[e.visit - 1] !== spec.dialect.dialect_id) continue;
    if (!columns.has(e.analyte) || !(spec.visit_analytes[e.visit - 1] ?? []).includes(e.analyte)) continue;
    const key = `${e.analyzer}|${e.request_id}|${e.attempt}|${e.visit}`;
    const g = groups.get(key) ?? { first: e, values: [] };
    g.values.push({ analyte: e.analyte, value: e.value });
    groups.set(key, g);
  }
  return [...groups.values()].map(({ first: e, values }) => {
    const stamp_s = spec.dialect.stamp.means === "start" ? e.t - (spec.visit_run_s[e.visit - 1] as number) : e.t;
    const injection = spec.dialect.grain === "injection" ? { injection_id: `INJ-${e.request_id}-${e.attempt}`, result_id: `RES-${e.request_id}-${e.attempt}-1` } : {};
    return {
      instrument: e.analyzer, sample_id: e.request_id, t_s: e.t, stamp_s, sample_time_s: stamp_s,
      dilution: dilutions.get(`${e.request_id}/${e.attempt}/${e.visit}`) ?? spec.default_dilution, values,
      ...injection, src: { request_id: e.request_id, attempt: e.attempt, visit: e.visit },
    };
  });
};

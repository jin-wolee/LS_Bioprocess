import { batchOf, sampleById } from "../../../record/asof.ts";
import { hasValue } from "../../../record/types.ts";
import type { RecordedDataset, ResultRow, RunRow } from "../../../record/types.ts";
import { requestOfTarget } from "../../../record/validate.ts";
import { flagsOn } from "./record_view.ts";

// The record halls of the scene plan (docs/design/plant_ui.md section 3.3): one wall per architecture, a card for each sample the record holds anything of. A card is the three questions of the
// lineage view made an object: the unit, `sampled_at`, the process context (with the basis of its join) and the result. A slot says whether the record stores the field; the number of a result
// is not in the plan (the record panel reads it through `plant_record`), and a record never marks a card wrong, because wrong needs truth.
//
// When a card appears: the sample row of every architecture carries no write stamp (`SampleRow` has none), so the earliest instant the record holds anything of a sample is the first of its
// run rows (`started_at`, stamped by the event `run_started` in every architecture) and its result rows (`ingested_at` where the system stores it, otherwise `measured_at`). That instant is
// `shown_s`. The card turns knowable at `available_s`, the earliest `available_at` where the architecture stores it, and is null where it does not.

export interface PlanSlot {
  name: "unit" | "sampled_at" | "context" | "value";
  stored: boolean;
  /** The stored time the process context is joined on; present only on a stored context slot. */
  basis?: "sampled_at" | "measured_at";
}

export interface PlanCard {
  /** Index into the plan's `samples`. */
  sample: number;
  shown_s: number;
  available_s: number | null;
  slots: PlanSlot[];
  /** The rule ids of the record's own validation findings on the sample, sorted. */
  findings: string[];
  /** The highest version of any result of the sample: 1 where the record keeps one row per result, more where `append_only_versions` stacks them; 0 with no result. */
  versions: number;
}

export interface PlanRecord {
  architecture: string;
  flags_on: string[];
  cards: PlanCard[];
}

const groupBy = <T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> => {
  const by = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k !== null) by.set(k, [...(by.get(k) ?? []), row]);
  }
  return by;
};

const cardOf = (ds: RecordedDataset, index: number, id: string, runs: readonly RunRow[], results: readonly ResultRow[], rules: readonly string[]): PlanCard | null => {
  const stamps = [...runs.map((r) => r.started_at), ...results.map((r) => r.ingested_at ?? r.measured_at)];
  if (stamps.length === 0) return null;
  const sample = sampleById(ds).get(id);
  const first = results[0];
  const available = results.flatMap((r) => (r.available_at === null ? [] : [r.available_at]));
  const context = sample !== undefined && first !== undefined && batchOf(ds, first) !== null;
  return {
    sample: index,
    shown_s: Math.min(...stamps),
    available_s: available.length === 0 ? null : Math.min(...available),
    slots: [
      { name: "unit", stored: sample !== undefined },
      { name: "sampled_at", stored: sample?.sampled_at != null },
      context ? { name: "context", stored: true, basis: sample?.sampled_at == null ? "measured_at" : "sampled_at" } : { name: "context", stored: false },
      { name: "value", stored: results.some(hasValue) },
    ],
    findings: [...rules].sort(),
    versions: Math.max(0, ...results.map((r) => r.version)),
  };
};

/** The halls of the plan: for each dataset, in the order given, the cards of the samples `sampleIds` lists (the order of the plan's `samples`). */
export const recordsOf = (datasets: readonly RecordedDataset[], sampleIds: readonly string[]): PlanRecord[] =>
  datasets.map((ds) => {
    const runs = groupBy(ds.run, (r) => r.request_id);
    const results = groupBy(ds.result, (r) => r.request_id);
    const rules = groupBy(ds.validation_finding, (f) => requestOfTarget(ds, f.target));
    const cards = sampleIds.flatMap((id, i) => {
      const card = cardOf(ds, i, id, runs.get(id) ?? [], results.get(id) ?? [], [...new Set((rules.get(id) ?? []).map((f) => f.rule))]);
      return card ? [card] : [];
    });
    return { architecture: ds.architecture.id, flags_on: flagsOn(ds), cards };
  });

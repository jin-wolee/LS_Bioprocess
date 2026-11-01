import { batchOf, resultsAsOf, sampleById } from "../../../record/asof.ts";
import { hasValue } from "../../../record/types.ts";
import type { RecordedDataset, ResultRow, RunRow, ValidationFindingRow } from "../../../record/types.ts";
import { requestOfTarget } from "../../../record/validate.ts";
import { flagsOn } from "./record_view.ts";

// The record halls of the scene plan (docs/design/plant_ui.md section 3.3): one wall per architecture, a card for each sample the record holds anything of. A card is the three questions of the
// lineage view made an object: the unit, `sampled_at`, the process context (with the basis of its join) and the result. A slot says whether the record stores the field; the number of a result
// is not in the plan (the record panel reads it through `plant_record`), and a record never marks a card wrong, because wrong needs truth.
//
// When a card appears: the sample row of every architecture carries no write stamp (`SampleRow` has none), so the earliest instant the record holds anything of a sample is the first of its
// run rows (`started_at`, stamped by the event `run_started` in every architecture) and its result rows (`ingested_at` where the system stores it, otherwise `measured_at`). That instant is
// `shown_s`. The card turns knowable at `available_s`, the earliest `available_at` where the architecture stores it, and is null where it does not.
//
// Two more instants, from the record's own stamps only (P5a). A result row is written at its stamp (`ingested_at` where stored, else `measured_at`), so version k of the sample's results exists
// from the earliest stamp of a row of version k or later (`version_s`, one instant for each version: the length is the depth of the stack where `append_only_versions` keeps them, and the
// overwrite in place of an architecture that does not shows one version). A validation finding carries no stamp of its own; a rule reads a row as the record writes it, so the finding is raised
// at the stamp of the result row it targets, and at `shown_s` for a target that is the sample or a source event (no row of the sample is older).
//
// The context slot is stored when the record offers a result to join a process context to (the lineage view's `recordContext`: the first result `resultsAsOf` returns, which leaves out a
// rejected row), so the card and the record panel agree on it.

export interface PlanSlot {
  name: "unit" | "sampled_at" | "context" | "value";
  stored: boolean;
  /** The stored time the process context is joined on; present only on a stored context slot. */
  basis?: "sampled_at" | "measured_at";
}

export interface PlanFinding {
  rule: string;
  /** The stamp of the result row the finding targets (or `shown_s` for a target that is no result): the instant the record's own rule raised it. */
  raised_s: number;
}

export interface PlanCard {
  /** Index into the plan's `samples`. */
  sample: number;
  shown_s: number;
  available_s: number | null;
  slots: PlanSlot[];
  /** The record's own validation findings on the sample, one for each rule id (the earliest instant of that rule), sorted by rule. */
  findings: PlanFinding[];
  /** The instant each version of the sample's results was first written, by version (1 first); empty with no result. Where `append_only_versions` stacks versions its length is the highest version. */
  version_s: number[];
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

/** The instant the record wrote a result row. */
const stampOf = (r: ResultRow): number => r.ingested_at ?? r.measured_at;

/** For each version k from 1 to the highest, the earliest stamp of a row of version k or later (never empty: the row of the highest version qualifies). */
const versionStamps = (results: readonly ResultRow[]): number[] => {
  const highest = Math.max(0, ...results.map((r) => r.version));
  return Array.from({ length: highest }, (_, k) => Math.min(...results.filter((r) => r.version >= k + 1).map(stampOf)));
};

const cardOf = (ds: RecordedDataset, index: number, id: string, runs: readonly RunRow[], results: readonly ResultRow[], offered: ResultRow | undefined, found: readonly ValidationFindingRow[], stamps: ReadonlyMap<string, number>): PlanCard | null => {
  const written = [...runs.map((r) => r.started_at), ...results.map(stampOf)];
  if (written.length === 0) return null;
  const shown_s = Math.min(...written);
  const sample = sampleById(ds).get(id);
  const available = results.flatMap((r) => (r.available_at === null ? [] : [r.available_at]));
  const context = sample !== undefined && offered !== undefined && batchOf(ds, offered) !== null;
  const raised = new Map<string, number>();
  for (const f of found) {
    const [kind, key] = f.target.split(":", 2);
    const at = Math.max(shown_s, kind === "result" ? (stamps.get(key as string) ?? shown_s) : shown_s);
    raised.set(f.rule, Math.min(at, raised.get(f.rule) ?? at));
  }
  return {
    sample: index,
    shown_s,
    available_s: available.length === 0 ? null : Math.min(...available),
    slots: [
      { name: "unit", stored: sample !== undefined },
      { name: "sampled_at", stored: sample?.sampled_at != null },
      context ? { name: "context", stored: true, basis: sample?.sampled_at == null ? "measured_at" : "sampled_at" } : { name: "context", stored: false },
      { name: "value", stored: results.some(hasValue) },
    ],
    findings: [...raised.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rule, raised_s]) => ({ rule, raised_s })),
    version_s: versionStamps(results),
  };
};

/** The halls of the plan: for each dataset, in the order given, the cards of the samples `sampleIds` lists (the order of the plan's `samples`). */
export const recordsOf = (datasets: readonly RecordedDataset[], sampleIds: readonly string[]): PlanRecord[] =>
  datasets.map((ds) => {
    const runs = groupBy(ds.run, (r) => r.request_id);
    const results = groupBy(ds.result, (r) => r.request_id);
    const offered = groupBy(resultsAsOf(ds, Number.MAX_SAFE_INTEGER), (r) => r.request_id);
    const found = groupBy(ds.validation_finding, (f) => requestOfTarget(ds, f.target));
    const stamps = new Map(ds.result.map((r) => [r.result_id, stampOf(r)]));
    const cards = sampleIds.flatMap((id, i) => {
      const card = cardOf(ds, i, id, runs.get(id) ?? [], results.get(id) ?? [], offered.get(id)?.[0], found.get(id) ?? [], stamps);
      return card ? [card] : [];
    });
    return { architecture: ds.architecture.id, flags_on: flagsOn(ds), cards };
  });

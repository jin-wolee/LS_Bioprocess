import { createRng } from "../rng.ts";
import type { Rng } from "../rng.ts";
import type { AnalysisRow } from "./types.ts";

// Raw quirk opportunities (spec section 2.4.1, rule 4; section 5, "Capture path", rule 5): drawn once per row or file from the canonical key tuple with
// purpose `raw:<quirk id>`; a file-level draw puts the export id where the sample goes. They know neither the architecture nor the capture path nor detection, so the
// same draws exist on both paths and in every architecture. The path and the plan only decide which of them materialise.

export interface RawOpportunity {
  /** `raw:RQ4` or `error:<type>`. */
  purpose: string;
  /** The sample (with attempt and visit) or the export the draw is keyed by. */
  id: string;
  /** Uniform in [0, 1). */
  u: number;
}

// The physical sample behind a result event (invariant 2; spec section 5, "Capture path", rule 5; S2f F2). The label text of an event is what the operator typed, and a label error moves
// it to another tube; the truth-side draws are keyed by the physical sample. The raw and inject layers must not import truth, so the assembly (which holds the stream before and after the
// injector) maps every result event of the stream to its physical sample and hands that map in as plain data; the draws below are keyed by it, never by the label.

/** The physical sample id of each result event of a stream, by `resultKey`. */
export type PhysicalIds = Readonly<Record<string, string>>;

interface ResultKeyed {
  analyzer: string;
  request_id: string;
  attempt: number;
  visit: number;
  analyte: string;
  t: number;
}

/** The key of one result event as the stream carries it: analyzer, label text, attempt, visit, analyte and instant. Two events of one stream share it only when one is the replayed copy of the other. */
export const resultKey = (e: ResultKeyed): string => `${e.analyzer}/${e.request_id}/${e.attempt}/${e.visit}/${e.analyte}/${e.t}`;

/** The physical sample of a result event. A missing entry is a wiring fault of the assembly, never a reason to fall back to the label (that is the defect this map exists to prevent). */
export const physicalOf = (physical: PhysicalIds, e: ResultKeyed): string => {
  const id = physical[resultKey(e)];
  if (id === undefined) throw new Error(`raw layer: the assembly gave no physical sample id for the result ${resultKey(e)}`);
  return id;
};

/** The slot of the analyte in the key holds the visit, so the rows of one sample on two visits draw apart. */
const visitSlot = (row: Pick<AnalysisRow, "src">): string => `v${row.src.visit}`;

/** RQ4, row level: is this row repeated by an overlapping export? Key (seed, physical sample, visit, attempt, "raw:RQ4"); the label text never enters (S2f F2, invariant 2). */
export const overlapDraw = (seed: number, row: Pick<AnalysisRow, "physical_id" | "src">, rng: Rng = createRng()): RawOpportunity => ({
  purpose: "raw:RQ4", id: `${row.physical_id}/${row.src.attempt}/${row.src.visit}`, u: rng.stream([seed, row.physical_id, visitSlot(row), row.src.attempt, "raw:RQ4"]).float(),
});

/** RQ4, file level: is the file dropped twice by a transfer retry? Key (seed, export id, "-", 0, "raw:RQ4"). */
export const replayDraw = (seed: number, exportId: string, rng: Rng = createRng()): RawOpportunity => ({
  purpose: "raw:RQ4", id: exportId, u: rng.stream([seed, exportId, "-", 0, "raw:RQ4"]).float(),
});

/** The entry-error draw of the manual path: one per result row, key (seed, physical sample, analyte, attempt, "error:result_entry"). Drawn on both paths; the label text never enters (S2f F2). */
export const entryDraw = (seed: number, physicalSample: string, analyte: string, attempt: number, rng: Rng = createRng()): RawOpportunity => ({
  purpose: "error:result_entry", id: `${physicalSample}/${analyte}/${attempt}`, u: rng.stream([seed, physicalSample, analyte, attempt, "error:result_entry"]).float(),
});

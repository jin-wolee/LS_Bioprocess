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

/** The slot of the analyte in the key holds the visit, so the rows of one sample on two visits draw apart. */
const visitSlot = (row: Pick<AnalysisRow, "src">): string => `v${row.src.visit}`;

/** RQ4, row level: is this row repeated by an overlapping export? Key (seed, sample, visit, attempt, "raw:RQ4"). */
export const overlapDraw = (seed: number, row: Pick<AnalysisRow, "sample_id" | "src">, rng: Rng = createRng()): RawOpportunity => ({
  purpose: "raw:RQ4", id: `${row.sample_id}/${row.src.attempt}/${row.src.visit}`, u: rng.stream([seed, row.sample_id, visitSlot(row), row.src.attempt, "raw:RQ4"]).float(),
});

/** RQ4, file level: is the file dropped twice by a transfer retry? Key (seed, export id, "-", 0, "raw:RQ4"). */
export const replayDraw = (seed: number, exportId: string, rng: Rng = createRng()): RawOpportunity => ({
  purpose: "raw:RQ4", id: exportId, u: rng.stream([seed, exportId, "-", 0, "raw:RQ4"]).float(),
});

/** The entry-error draw of the manual path: one per result row, key (seed, sample, analyte, attempt, "error:result_entry"). Drawn on both paths. */
export const entryDraw = (seed: number, sample: string, analyte: string, attempt: number, rng: Rng = createRng()): RawOpportunity => ({
  purpose: "error:result_entry", id: `${sample}/${analyte}/${attempt}`, u: rng.stream([seed, sample, analyte, attempt, "error:result_entry"]).float(),
});

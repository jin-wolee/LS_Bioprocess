import type { ForcedError, MaterialisedError } from "../../../inject/types.ts";
import { requestOfTarget } from "../../../record/validate.ts";
import type { RecordedDataset } from "../../../record/types.ts";

// 2026-10-30 S3e (docs/design/lab_ui.md section 5, the row "outcomeOf"): the classification of one forced-error cell, moved here from engine/tests/support/cells.ts. What happened to an error in
// one configuration: it never arose (prevented), a named piece of evidence shows it in the record (detected), or nothing does (invisible). The hand-typed expected cells stay in the tests
// (engine/tests/support/cell_tables.ts) and are the oracle of this module.

export type Cell = "prevented" | "invisible" | `detected:${string}`;

/** The cell of a configuration: not realised is prevented; realised with no evidence is invisible; otherwise detected, with the evidence names joined by `+`. */
export const cellOf = (realised: boolean, evidence: () => string[]): Cell => {
  if (!realised) return "prevented";
  const found = evidence();
  return found.length === 0 ? "invisible" : `detected:${found.join("+")}`;
};

/** Did the injector put an error of this type on this sample into the key? */
export const inKey = (out: { materialised: readonly MaterialisedError[] }, type: string, sample: string): boolean => out.materialised.some((m) => m.type === type && m.sample_id === sample);

/** The rule ids (sorted, once each) of the findings that are not no-ops, of the given rules, on any of the given requests. */
export const ruleFlags = (ds: RecordedDataset, rules: readonly string[], requests: readonly string[]): string[] => [
  ...new Set(ds.validation_finding.filter((f) => f.action !== "no-op" && rules.includes(f.rule) && requests.includes(requestOfTarget(ds, f.target) ?? "")).map((f) => f.rule)),
].sort();

export interface Outcome {
  outcome: "prevented" | "invisible" | "detected";
  /** The rule ids that show the error in the record (sorted, once each); empty unless detected. */
  evidence: string[];
}

/**
 * The rules whose findings on the affected requests show a planted error of each drawn type (the evidence of the hand-built rows of engine/tests/support/cell_rows_a.ts): the double-label and
 * registry checks for a label error, the unit-versus-batch check for a re-key, the duplicate-file check for a replay.
 */
const EVIDENCE: Record<ForcedError["type"], readonly string[]> = {
  label_error: ["VR-009", "VR-014"],
  unit_rekey: ["VR-020"],
  duplicate_replay: ["VR-008b"],
};

/** The requests a planted error touches: the sample, and for a label error the id its results were recorded under. */
export const affectedOf = (planted: ForcedError): string[] => (planted.type === "label_error" && planted.detail?.as_id ? [planted.sample_id, planted.detail.as_id] : [planted.sample_id]);

/**
 * What happened to a planted error in one architecture's record: it never arose (the injector's realised list of that architecture lacks it), the record's own rules name it, or nothing does.
 * It reads the injector's plain list and the recorded dataset, never the answer key or the truth log.
 */
export const outcomeOf = (planted: ForcedError, ds: RecordedDataset, materialised: readonly MaterialisedError[]): Outcome => {
  const cell = cellOf(inKey({ materialised }, planted.type, planted.sample_id), () => ruleFlags(ds, EVIDENCE[planted.type], affectedOf(planted)));
  return cell.startsWith("detected:") ? { outcome: "detected", evidence: cell.slice("detected:".length).split("+") } : { outcome: cell as "prevented" | "invisible", evidence: [] };
};

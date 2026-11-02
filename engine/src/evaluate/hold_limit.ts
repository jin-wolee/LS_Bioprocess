import type { Metrics } from "../generated/metrics.schema";
import type { RecordedDataset } from "../record/types.ts";
import { parseKey, recordedId } from "./answer_key.ts";
import { availability } from "./availability.ts";
import { lookupAll } from "./query.ts";
import { ALL_REQUESTS, ratio } from "./ratio.ts";
import type { Ratio } from "./ratio.ts";
import { exactReconstruction } from "./reconstruction.ts";
import { factsOf } from "./truth.ts";
import type { Truth } from "./truth.ts";

// The hold-time rule's share of the result (spec section 8, "The hold-time rule and its share of the result"; audit A1, finding F9). VR-010 rejects, at review, every result whose sample waited
// longer than the limit of A046 (a blood-gas proxy applied to every analyte, A213). This is a sensitivity of the report, beside the per-cell metrics and not inside them: how many requests the
// rule rejected, and what exact reconstruction and availability would be if those were not counted as failures. Reported, never gated.

export const HOLD_RULE = "VR-010";

export interface HoldLimit {
  /** Requests with a result row that VR-010 flagged and the review rejected. */
  rejected: Ratio;
  /** The exact reconstruction rate of the same record with the hold-time limit lifted. */
  exact_reconstruction_limit_lifted: Ratio;
  /** The availability (the share available) of the same record with the limit lifted. */
  availability_limit_lifted: Ratio;
}

export interface HoldLimitInput {
  truth: Truth;
  /** The recorded dataset after the validation and the review. */
  dataset: RecordedDataset;
  /** The cell of the same dataset, for the figures as they are (read when the rule rejected nothing). */
  cell: Metrics;
  key_text: string;
  architecture: string;
  /** The dataset after a second validation and review with no hold-time limit; asked only when the rule rejected a request. */
  lifted: () => RecordedDataset;
}

/** The ids, as the record holds them, of the requests with a result row that VR-010 flagged and the review rejected. */
const rejectedBy = (ds: RecordedDataset): Set<string> => {
  const flagged = new Set(ds.validation_finding.filter((f) => f.rule === HOLD_RULE).map((f) => f.target));
  return new Set(ds.result.filter((r) => r.state === "rejected" && flagged.has(`result:${r.result_id}`)).map((r) => r.request_id));
};

/** Every denominator is all analysis requests (spec section 8, anti-gaming rule 1); the wording says what was counted. */
export const holdLimit = (input: HoldLimitInput): HoldLimit => {
  const { truth, dataset, cell } = input;
  const key = parseKey(input.key_text, input.architecture);
  const ids = rejectedBy(dataset);
  const rejected = truth.requests.filter((r) => ids.has(recordedId(key, r.request_id))).length;
  const lifted = `${ALL_REQUESTS}; the hold-time limit lifted (${HOLD_RULE} raises no finding)`;
  const figures = (() => {
    if (rejected === 0) return { exact: cell.metrics.exact_reconstruction, available: cell.metrics.availability.available };
    const ds = input.lifted();
    const facts = factsOf(truth);
    return { exact: exactReconstruction(truth, facts, lookupAll(truth, ds, key)), available: availability(truth, facts, ds, key).available };
  })();
  return {
    rejected: ratio(rejected, truth.requests.length, `${ALL_REQUESTS}; a request with a result row that the hold-time rule (${HOLD_RULE}) flagged and the review rejected`),
    exact_reconstruction_limit_lifted: ratio(figures.exact.num, figures.exact.den, lifted),
    availability_limit_lifted: ratio(figures.available.num, figures.available.den, lifted),
  };
};

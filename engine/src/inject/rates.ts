import { param } from "../profiles.ts";
import type { Params } from "../profiles.ts";
import type { DrawnType } from "./types.ts";

// Materialisation rates come from profile and scenario parameters with ledger refs; the injector holds no domain number (invariant 3).

/**
 * Probability of a label error per sample for a sampler of this staff profile: the base rate per 1000 samples (A047) times the profile's
 * multiplier where it has one (the trainee, A062). The experienced profile has no multiplier, which reads as 1.
 */
export const labelErrorRate = (staff: Params): number => {
  const base = param(staff, "label_error_per_1000", "per 1000") / 1000;
  return staff.label_error_multiplier ? base * param(staff, "label_error_multiplier", "factor") : base;
};

/** Drawn types with no ledger rate (spec section 2.4.8 lists no entry): not modelled in production, built for forced mode only. */
export const RATE_GAPS: Record<Exclude<DrawnType, "label_error">, string> = {
  unit_rekey: "no ledger entry for the rate at which a sample is re-keyed to another unit",
  duplicate_replay: "no ledger entry for the rate at which a result file is replayed",
};

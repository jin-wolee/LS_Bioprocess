import { param } from "../profiles.ts";
import type { Params } from "../profiles.ts";
import { ERROR_TYPES } from "./types.ts";
import type { DrawnType, NotModelled } from "./types.ts";

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

/**
 * The types a production run reports as not modelled, in the order of the hypothesis matrix: the drawn types without a ledger rate (RATE_GAPS) and the clock
 * error, whose entry (A049) is an example offset and no frequency. A scenario that names an offset for an analyzer injects it, so then the clock error is modelled.
 * (2026-10-29 S2c2, orchestrator ruling: a type without a ledger rate reads "not modelled", never "realised 0".)
 */
export const notModelled = (clockOffsets: Readonly<Record<string, number>> = {}): NotModelled[] =>
  ERROR_TYPES.filter((t): t is NotModelled => t in RATE_GAPS || (t === "clock_offset" && !Object.values(clockOffsets).some((s) => s !== 0)));

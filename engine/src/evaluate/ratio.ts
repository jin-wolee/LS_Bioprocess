import type { Ratio } from "../generated/metrics.schema";

export type { Ratio };

/** The count behind every metric that says "all analysis requests" (spec section 8, anti-gaming rule 1): drawn samples and draws refused by the volume budget. */
export const ALL_REQUESTS = "all analysis requests (drawn samples and draws refused by the volume budget)";

/** A count over a stated denominator. A zero denominator gives null, never 0 or 1: "none occurred" is not a perfect score. */
export const ratio = (num: number, den: number, denominator: string): Ratio => ({ num, den, denominator, value: den === 0 ? null : num / den });

/** What the precision and the false-alarm rate of an evidence detector read: evidence raises no alarm, so neither has a value (never a number, never null). */
export const NOT_APPLICABLE = "not applicable" as const;

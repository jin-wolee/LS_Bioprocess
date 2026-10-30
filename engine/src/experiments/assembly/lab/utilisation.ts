import { quantile } from "../../../evaluate/stats.ts";
import type { Metrics } from "../../../generated/metrics.schema";

// Utilisation per analyzer profile across the seeds (spec section 4.5.6). The report's rows leave out the `by_profile` list (the aggregate flattens numbers, not arrays), and the
// figure comes from the shared truth run, so it is the same for every architecture: the Results screen shows it once, from the cells of the first architecture.

export interface UtilisationRow {
  window: "staffed" | "24h";
  setup: "with" | "without";
  n_defined: number;
  median: number | null;
  lo: number | null;
  hi: number | null;
  /** What the denominator counts, in words (the evaluator's own text). */
  denominator: string;
}

export interface UtilisationProfile {
  profile: string;
  instruments: number;
  rows: UtilisationRow[];
}

export interface UtilisationView {
  by_profile: UtilisationProfile[];
}

const WINDOWS = [["staffed", "per_staffed_window"], ["24h", "per_24h"]] as const;
const SETUPS = [["with", "with_setup"], ["without", "without_setup"]] as const;

/** The median and the 5th to 95th percentile across seeds of each profile's four figures; the same rule as the report's rows (evaluate/aggregate.ts). */
export const utilisationView = (cells: readonly Metrics[]): UtilisationView => {
  const first = cells[0]?.metrics.utilisation.by_profile ?? [];
  return {
    by_profile: first.map((profile) => ({
      profile: profile.profile,
      instruments: profile.instruments,
      rows: WINDOWS.flatMap(([window, windowKey]) =>
        SETUPS.map(([setup, setupKey]): UtilisationRow => {
          const ratios = cells.map((c) => c.metrics.utilisation.by_profile?.find((p) => p.profile === profile.profile)?.[windowKey][setupKey]);
          const values = ratios.flatMap((r) => (r && r.value !== null ? [r.value] : []));
          return {
            window,
            setup,
            n_defined: values.length,
            median: quantile(values, 0.5),
            lo: quantile(values, 0.05),
            hi: quantile(values, 0.95),
            denominator: ratios[0]?.denominator ?? "",
          };
        }),
      ),
    })),
  };
};

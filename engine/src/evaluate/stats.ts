// Plain statistics for the evaluator. No library: the quantile is the nearest-rank one (the smallest value with at least q of the sample at or below it).

export const quantile = (xs: readonly number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] as number;
};

export const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Sample variance (n - 1); null below two values. */
export const variance = (xs: readonly number[]): number | null => {
  const m = mean(xs);
  return m === null || xs.length < 2 ? null : xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
};
